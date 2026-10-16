// ============================================================================
// MoodSky — trusted identity adapters  (W1 JH03, Junhan Huang)
// ============================================================================
// The router (`router.js`) declares three adapter seams and stubs them out with
// notImplemented():
//
//     resolveAccount(openid)          -> { id, status } | null
//     resolveOperatorRoles(accountId) -> string[]
//     resolveCleanupReceipt(receipt)  -> { permission } | null
//
// This file implements ONLY the two that belong to the campus / admin / role
// scope. `resolveCleanupReceipt` is deliberately left out so the router's
// default applies — account closing and cleanup receipts are Jiawei Fang's and
// Xiang Yu's scope, not this module's.
//
// Wiring is NOT done here. `index.js` still calls `createRouter()` with no
// adapters on purpose: connecting this file changes the behaviour of every
// private and operator action, so it belongs in an interface PR together with
// the reviewers named in docs/api.md.
//
// ---------------------------------------------------------------------------
// SCHEMA CONTRACT — STILL UNWIRED
// ---------------------------------------------------------------------------
// Field shapes follow docs/week1/XiangYu/data-dictionary.md sections 1 and 15.
// Real cloud validation and first-login account provisioning remain pending.
//
//   1. accounts.openid          — CONFIRMED by uniqueKeys [["openid"]]
//   2. accounts.status          — the router requires 'active'
//   3. operator_roles.accountId — CONFIRMED by uniqueKeys [["accountId"]]
//   4. operator_roles.role      — singular string, data_operator / moderator
//   5. operator_roles.enabled   — Boolean; only true grants authorise
// ============================================================================

const ACCOUNTS = 'accounts';
const OPERATOR_ROLES = 'operator_roles';
const OPERATOR_ROLE = 'data_operator';

// A single trusted identity maps to at most one account and one role grant, so
// limit(1) is safe and keeps the read cheap.
const SINGLE = 1;

function firstRow(result) {
  return result && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
}

/**
 * Builds the adapter set for the router.
 *
 * @param {object} cloud initialised wx-server-sdk instance (already cloud.init()'d)
 * @returns {{ resolveAccount: Function, resolveOperatorRoles: Function }}
 */
function createAdapters(cloud) {
  if (!cloud || typeof cloud.database !== 'function') {
    throw new TypeError('createAdapters requires an initialised wx-server-sdk instance.');
  }
  const db = cloud.database();

  return {
    /**
     * Maps a trusted WeChat OPENID to an internal account.
     *
     * The OPENID always comes from `cloud.getWXContext()`, never from the
     * request body — `index.js` strips transport metadata before the router
     * sees it. Returning null (rather than throwing) lets the router answer
     * UNAUTHENTICATED with its own fixed message.
     */
    async resolveAccount(openid) {
      if (typeof openid !== 'string' || openid.length === 0) {
        return null;
      }
      const result = await db.collection(ACCOUNTS).where({ openid }).limit(SINGLE).get();
      const account = firstRow(result);
      if (!account) {
        return null;
      }
      return {
        id: account._id,
        // The router rejects anything that is not 'active' with ACCOUNT_DISABLED,
        // which is checked BEFORE the role lookup. A disabled operator therefore
        // fails with ACCOUNT_DISABLED, not FORBIDDEN.
        status: account.status,
      };
    },

    /**
     * Returns the server-side operator roles granted to an account.
     *
     * Roles live only in `operator_roles` (notes: "Server-managed operator
     * roles; client cannot grant roles."). Never read a role from the request.
     *
     * Returning [] — not throwing — produces the router's FORBIDDEN branch for
     * an authenticated account that simply has no grant.
     */
    async resolveOperatorRoles(accountId) {
      if (typeof accountId !== 'string' || accountId.length === 0) {
        return [];
      }
      const result = await db
        .collection(OPERATOR_ROLES)
        .where({ accountId, enabled: true })
        .limit(SINGLE)
        .get();
      const grant = firstRow(result);
      if (!grant || grant.enabled !== true || grant.role !== OPERATOR_ROLE) {
        return [];
      }
      return [OPERATOR_ROLE];
    },
  };
}

module.exports = { createAdapters, OPERATOR_ROLE };
