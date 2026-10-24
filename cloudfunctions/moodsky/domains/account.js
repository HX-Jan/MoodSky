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
// The unwired `handle` export keeps returning NOT_IMPLEMENTED. index.js injects
// createAccountDomain({ store, clock, issueCleanupReceipt }) through the
// router's domain override map.
//
// No business-day field is produced here: preferences and cleanup jobs carry
// UTC ISO timestamps only, so shared/date.js is not required.
// ============================================================================

const { notImplemented, AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');
const { ACCOUNT_STATUS, DEFAULT_PREFERENCES } = require('../shared/constants');
const { createCleanupReceiptSigner } = require('../identity');

const ACTION_PREFERENCES = 'account.preferences';
const ACTION_CLOSE = 'account.close';
const ACTION_CLEANUP_STATUS = 'account.cleanupStatus';

const PREFERENCE_FIELDS = ['cardTextPreview', 'decorationsEnabled'];
const CLEANUP_PENDING = 'pending';
const CLEANUP_FAILED = 'failed';
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

async function handleClose(request, { store, clock, issueCleanupReceipt }) {
  const payload = request.payload || {};
  assertOnlyKeys(payload, ['confirm'], '注销输入包含未约定字段。');
  if (payload.confirm !== CONFIRM_WORD) {
    invalid('请输入 ' + CONFIRM_WORD + ' 确认注销。');
  }
  const accountId = requireAccountId(request.actor);
  const requestId = typeof request.requestId === 'string' ? request.requestId : null;

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

  const receipt = issueCleanupReceipt({ jobId: job.id });
  const data = {
    accountStatus: ACCOUNT_STATUS.DISABLED,
    // There is no session/token table, so no token is revoked and this response
    // must not claim one was. What does hold is that the router refuses every
    // private action for a disabled account; the three fields say exactly that.
    sessionRevoked: false,
    sessionRevocation: 'not_implemented',
    privateActionsDenied: true,
    cleanup: { jobId: job.id, state: job.state },
    // Fail closed: without CLOUD_RECEIPT_SECRET no receipt is issued at all.
    receipt: typeof receipt === 'string' && receipt.length > 0 ? receipt : null,
  };

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

async function handleCleanupStatus(request, { store }) {
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
  const job = await store.getCleanupJob(boundJobId);
  if (!job) {
    forbid(RECEIPT_INVALID);
  }
  // Progress counters are omitted on purpose: the cleanup executor is not
  // wired, so no processed-row count exists yet. Never report a percentage.
  return {
    jobId: job.id,
    state: job.state,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
  };
}

// Jiawei Fang: F21 and F23 account closure/progress entry points.
// Xiang Yu: F22 export and F23 cleanup workers; split execution modules when implemented.
async function handle(_request) {
  return notImplemented();
}

/**
 * Builds the store-backed account domain.
 *
 * @param {object} options { store, clock = () => new Date(), issueCleanupReceipt }
 */
function createAccountDomain({ store, clock, issueCleanupReceipt } = {}) {
  if (!store) {
    throw new TypeError('createAccountDomain requires an account store.');
  }
  const readClock = typeof clock === 'function' ? clock : () => new Date();
  const signer = createCleanupReceiptSigner({ clock: readClock });
  const issue = typeof issueCleanupReceipt === 'function' ? issueCleanupReceipt : signer.issue;
  const dependencies = { store, clock: readClock, issueCleanupReceipt: issue };
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
