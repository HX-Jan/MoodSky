// ============================================================================
// MoodSky — task/preference data sources for export and cleanup  (W3 JF05)
// ============================================================================
// Trusted server-side helpers only: never an action, never assembled by
// index.js, and no database handle is opened at import time. The caller injects
// either an initialised wx database (createAccountDataSources({ db })) or an
// already-open transaction for readSourceState(ownerId, tx).
//
//   readSourceState(ownerId, tx)                  export source fence (XY03)
//   listTaskHistory(ownerId, { limit, after })    owner-only task_history page
//   listPreferences(ownerId)                      owner-only preference fields
//   cleanupOwnerBatch(ownerId, { collection, limit })  idempotent batch delete
//
// Failing closed is part of the contract: a missing layout/counter/field answers
// NOT_IMPLEMENTED, a malformed one answers CONFLICT, and nothing here invents a
// zero, a default or an empty "done" state. task_templates is public operator
// material and is deliberately absent from the cleanup allow-list.
// ============================================================================

const { AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');
const { TASK_STATUS } = require('../shared/constants');
const { isBusinessDate } = require('../shared/date');
const {
  validId,
  fail,
  database,
  identity,
  account,
  ownerPage,
} = require('../domains/storage-support');

// Same five domains storage-support.sourceState requires.
const SOURCE_DOMAINS = Object.freeze([
  'journals',
  'favorites',
  'tasks',
  'preferences',
  'decorations',
]);
const TASK_HISTORY = 'task_history';
const PREFERENCES = 'preferences';
const CLEANUP_COLLECTIONS = Object.freeze([TASK_HISTORY, PREFERENCES]);
const PREFERENCE_FIELDS = Object.freeze(['cardTextPreview', 'decorationsEnabled']);
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TASK_STATES = Object.freeze(Object.values(TASK_STATUS));
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 100;
const CLEANUP_DEFAULT_LIMIT = 50;
const CLEANUP_MAX_LIMIT = 100;

function unavailable(message) {
  throw new AppError(ERROR_CODES.NOT_IMPLEMENTED, message);
}

// A fence/revision counter that a writer can still advance. Number.MAX_SAFE_INTEGER
// is exhausted and refused, matching stores/account-transaction.js.
function counter(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function timestamp(value) {
  const text = value instanceof Date ? value.toISOString() : value;
  return typeof text === 'string' && Number.isFinite(Date.parse(text)) ? text : null;
}

/**
 * Builds the owner-scoped data sources.
 *
 * @param {object} options { db } - injected WX-shaped database ({ throwOnNotFound:false }).
 *   readSourceState only needs the caller's transaction, so a test may inject tx alone.
 */
// A writer can only advance a domain revision that the account row already
// declares. Missing fields are a deployment/migration problem: this module never
// creates them, because a fabricated zero would let an export miss a change.
function nextRevisions(declared, domain, journalRevision) {
  if (!SOURCE_DOMAINS.includes(domain)) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, '未知的数据来源域。');
  }
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    unavailable('账号尚未维护来源版本，不能推进域版本。');
  }
  if (Object.keys(declared).length !== SOURCE_DOMAINS.length) {
    return fail('CONFLICT');
  }
  const next = {};
  for (const key of SOURCE_DOMAINS) {
    if (!hasOwn(declared, key) || !counter(declared[key])) {
      return fail('CONFLICT');
    }
    next[key] = declared[key];
  }
  if (next.journals !== journalRevision) {
    return fail('CONFLICT');
  }
  next[domain] += 1;
  if (!counter(next[domain])) {
    return fail('CONFLICT');
  }
  return next;
}

/**
 * Advances one domain revision inside the caller's transaction, so the business
 * write and its source version commit together. The caller (tasks/preferences
 * wiring) must pass its own transaction; without one a private transaction is
 * opened, which is only valid when no other write is in flight.
 */
