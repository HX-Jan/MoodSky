// ============================================================================
// MoodSky — account domain  (W2 JF03 / JF04, Jiawei Fang)
// ============================================================================
// Owns account.preferences (W1 JF03 proposal P1), account.close and the
// receipt-gated account.cleanupStatus. Export actions (account.requestExport /
// exportStatus / downloadExport) stay Xiang Yu's scope and keep answering
// NOT_IMPLEMENTED.
//
// Payload validation lives HERE, not in shared/validation.js: the shared file
// is generated from miniprogram/shared and must not drift, so the "add a
// preferences/close validator to shared/validation.js" request is recorded as
// an open item in the week-2 documents instead of being edited in place.
//
// Local opt-in factory only. The default domain remains a foundation stub.
//
// W3 JF04 adds an optional transactional close path. When the caller injects
// stores/account-transaction.createAccountTransactions (withOwner), the cleanup
// job and the disable commit together or not at all, and the job carries the
// fields domains/cleanup.js guards on (exportAccessRevoked, progress). The W2
// store path stays unchanged for the unwired router and its focused tests; that
// store maps only ownerId/state/timestamps, so its jobs are not guard-ready.
//
// No business-day field is produced here: preferences and cleanup jobs carry
// UTC ISO timestamps only, so shared/date.js is not required.
// ============================================================================

const { createHash } = require('node:crypto');
const { notImplemented, AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');
const { ACCOUNT_STATUS, DEFAULT_PREFERENCES } = require('../shared/constants');
const { createCleanupReceiptSigner } = require('../identity');

const ACTION_PREFERENCES = 'account.preferences';
const ACTION_CLOSE = 'account.close';
const ACTION_CLEANUP_STATUS = 'account.cleanupStatus';

const PREFERENCE_FIELDS = ['cardTextPreview', 'decorationsEnabled'];
const CLEANUP_PENDING = 'pending';
const CLEANUP_COMPLETED = 'completed';
const CLEANUP_FAILED = 'failed';
// "One recoverable job per owner" is the invariant both close paths keep.
const OPEN_JOB_STATES = Object.freeze([CLEANUP_PENDING, 'processing']);
// A receipt reports only a state that is actually stored on the job row. The
// executor is not wired here, so this environment creates only 'pending'; a
// completed row is reported as stored (never invented) and an unknown state
// still fails closed.
const REPORTABLE_JOB_STATES = Object.freeze([
  CLEANUP_PENDING,
  'processing',
  CLEANUP_COMPLETED,
  CLEANUP_FAILED,
]);
const CLEANUP_STATE_UNREADY = '清理进度尚不可确认。';
const COLLECTION_ACCOUNTS = 'accounts';
const COLLECTION_CLEANUP_JOBS = 'cleanup_jobs';
const CONFIRM_WORD = 'CLOSE';
const RETRY_MESSAGE = '注销暂未完成，请重试。';
const RECEIPT_INVALID = '清理进度回执无效。';

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalid(message) {
  throw new AppError(ERROR_CODES.INVALID_INPUT, message);
}

function forbid(message) {
  throw new AppError(ERROR_CODES.FORBIDDEN, message);
}

function requireAccountId(actor) {
  const accountId = actor && typeof actor.accountId === 'string' ? actor.accountId : '';
  if (!accountId) {
    // Only the router-provided actor may name an account; never the payload.
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, '请先登录。');
  }
  return accountId;
}

function assertOnlyKeys(payload, allowed, message) {
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    invalid(message);
  }
}

function defaultPreference(key, row) {
  const value = row ? row[key] : undefined;
  return typeof value === 'boolean' ? value : DEFAULT_PREFERENCES[key];
}

