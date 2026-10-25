// Explicit server candidate. Serializes private operations on the same account
// row used by journal transactions; never initializes a database or migrates rows.
const { AsyncLocalStorage } = require('node:async_hooks');
const { AppError } = require('../shared/result');
function createAccountTransactions(db, { taskLayoutRequired = false } = {}) {
  if (!db || typeof db.runTransaction !== 'function') {
    throw new TypeError('Private stores require transactional storage.');
  }
  const scope = new AsyncLocalStorage();
  const fail = (code) => {
    throw new AppError(code, '账号状态或数据布局尚未满足操作条件。');
  };
  const current = (ownerId) => {
    const value = scope.getStore();
    if (!value || value.ownerId !== ownerId) {
      throw new TypeError('Wrong private transaction scope.');
    }
    return value;
  };
  async function withOwner(ownerId, work) {
    if (typeof ownerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) {
      fail('UNAUTHENTICATED');
    }
    if (scope.getStore()) {
      current(ownerId);
      return work();
    }
    return db.runTransaction(async (tx) => {
      const accountRef = tx.collection('accounts').doc(ownerId);
      const row = (await accountRef.get()).data;
      if (!row || row._id !== ownerId) {
        fail('UNAUTHENTICATED');
      }
      if (row.status !== 'active') {
        fail('ACCOUNT_DISABLED');
      }
      if (row.journalLayout !== 'deterministic-days-v1') {
        fail('NOT_IMPLEMENTED');
      }
      if (taskLayoutRequired && row.taskLayout !== 'deterministic-tasks-v1') {
        fail('NOT_IMPLEMENTED');
      }
      if (
        !['operationFence', 'exportEpoch'].every(
          (k) => Number.isSafeInteger(row[k]) && row[k] >= 0 && row[k] < Number.MAX_SAFE_INTEGER,
        )
      ) {
        fail('CONFLICT');
      }
      const state = { ownerId, tx, changed: false };
      return scope.run(state, async () => {
        const result = await work();
        const update = await accountRef.update({
          data: {
            operationFence: row.operationFence + 1,
            ...(state.changed ? { exportEpoch: row.exportEpoch + 1 } : {}),
          },
        });
        if (update?.stats?.updated !== 1) {
          fail('CONFLICT');
        }
        return result;
      });
    });
  }
  return {
    withOwner,
    transaction: (ownerId) => current(ownerId).tx,
    changed(ownerId) {
      current(ownerId).changed = true;
    },
  };
}
module.exports = { createAccountTransactions };
