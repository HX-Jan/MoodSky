// ============================================================================
// MoodSky — formal account adapters  (W3 JF01, Jiawei Fang)
// ============================================================================
// The callable account resolver the candidate router and the H02 journal backend
// use, replacing the local "find, then insert" identity path for explicit wiring.
// The shipped entry (index.js), the domain stubs and the packaging gate are NOT
// touched here: the production entry keeps answering NOT_IMPLEMENTED.
//
//   resolveAccount(openid)                trusted OPENID -> { id, status } | null
//   resolveAccountForJournal(openid)      documented H02 preflight (see
//                                         docs/week3/Jiawei_Fang/w3-jf01-account-layout.md)
//   resolveOperatorRoles(accountId)       injected operator seam, fail closed
//   resolveCleanupReceipt(token)          HMAC receipt verification
//   issueCleanupReceipt({ jobId })        the matching signing side (close)
//
// Account creation is delegated to domains/repository.getOrCreateAccount so the
// unique-index gate (NOT_IMPLEMENTED when uniq_openid is not ready) and the W2
// journal fields stay in exactly one writer. A legacy row without journalLayout
// is reported as journalReady: false and is never migrated or rewritten here:
// nothing in this module calls add() or update().
//
// readAccount is a read-only row reader (createAccountReaders({ db }) below).
// Without it a row cannot be inspected, so resolveAccountForJournal reports
// journalReady: false instead of guessing the layout.
// ============================================================================

const { notImplemented } = require('../shared/result');
const { createCleanupReceiptSigner } = require('../identity');

const JOURNAL_LAYOUT = 'deterministic-days-v1';
const ACCOUNTS = 'accounts';
const CLEANUP_JOBS = 'cleanup_jobs';
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeVersion(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
}

function readDocument(result) {
  const row = result && result.data ? result.data : null;
  return Array.isArray(row) ? row[0] || null : row;
}

function documentId(value) {
  return typeof value === 'string' && DOCUMENT_ID.test(value) ? value : null;
}

/**
 * Read-only document readers over an injected WX-shaped database.
 * They never initialise the SDK and never write.
 *
 * @param {object} options { db } a wx database({ throwOnNotFound: false })
 */
function createAccountReaders({ db } = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new TypeError('createAccountReaders requires an injected wx database.');
  }
  async function readDocumentById(collection, id) {
    const checked = documentId(id);
    if (!checked) {
      return null;
    }
    const row = readDocument(await db.collection(collection).doc(checked).get());
    return row && row._id === checked ? row : null;
  }
  return {
    readAccount: (accountId) => readDocumentById(ACCOUNTS, accountId),
    readCleanupJob: (jobId) => readDocumentById(CLEANUP_JOBS, jobId),
  };
}

/**
 * Builds the trusted account adapters.
 *
 * @param {object} options
 *   repository           domains/repository.createRepository(...) - required
 *   store                accepted for W2 wiring parity; not read or written here
 *   clock                () => Date, defaults to the real clock
 *   receiptSecret        test override for CLOUD_RECEIPT_SECRET
 *   env                  environment source for the receipt secret
 *   resolveOperatorRoles injected operator seam; otherwise NOT_IMPLEMENTED
 *   readAccount          async (accountId) => raw account row | null
 */
function createAccountAdapters(options = {}) {
  const { repository, clock, receiptSecret, env, resolveOperatorRoles, readAccount } = options;
  if (!repository || typeof repository.getOrCreateAccount !== 'function') {
    throw new TypeError('createAccountAdapters requires the trusted account repository.');
  }
  const readClock = typeof clock === 'function' ? clock : () => new Date();
  const signer = createCleanupReceiptSigner({ secret: receiptSecret, clock: readClock, env });

  // R1: only a non-empty trusted OPENID may resolve or provision an account.
  // An empty value never reaches the database, and a payload can never supply it.
  async function resolveAccount(openid) {
    if (typeof openid !== 'string' || openid.length === 0) {
      return null;
    }
    const account = await repository.getOrCreateAccount(openid);
    if (!account || typeof account.id !== 'string' || account.id.length === 0) {
      return null;
    }
    // R2: status is passed through untouched - a disabled account is never revived.
    return { id: account.id, status: account.status };
  }

  // H02 preflight. It provisions the account exactly like resolveAccount (one
  // writer), then reports whether the stored layout can serve journal actions.
  // A legacy row (no journalLayout) stays journalReady: false and is not
  // migrated; H02 must answer NOT_IMPLEMENTED for it.
  async function resolveAccountForJournal(openid) {
    const account = await resolveAccount(openid);
    if (!account) {
      return null;
    }
    const row = typeof readAccount === 'function' ? await readAccount(account.id) : null;
    const layout = row && row.journalLayout === JOURNAL_LAYOUT ? JOURNAL_LAYOUT : null;
    const revision =
      layout !== null && isSafeVersion(row.journalRevision) ? row.journalRevision : null;
    return {
      accountId: account.id,
      status: account.status,
      journalReady: account.status === 'active' && layout !== null && revision !== null,
      journalLayout: layout,
      journalRevision: revision,
    };
  }

  return {
    resolveAccount,
    resolveAccountForJournal,
    resolveOperatorRoles:
      typeof resolveOperatorRoles === 'function'
        ? resolveOperatorRoles
        : async () => notImplemented(),
    // Fail closed: with no secret, verify() returns null for every token, so the
    // router keeps answering FORBIDDEN instead of trusting an unsigned receipt.
    resolveCleanupReceipt: async (token) => signer.verify(token),
    issueCleanupReceipt: (claims) => signer.issue(claims),
    hasReceiptSecret: () => signer.hasSecret(),
    clock: readClock,
  };
}

module.exports = { createAccountAdapters, createAccountReaders, JOURNAL_LAYOUT };