async function handlePreferences(request, { store, clock }) {
  const payload = request.payload || {};
  assertOnlyKeys(
    payload,
    ['operation', 'cardTextPreview', 'decorationsEnabled'],
    '偏好输入包含未约定字段。',
  );
  const accountId = requireAccountId(request.actor);

  if (payload.operation === 'get') {
    if (hasOwn(payload, 'cardTextPreview') || hasOwn(payload, 'decorationsEnabled')) {
      invalid('读取偏好不接受写入字段。');
    }
    const row = await store.getPreferences(accountId);
    if (!row) {
      // Defaults come from the shared constant, never from a client copy.
      return { ...DEFAULT_PREFERENCES, updatedAt: null };
    }
    return {
      cardTextPreview: defaultPreference('cardTextPreview', row),
      decorationsEnabled: defaultPreference('decorationsEnabled', row),
      updatedAt: row.updatedAt || null,
    };
  }

  if (payload.operation === 'set') {
    const patch = {};
    for (const key of PREFERENCE_FIELDS) {
      if (!hasOwn(payload, key)) {
        continue;
      }
      if (typeof payload[key] !== 'boolean') {
        invalid('偏好字段必须为布尔值。');
      }
      patch[key] = payload[key];
    }
    if (Object.keys(patch).length === 0) {
      invalid('请至少提供一个偏好字段。');
    }
    // Only this request's fields are written. Re-writing the whole row from a
    // read-modify-write would let a concurrent partial set of the other field be
    // silently lost (and would then report a value the database never kept).
    const saved = await store.updatePreferences(accountId, patch, clock().toISOString());
    // The returned object is the merge that actually landed, so the page can echo
    // it directly without being told about a value that was overwritten.
    return {
      cardTextPreview: defaultPreference('cardTextPreview', saved),
      decorationsEnabled: defaultPreference('decorationsEnabled', saved),
      updatedAt: saved.updatedAt || null,
    };
  }

  invalid('operation 必须为 get 或 set。');
}

// A disabled account can never exist without a recoverable job. The response is
// built in one place so the store path and the W3 transactional path cannot drift.
function closeResult(job, receipt) {
  const jobId = typeof job.id === 'string' ? job.id : job._id;
  return {
    accountStatus: ACCOUNT_STATUS.DISABLED,
    // There is no session/token table, so no token is revoked and this response
    // must not claim one was. What does hold is that the router refuses every
    // private action for a disabled account; the three fields say exactly that.
    sessionRevoked: false,
    sessionRevocation: 'not_implemented',
    privateActionsDenied: true,
    cleanup: { jobId, state: job.state },
    // Fail closed: without CLOUD_RECEIPT_SECRET no receipt is issued at all.
    receipt: typeof receipt === 'string' && receipt.length > 0 ? receipt : null,
  };
}

// One deterministic job document per owner. Even if two closes raced past the
// router gate, they would target the same document instead of opening a second
// job, so "重复申请不建第二个 job" does not depend on the read-then-insert window.
function cleanupJobId(accountId) {
  return createHash('sha256')
    .update(JSON.stringify(['cleanup-job', accountId]))
    .digest('hex')
    .slice(0, 32);
}