function createSourceRevisionWriter({ db } = {}) {
  async function bumpWith(transaction, ownerId, domain) {
    const accountId = identity(ownerId);
    const row = account(
      (await transaction.collection('accounts').doc(accountId).get()).data,
      accountId,
      'active',
    );
    if (
      row.journalLayout !== 'deterministic-days-v1' ||
      row.taskLayout !== 'deterministic-tasks-v1'
    ) {
      unavailable('账号任务/日记布局尚未确认，来源版本不可推进。');
    }
    if (
      row.operationFence === undefined ||
      row.exportEpoch === undefined ||
      row.journalRevision === undefined
    ) {
      unavailable('账号缺少围栏或来源版本字段，来源版本不可推进。');
    }
    if (![row.operationFence, row.exportEpoch, row.journalRevision].every(counter)) {
      return fail('CONFLICT');
    }
    const sourceRevisions = nextRevisions(row.sourceRevisions, domain, row.journalRevision);
    const update = await transaction
      .collection('accounts')
      .doc(accountId)
      .update({ data: { sourceRevisions } });
    if (!update || !update.stats || update.stats.updated !== 1) {
      return fail('CONFLICT');
    }
    return { ownerId: accountId, sourceRevisions };
  }

  return async function bumpSourceRevision(ownerId, domain, transaction) {
    if (transaction) {
      return bumpWith(transaction, ownerId, domain);
    }
    if (!db || typeof db.runTransaction !== 'function') {
      unavailable('来源版本必须在存储事务内推进。');
    }
    return db.runTransaction((tx) => bumpWith(tx, ownerId, domain));
  };
}

