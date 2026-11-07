const { AppError } = require('../shared/result');
const { DEFAULT_PREFERENCES } = require('../shared/constants');
const { createAccountTransactions } = require('../stores/account-transaction');
const { createSourceRevisionWriter, SOURCE_DOMAINS } = require('../services/account-data');
const { accountId, sessionScope } = require('./config');
const IDENTITY_KIND = 'wechat-hmac-v1';
// The trusted preference writer accepts only the shared preference contract.
// The action validator narrows first (services/account-candidate.js); this guard
// keeps the store seam from silently persisting any future caller's extra keys.
const PREFERENCE_FIELDS = Object.freeze(['cardTextPreview', 'decorationsEnabled']);
const fail = (code = 'CONFLICT') => {
  throw new AppError(code, '账号尚未就绪，请稍后重试。');
};
function checkedPreferencePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AppError('INVALID_INPUT', '偏好字段无效，未保存任何更改。');
  }
  const fields = {};
  for (const key of Object.keys(patch)) {
    if (!PREFERENCE_FIELDS.includes(key) || typeof patch[key] !== 'boolean') {
      throw new AppError('INVALID_INPUT', '偏好字段无效，未保存任何更改。');
    }
    fields[key] = patch[key];
  }
  if (Object.keys(fields).length === 0) {
    throw new AppError('INVALID_INPUT', '偏好字段无效，未保存任何更改。');
  }
  return fields;
}
function createProductionAccounts({ db, config, now = () => new Date() }) {
  async function resolve(openid, provision = false) {
    if (typeof openid !== 'string' || !openid || openid.length > 256) {
      return null;
    }
    const id = accountId(config, openid);
    return db.runTransaction(async (tx) => {
      const ref = tx.collection('accounts').doc(id);
      const stored = (await ref.get()).data;
      if (stored) {
        if (
          stored._id !== id ||
          stored.identityKind !== IDENTITY_KIND ||
          !['active', 'disabled'].includes(stored.status)
        ) {
          return fail();
        }
        return { id, status: stored.status };
      }
      if (!provision) {
        return null;
      }
      const stamp = now().toISOString();
      await ref.set({
        data: {
          // Unique non-null mapping also remains compatible with the existing openid index.
          openid: id,
          identityKind: IDENTITY_KIND,
          status: 'active',
          journalLayout: 'deterministic-days-v1',
          taskLayout: 'deterministic-tasks-v1',
          journalRevision: 0,
          operationFence: 0,
          exportEpoch: 0,
          sourceRevisions: Object.fromEntries(SOURCE_DOMAINS.map((name) => [name, 0])),
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
      return { id, status: 'active' };
    });
  }
  const transactions = createAccountTransactions(db);
  const bump = createSourceRevisionWriter({ db });
  const preferenceId = (ownerId) => 'pref_' + ownerId;
  const store = {
    getPreferences: (ownerId) =>
      transactions.withOwner(ownerId, async () => {
        const row = (
          await transactions
            .transaction(ownerId)
            .collection('preferences')
            .doc(preferenceId(ownerId))
            .get()
        ).data;
        if (row && row.ownerId !== ownerId) {
          return fail();
        }
        return row;
      }),
    updatePreferences: (ownerId, patch, stamp) => {
      const fields = checkedPreferencePatch(patch);
      return transactions.withOwner(ownerId, async () => {
        const tx = transactions.transaction(ownerId);
        const ref = tx.collection('preferences').doc(preferenceId(ownerId));
        const previous = (await ref.get()).data;
        if (previous && previous.ownerId !== ownerId) {
          return fail();
        }
        const saved = { ...DEFAULT_PREFERENCES, ...previous, ...fields, ownerId, updatedAt: stamp };
        delete saved._id;
        await ref.set({ data: saved });
        await bump(ownerId, 'preferences', tx);
        transactions.changed(ownerId);
        return saved;
      });
    },
  };
  async function session(ownerId) {
    // Session discovery is a read. Writing the account fence here makes concurrent
    // first opens contend with each other without protecting a business mutation.
    return db.runTransaction(async (tx) => {
      const row = (await tx.collection('accounts').doc(ownerId).get()).data;
      if (!row || row._id !== ownerId || row.status !== 'active') {
        return fail('ACCOUNT_DISABLED');
      }
      if (
        row.journalLayout !== 'deterministic-days-v1' ||
        row.taskLayout !== 'deterministic-tasks-v1'
      ) {
        return fail();
      }
      return {
        authenticated: true,
        scope: sessionScope(config, ownerId),
        capabilities: ['journal', 'review', 'tasks', 'preferences', 'export', 'close'],
      };
    });
  }
  return { resolve, session, store, transactions };
}
module.exports = { createProductionAccounts, IDENTITY_KIND };