// W3 JF04: job and disable commit together, so a failure leaves the account
// active and no job behind instead of half a closure.
async function closeInTransaction(deps, accountId) {
  const { transactions, clock, issueCleanupReceipt } = deps;
  const stamp = clock().toISOString();
  try {
    return await transactions.withOwner(accountId, async () => {
      const tx = transactions.transaction(accountId);
      // A cloud transaction supports doc() reads only; a where() query inside a
      // transaction fails on the real platform even though the local fixture
      // allows it. The job id is deterministic, so a document read is the lookup.
      const jobId = cleanupJobId(accountId);
      const jobRef = tx.collection(COLLECTION_CLEANUP_JOBS).doc(jobId);
      const storedJob = (await jobRef.get()).data || null;
      if (storedJob && storedJob.ownerId !== accountId) {
        throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE);
      }
      if (storedJob && !OPEN_JOB_STATES.includes(storedJob.state)) {
        // Never overwrite a row the cleanup worker already advanced (completed or
        // failed); the ledger belongs to the executor, not to a retried close.
        throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE);
      }
      if (!storedJob) {
        // Guard fields required by domains/cleanup.js: ownerId, a pending state,
        // exportAccessRevoked === true and a per-collection progress map.
        await tx
          .collection(COLLECTION_CLEANUP_JOBS)
          .doc(jobId)
          .set({
            data: {
              ownerId: accountId,
              state: CLEANUP_PENDING,
              exportAccessRevoked: true,
              progress: {},
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
      }
      const disabled = await tx
        .collection(COLLECTION_ACCOUNTS)
        .doc(accountId)
        .update({ data: { status: ACCOUNT_STATUS.DISABLED, updatedAt: stamp } });
      if (!disabled || !disabled.stats || disabled.stats.updated !== 1) {
        throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE);
      }
      // domains/export.js fences export jobs by accountEpoch. Advancing the epoch
      // inside the same transaction invalidates anything prepared before the
      // disable, so the two services cannot disagree about a revoked export.
      transactions.changed(accountId);
      return closeResult(
        { _id: jobId, state: storedJob ? storedJob.state : CLEANUP_PENDING },
        issueCleanupReceipt({ jobId }),
      );
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    // Nothing was committed (job, disable and fence rolled back together), so the
    // close can be retried without a compensation write.
    throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE);
  }
}

async function handleClose(request, deps) {
  const payload = request.payload || {};
  assertOnlyKeys(payload, ['confirm'], '注销输入包含未约定字段。');
  if (payload.confirm !== CONFIRM_WORD) {
    invalid('请输入 ' + CONFIRM_WORD + ' 确认注销。');
  }
  const accountId = requireAccountId(request.actor);
  if (deps.transactions) {
    // A repeat close is refused by the router (ACCOUNT_DISABLED) and, on the
    // recovery path, by the transaction's own "status === active" precondition.
    // Neither can open a second job.
    return closeInTransaction(deps, accountId);
  }
  const requestId = typeof request.requestId === 'string' ? request.requestId : null;
  return closeThroughStore(deps, { accountId, requestId });
}

async function closeThroughStore(deps, { accountId, requestId }) {
  const { store, clock, issueCleanupReceipt } = deps;

  // A retry carrying the same requestId returns the recorded outcome instead of
  // opening a second job. The router answers a repeat close with
  // ACCOUNT_DISABLED before reaching here; this branch covers recovery paths.
  if (requestId) {
    const replay = await store.findRequestReceipt({
      ownerId: accountId,
      action: ACTION_CLOSE,
      requestId,
    });
    if (replay && replay.data) {
      return replay.data;
    }
  }

  const stamp = clock().toISOString();
  // 1) A recoverable job is written BEFORE the account is disabled, so a
  //    disabled account can never exist without a cleanup task behind it.
  const existing = await store.findOpenCleanupJob(accountId);
  let job;
  try {
    job =
      existing ||
      (await store.insertCleanupJob({
        ownerId: accountId,
        state: CLEANUP_PENDING,
        createdAt: stamp,
        updatedAt: stamp,
      }));
  } catch (_error) {
    // Nothing was written and the account is still active, so the whole close
    // can be retried; it uses the same retryable code as a failed disable.
    throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE);
  }

  // 2) Disable. On failure the job is marked failed and the call is retryable;
  //    the account stays active, so the invariant above still holds.
  try {
    await store.setAccountStatus(accountId, ACCOUNT_STATUS.DISABLED, stamp);
  } catch (_error) {
    await store.setCleanupJobState(job.id, CLEANUP_FAILED, clock().toISOString());
    throw new AppError(ERROR_CODES.CONFLICT, RETRY_MESSAGE);
  }

  const data = closeResult(job, issueCleanupReceipt({ jobId: job.id }));

  if (requestId) {
    try {
      await store.insertRequestReceipt({
        ownerId: accountId,
        action: ACTION_CLOSE,
        requestId,
        data,
        createdAt: stamp,
      });
    } catch (_error) {
      // Recording the replay row must never turn a completed close into a failure.
    }
  }
  return data;
}

// The progress map is the executor's ledger. A malformed map is a conflict, not
// something to paper over with an empty object.
function readProgress(value) {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ERROR_CODES.CONFLICT, CLEANUP_STATE_UNREADY);
  }
  const entries = Object.entries(value);
  const valid = entries.every(
    ([key, count]) =>
      typeof key === 'string' && key.length > 0 && Number.isSafeInteger(count) && count >= 0,
  );
  if (!valid) {
    throw new AppError(ERROR_CODES.CONFLICT, CLEANUP_STATE_UNREADY);
  }
  return { ...value };
}

