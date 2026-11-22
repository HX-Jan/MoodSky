const { AppError } = require('../shared/result');
const { DEFAULT_PREFERENCES } = require('../shared/constants');
const { createAccountTransactions } = require('../stores/account-transaction');
const { createSourceRevisionWriter, SOURCE_DOMAINS } = require('../services/account-data');
const { accountId, registrationAccountId, sessionScope, same } = require('./config');
const { createHash } = require('node:crypto');
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
  function checked(row, id) {
    if (
      !row ||
      row._id !== id ||
      row.identityKind !== IDENTITY_KIND ||
      !['active', 'disabled'].includes(row.status)
    ) {
      return fail();
    }
    return row;
  }
  function newAccount(stamp) {
    return {
      openid: null,
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
    };
  }
  async function current(tx, openid) {
    const rootId = accountId(config, openid);
    const rootRef = tx.collection('accounts').doc(rootId);
    const root = (await rootRef.get()).data;
    if (!root) {
      return { rootId, rootRef, generation: 0, id: rootId, row: null };
    }
    checked(root, rootId);
    const generation = Object.hasOwn(root, 'registrationGeneration')
      ? root.registrationGeneration
      : 0;
    if (
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      (generation > 0 && root.status !== 'disabled')
    ) {
      return fail();
    }
    const id = registrationAccountId(config, openid, generation);
    const row = generation === 0 ? root : (await tx.collection('accounts').doc(id).get()).data;
    return { rootId, rootRef, generation, id, row: checked(row, id) };
  }
  async function resolve(openid, provision = false) {
    if (typeof openid !== 'string' || !openid || openid.length > 256) {
      return null;
    }
    return db.runTransaction(async (tx) => {
      const { id, row: stored } = await current(tx, openid);
      const ref = tx.collection('accounts').doc(id);
      if (stored) {
        return { id, status: stored.status };
      }
      if (!provision) {
        return null;
      }
      const stamp = now().toISOString();
      await ref.set({
        data: {
          ...newAccount(stamp),
          // The existing unique index stores a derived identifier, never raw OpenID.
          openid: id,
        },
      });
      return { id, status: 'active' };
    });
  }
  async function closedJob(tx, ownerId) {
    const jobId = createHash('sha256')
      .update(JSON.stringify(['cleanup-job', ownerId]))
      .digest('hex')
      .slice(0, 32);
    const job = (await tx.collection('cleanup_jobs').doc(jobId).get()).data;
    return Boolean(
      job &&
      job._id === jobId &&
      job.ownerId === ownerId &&
      job.exportAccessRevoked === true &&
      ['pending', 'processing', 'completed'].includes(job.state),
    );
  }
  async function registration(openid) {
    return db.runTransaction(async (tx) => {
      const { id, row } = await current(tx, openid);
      if (row?.status !== 'disabled' || !(await closedJob(tx, id))) {
        return { canRegister: false };
      }
      return { canRegister: true, previousScope: sessionScope(config, id) };
    });
  }
  async function register(openid, previousScope) {
    return db.runTransaction(async (tx) => {
      const { rootRef, generation, id, row } = await current(tx, openid);
      // A lost registration response or concurrent confirmations converge on the
      // same new account. A confirmation from an older generation cannot reset it.
      if (
        row?.status === 'active' &&
        generation > 0 &&
        same(
          previousScope,
          sessionScope(config, registrationAccountId(config, openid, generation - 1)),
        )
      ) {
        return id;
      }
      if (
        row?.status !== 'disabled' ||
        !same(previousScope, sessionScope(config, id)) ||
        generation >= Number.MAX_SAFE_INTEGER ||
        !(await closedJob(tx, id))
      ) {
        throw new AppError('CONFLICT', '账号状态已变化，请重新使用微信登录。');
      }
      const nextId = registrationAccountId(config, openid, generation + 1);
      const nextRef = tx.collection('accounts').doc(nextId);
      if ((await nextRef.get()).data) {
        return fail();
      }
      const stamp = now().toISOString();
      await nextRef.set({ data: { ...newAccount(stamp), openid: nextId } });
      const updated = await rootRef.update({ data: { registrationGeneration: generation + 1 } });
      if (updated.stats?.updated !== 1) {
        return fail();
      }
      return nextId;
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
  return { resolve, registration, register, session, store, transactions };
}
module.exports = { createProductionAccounts, IDENTITY_KIND };