function createAccountDataSources({ db } = {}) {
  /**
   * Export/cleanup source fence, read inside the caller's transaction so the
   * snapshot and the later comparisons observe one consistent source version.
   *
   * Writing task transitions and preference saves do not update the accounts row
   * today, so operationFence/exportEpoch cannot stand in for the four non-journal
   * revisions: that would silently miss a change and hand an export job stale data.
   * The row must therefore carry sourceRevisions; without it this answers
   * NOT_IMPLEMENTED instead of reporting zeros.
   */
  async function readSourceState(ownerId, tx) {
    const accountId = identity(ownerId);
    if (!tx || typeof tx.collection !== 'function') {
      unavailable('导出来源版本必须在存储事务内读取。');
    }
    const row = account(
      (await tx.collection('accounts').doc(accountId).get()).data,
      accountId,
      'active',
    );
    if (
      row.journalLayout !== 'deterministic-days-v1' ||
      row.taskLayout !== 'deterministic-tasks-v1'
    ) {
      // Legacy accounts keep their data; no field is initialized or migrated.
      unavailable('账号任务/日记布局尚未确认，导出来源版本不可用。');
    }
    if (
      row.operationFence === undefined ||
      row.exportEpoch === undefined ||
      row.journalRevision === undefined
    ) {
      unavailable('账号缺少围栏或来源版本字段，导出与清理暂不可用。');
    }
    if (![row.operationFence, row.exportEpoch, row.journalRevision].every(counter)) {
      return fail('CONFLICT');
    }
    const declared = row.sourceRevisions;
    if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
      unavailable('favorites/tasks/preferences/decorations 尚未维护来源版本。');
    }
    if (Object.keys(declared).length !== SOURCE_DOMAINS.length) {
      return fail('CONFLICT');
    }
    const revisions = {};
    for (const domain of SOURCE_DOMAINS) {
      if (!hasOwn(declared, domain) || !counter(declared[domain])) {
        return fail('CONFLICT');
      }
      revisions[domain] = declared[domain];
    }
    if (revisions.journals !== row.journalRevision) {
      return fail('CONFLICT');
    }
    return { ownerId: accountId, status: 'active', epoch: row.exportEpoch, revisions };
  }

  // Explicit projection: ownerId and any storage metadata stay server-side.
  function taskHistoryItem(row, accountId) {
    if (!row || row.ownerId !== accountId) {
      return fail('FORBIDDEN');
    }
    if (
      typeof row.taskId !== 'string' ||
      !TASK_ID_PATTERN.test(row.taskId) ||
      !isBusinessDate(row.date) ||
      !TASK_STATES.includes(row.state)
    ) {
      return fail('CONFLICT');
    }
    const createdAt = timestamp(row.createdAt);
    if (!createdAt) {
      return fail('CONFLICT');
    }
    const item = { taskId: row.taskId, date: row.date, state: row.state, createdAt };
    if (typeof row.taskTitle === 'string' && row.taskTitle.length > 0) {
      item.taskTitle = row.taskTitle;
    }
    return item;
  }

  /**
   * Page of the owner's own task history, ordered by storage id ascending.
   * Items never carry ownerId; nextCursor is the server page id and remains null
   * until another owner row actually exists, so a short page is not mistaken for
   * a complete history.
   */
  async function listTaskHistory(ownerId, options = {}) {
    const accountId = identity(ownerId);
    const limit = options.limit === undefined ? HISTORY_DEFAULT_LIMIT : options.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
      return fail();
    }
    const after = options.after === undefined || options.after === null ? '' : options.after;
    if (after !== '' && !validId(after)) {
      return fail();
    }
    const store = database(db, ['collection']);
    const rows = await ownerPage(store, TASK_HISTORY, accountId, after, limit);
    const items = rows.map((row) => taskHistoryItem(row, accountId));
    let nextCursor = rows.length === limit ? rows[rows.length - 1]._id : null;
    if (nextCursor) {
      const more = await ownerPage(store, TASK_HISTORY, accountId, nextCursor, 1);
      if (!more.length) {
        nextCursor = null;
      }
    }
    return { items, nextCursor };
  }

  /**
   * Stored preference fields of the owner, without ownerId/openid. Missing fields
   * are omitted rather than filled from DEFAULT_PREFERENCES: this reader reports
   * what exists, while account.preferences keeps the defaulting semantics.
   * null means the owner never saved preferences.
   */
  async function listPreferences(ownerId) {
    const accountId = identity(ownerId);
    const store = database(db, ['collection']);
    const result = await store.collection(PREFERENCES).where({ ownerId: accountId }).limit(2).get();
    if (!result || !Array.isArray(result.data)) {
      return fail('CONFLICT');
    }
    if (result.data.length > 1) {
      // One preference document per owner; duplicates cannot be projected safely.
      return fail('CONFLICT');
    }
    if (result.data.length === 0) {
      return null;
    }
    const row = result.data[0];
    if (!row || row.ownerId !== accountId || !validId(row._id)) {
      return fail('CONFLICT');
    }
    const preferences = {};
    for (const key of PREFERENCE_FIELDS) {
      if (hasOwn(row, key)) {
        if (typeof row[key] !== 'boolean') {
          return fail('CONFLICT');
        }
        preferences[key] = row[key];
      }
    }
    if (row.updatedAt !== undefined) {
      const updatedAt = timestamp(row.updatedAt);
      if (!updatedAt) {
        return fail('CONFLICT');
      }
      preferences.updatedAt = updatedAt;
    }
    return preferences;
  }

  /**
   * Removes one owner batch from an allowed private collection. Repeating the
   * call is safe: a row that another worker already removed counts as zero
   * deletions and is not an error, and only this owner's rows are addressed.
   * Account status and the cleanup job/receipt guards stay with the trusted
   * worker protocol (domains/cleanup.js); this helper performs the deletion only.
   */
  async function cleanupOwnerBatch(ownerId, options = {}) {
    const accountId = identity(ownerId);
    const collection = options.collection;
    if (!CLEANUP_COLLECTIONS.includes(collection)) {
      // task_templates and every other collection are not deletable here.
      return fail('INVALID_INPUT');
    }
    const limit = options.limit === undefined ? CLEANUP_DEFAULT_LIMIT : options.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > CLEANUP_MAX_LIMIT) {
      return fail();
    }
    const store = database(db, ['collection']);
    const rows = await ownerPage(store, collection, accountId, '', limit);
    let deleted = 0;
    for (const row of rows) {
      if (!row || row.ownerId !== accountId) {
        return fail('CONFLICT');
      }
      deleted += await store.runTransaction(async (tx) => {
        const document = tx.collection(collection).doc(row._id);
        const current = (await document.get()).data;
        if (!current) {
          return 0;
        }
        if (current._id !== row._id || current.ownerId !== accountId) {
          return fail('FORBIDDEN');
        }
        const result = await document.remove();
        if (![0, 1].includes(result?.stats?.removed)) {
          return fail('CONFLICT');
        }
        return result.stats.removed;
      });
    }
    const remaining = await ownerPage(store, collection, accountId, '', 1);
    return { collection, deleted, hasMore: remaining.length > 0 };
  }

  return {
    readSourceState,
    listTaskHistory,
    listPreferences,
    cleanupOwnerBatch,
  };
}

module.exports = {
  createAccountDataSources,
  createSourceRevisionWriter,
  nextRevisions,
  SOURCE_DOMAINS,
  CLEANUP_COLLECTIONS,
};