async function handleCleanupStatus(request, deps) {
  const payload = request.payload || {};
  assertOnlyKeys(payload, ['jobId', 'receipt'], '进度查询输入包含未约定字段。');
  if (typeof payload.jobId !== 'string' || payload.jobId.length === 0) {
    invalid('请提供 jobId。');
  }
  if (typeof payload.receipt !== 'string' || payload.receipt.length === 0) {
    // The router normally refuses first; keeping the check is defence in depth.
    forbid(RECEIPT_INVALID);
  }
  const boundJobId =
    request.actor && typeof request.actor.jobId === 'string' ? request.actor.jobId : null;
  if (!boundJobId || boundJobId !== payload.jobId) {
    // A receipt only ever reads the single job it was issued for.
    forbid(RECEIPT_INVALID);
  }
  // The W3 path reads the guard-ready row through the injected reader; the store
  // path (W2) keeps reading the mapped row. A receipt is never a login: only the
  // job its own token names is read.
  const job =
    typeof deps.readCleanupJob === 'function'
      ? await deps.readCleanupJob(boundJobId)
      : await deps.store.getCleanupJob(boundJobId);
  if (!job || (typeof job.id !== 'string' && typeof job._id !== 'string')) {
    forbid(RECEIPT_INVALID);
  }
  const jobId = typeof job.id === 'string' ? job.id : job._id;
  if (jobId !== boundJobId || typeof job.ownerId !== 'string' || job.ownerId.length === 0) {
    forbid(RECEIPT_INVALID);
  }
  if (!REPORTABLE_JOB_STATES.includes(job.state)) {
    // Report only the worker's recognised stored states. This endpoint does not
    // execute cleanup or invent completion when the row has an unknown state.
    throw new AppError(ERROR_CODES.CONFLICT, CLEANUP_STATE_UNREADY);
  }
  const data = {
    jobId,
    state: job.state,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
  };
  if (job.exportAccessRevoked === true) {
    // Guard-ready job: report the per-collection counts the cleanup worker owns.
    // Empty means "nothing counted yet", never a fabricated zero total.
    data.progress = readProgress(job.progress);
  }
  return data;
}

// Jiawei Fang: F21 and F23 account closure/progress entry points.
// Xiang Yu: F22 export and F23 cleanup workers; split execution modules when implemented.
async function handle(_request) {
  return notImplemented();
}

/**
 * Builds the account domain.
 *
 * @param {object} options
 *   store               account store (preferences, W2 replay and the W2 close path)
 *   clock               () => Date, defaults to the real clock
 *   issueCleanupReceipt receipt signer; defaults to the fail-closed HMAC signer
 *   transactions        optional createAccountTransactions(db): close then runs
 *                       in one transaction and writes the cleanup guard fields
 *   readCleanupJob      optional async (jobId) => raw cleanup_jobs row | null,
 *                       used by cleanupStatus when the job lives in the database
 */
function createAccountDomain({
  store,
  clock,
  issueCleanupReceipt,
  transactions,
  readCleanupJob,
} = {}) {
  if (!store) {
    throw new TypeError('createAccountDomain requires an account store.');
  }
  if (
    transactions !== undefined &&
    (!transactions ||
      typeof transactions.withOwner !== 'function' ||
      typeof transactions.transaction !== 'function' ||
      typeof transactions.changed !== 'function')
  ) {
    throw new TypeError(
      'createAccountDomain transactions must come from createAccountTransactions.',
    );
  }
  if (readCleanupJob !== undefined && typeof readCleanupJob !== 'function') {
    throw new TypeError('createAccountDomain readCleanupJob must be a function.');
  }
  const readClock = typeof clock === 'function' ? clock : () => new Date();
  const signer = createCleanupReceiptSigner({ clock: readClock });
  const issue = typeof issueCleanupReceipt === 'function' ? issueCleanupReceipt : signer.issue;
  const dependencies = {
    store,
    clock: readClock,
    issueCleanupReceipt: issue,
    ...(transactions === undefined ? {} : { transactions }),
    ...(readCleanupJob === undefined ? {} : { readCleanupJob }),
  };
  return {
    async handle(request) {
      if (request.action === ACTION_PREFERENCES) {
        return handlePreferences(request, dependencies);
      }
      if (request.action === ACTION_CLOSE) {
        return handleClose(request, dependencies);
      }
      if (request.action === ACTION_CLEANUP_STATUS) {
        return handleCleanupStatus(request, dependencies);
      }
      return notImplemented();
    },
  };
}

module.exports = { handle, createAccountDomain };
