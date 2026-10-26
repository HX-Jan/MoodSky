// ============================================================================
// MoodSky — trusted identity services  (W2 JF01 / JF04, Jiawei Fang)
// ============================================================================
// Owns exactly two things the router's adapter seams need beyond Junhan's
// adapters.js:
//
//   resolveAccount(openid)         first-login provisioning + read-back on a
//                                  unique-key race (rules R1-R4 of W1 JF01)
//   resolveCleanupReceipt(token)   HMAC-signed, job-bound, expiring receipt
//
// Operator roles stay with adapters.js (Junhan Huang): this module delegates
// createAdapters(cloud).resolveOperatorRoles instead of re-implementing it.
//
// Wiring is done by index.js: createIdentityServices(cloud). The same factory
// accepts { store, clock, receiptSecret } so tests run on an in-memory store
// with a fixed clock and never touch the cloud.
//
// Receipt secret: CLOUD_RECEIPT_SECRET is read from process.env at call time.
// When it is missing, close returns receipt: null and every receipt-gated
// request stays FORBIDDEN (fail closed). Real signing keys are not available
// in this environment, so receipt issuing is documented as 待配置/待复核.
// ============================================================================

const crypto = require('node:crypto');
const { ACCOUNT_STATUS } = require('./shared/constants');
const { notImplemented } = require('./shared/result');
const { createAdapters } = require('./adapters');
const { createAccountStore, isDuplicateKeyError } = require('./stores/account-store');

const RECEIPT_PERMISSION = 'cleanup_status';
const RECEIPT_SECRET_ENV = 'CLOUD_RECEIPT_SECRET';
const RECEIPT_VERSION = 'v1';
// Lifetime is a proposal: W1 JF03 §6.4 leaves expiry and one-time use open.
const RECEIPT_TTL_SECONDS = 15 * 60;

const defaultClock = () => new Date();

function readEnvSecret(env) {
  const source = env || (typeof process !== 'undefined' ? process.env : null);
  const value = source ? source[RECEIPT_SECRET_ENV] : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function signSegment(secret, segment) {
  return crypto.createHmac('sha256', secret).update(segment).digest('base64url');
}

function sameSignature(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * HMAC receipt signer. `secret` overrides the environment for tests; with no
 * override the environment is read on every call so a missing key fails closed
 * instead of remembering an earlier value.
 */
function createCleanupReceiptSigner({ secret, clock = defaultClock, env } = {}) {
  const currentSecret = () =>
    typeof secret === 'string' && secret.length > 0 ? secret : readEnvSecret(env);

  function issue({ jobId } = {}) {
    const activeSecret = currentSecret();
    if (!activeSecret || typeof jobId !== 'string' || jobId.length === 0) {
      return null;
    }
    const claims = {
      p: RECEIPT_PERMISSION,
      j: jobId,
      exp: Math.floor(clock().getTime() / 1000) + RECEIPT_TTL_SECONDS,
    };
    const segment = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return RECEIPT_VERSION + '.' + segment + '.' + signSegment(activeSecret, segment);
  }

  function verify(token) {
    const activeSecret = currentSecret();
    if (!activeSecret || typeof token !== 'string') {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== RECEIPT_VERSION) {
      return null;
    }
    if (!sameSignature(parts[2], signSegment(activeSecret, parts[1]))) {
      return null;
    }
    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (_error) {
      return null;
    }
    if (!claims || typeof claims !== 'object' || claims.p !== RECEIPT_PERMISSION) {
      return null;
    }
    if (typeof claims.j !== 'string' || claims.j.length === 0) {
      return null;
    }
    if (!Number.isInteger(claims.exp) || claims.exp * 1000 <= clock().getTime()) {
      return null;
    }
    return { permission: RECEIPT_PERMISSION, jobId: claims.j };
  }

  return { issue, verify, hasSecret: () => Boolean(currentSecret()) };
}

function toIdentity(account) {
  if (!account || typeof account.id !== 'string' || account.id.length === 0) {
    return null;
  }
  return { id: account.id, status: account.status };
}

/**
 * Builds the identity services used by the router.
 *
 * @param {object} input an initialised wx-server-sdk instance (production) or
 *   { store, clock, receiptSecret, resolveOperatorRoles, repository } (tests).
 *   When a trusted repository (domains/repository.js) is supplied, first-login
 *   provisioning is delegated to it so the account row keeps the W2 fields
 *   (journalLayout/journalRevision/operationFence/exportEpoch) and there is only
 *   one place that writes accounts. The store path stays for the unwired router
 *   and for the focused unit tests.
 */
function createIdentityServices(input = {}) {
  const isCloud = Boolean(input && typeof input.database === 'function');
  const options = isCloud ? { cloud: input } : input || {};
  const store = options.store || createAccountStore({ cloud: options.cloud });
  const clock = options.clock || defaultClock;
  const signer = createCleanupReceiptSigner({
    secret: options.receiptSecret,
    clock,
    env: options.env,
  });
  const resolveOperatorRoles =
    options.resolveOperatorRoles ||
    (options.cloud
      ? createAdapters(options.cloud).resolveOperatorRoles
      : async () => notImplemented());

  const repository =
    options.repository && typeof options.repository.getOrCreateAccount === 'function'
      ? options.repository
      : null;

  async function resolveAccount(openid) {
    // R1: only a non-empty trusted OPENID may resolve or provision an account.
    if (typeof openid !== 'string' || openid.length === 0) {
      return null;
    }
    if (repository) {
      // Delegated path: the repository owns account creation, its unique-index
      // gate (fail closed with NOT_IMPLEMENTED) and the W2 journal fields.
      return toIdentity(await repository.getOrCreateAccount(openid));
    }
    const existing = await store.findAccountByOpenid(openid);
    if (existing) {
      // R2: status is passed through untouched - never revived here.
      return toIdentity(existing);
    }
    const now = clock().toISOString();
    try {
      // R3: server writes the trusted openid and an active status.
      const created = await store.insertAccount({
        openid,
        status: ACCOUNT_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      });
      return toIdentity(created);
    } catch (error) {
      // R4: a lost race on uniq_openid is read back, not surfaced as an error.
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await store.findAccountByOpenid(openid);
      return raced ? toIdentity(raced) : null;
    }
  }

  return {
    store,
    clock,
    resolveAccount,
    resolveOperatorRoles,
    resolveCleanupReceipt: async (token) => signer.verify(token),
    issueCleanupReceipt: (claims) => signer.issue(claims),
  };
}

module.exports = {
  createIdentityServices,
  createCleanupReceiptSigner,
  RECEIPT_PERMISSION,
  RECEIPT_SECRET_ENV,
  RECEIPT_TTL_SECONDS,
};
