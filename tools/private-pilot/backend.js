const { AppError, notImplemented } = require('../../cloudfunctions/moodsky/shared/result');
const { createRepository } = require('../../cloudfunctions/moodsky/domains/repository');
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const { createCloudJournalRepository } = require('../journal-storage/cloudbase-candidate');
const { createTasksDomain } = require('../../cloudfunctions/moodsky/services/tasks-candidate');
const {
  createTransactionalTasksStore,
  TASK_LAYOUT,
} = require('../../cloudfunctions/moodsky/stores/transactional-tasks');
const { accountScope, pilotIdentity, same } = require('./config');
function createPilotBackend({
  db,
  receiptPolicy,
  scopeKey,
  sessionScope,
  provision = false,
  accountUniqueIndexReady = false,
  now,
} = {}) {
  const accounts = createRepository({
    db,
    accountUniqueIndexReady,
    newAccountJournalLayout: 'deterministic-days-v1',
    newAccountTaskLayout: TASK_LAYOUT,
    newAccountIdentityKind: 'restricted-pilot-hmac-v1',
  });
  const tasks = createTasksDomain({ store: createTransactionalTasksStore({ db }), clock: now });
  const resolveAccount = async (trustedOpenid) => {
    const openid = pilotIdentity(scopeKey, trustedOpenid);
    if (provision) {
      return accounts.getOrCreateAccount(openid);
    }
    const rows = (await db.collection('accounts').where({ openid }).limit(2).get()).data;
    if (!Array.isArray(rows) || rows.length > 1) {
      throw new AppError('CONFLICT', '账号映射尚未确认。');
    }
    const row = rows[0];
    if (!row) {
      return null;
    }
    if (
      typeof row._id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(row._id) ||
      row.openid !== openid ||
      !['active', 'disabled'].includes(row.status)
    ) {
      throw new AppError('CONFLICT', '账号数据尚未确认。');
    }
    if (row.identityKind !== 'restricted-pilot-hmac-v1') {
      return notImplemented();
    }
    if (!same(sessionScope, accountScope(scopeKey, row._id))) {
      throw new AppError('UNAUTHENTICATED', '登录范围已变化，请重新进入。');
    }
    return { id: row._id, status: row.status };
  };
  const router = createCandidateRouter({
    resolveAccount,
    journalRepository: createCloudJournalRepository(db),
    journalReceiptPolicy: receiptPolicy,
    now,
    domainHandlers: {
      async account(request) {
        if (request.action !== 'account.session') {
          return notImplemented();
        }
        if (Object.keys(request.payload).length) {
          throw new AppError('INVALID_INPUT', '登录不接受身份参数。');
        }
        const accountId = request.actor && request.actor.accountId;
        const row = (await db.collection('accounts').doc(accountId).get()).data;
        if (!row || row.status !== 'active') {
          throw new AppError('ACCOUNT_DISABLED', '账号不可用。');
        }
        if (
          row.identityKind !== 'restricted-pilot-hmac-v1' ||
          row.journalLayout !== 'deterministic-days-v1' ||
          row.taskLayout !== TASK_LAYOUT
        ) {
          return notImplemented();
        }
        return {
          authenticated: true,
          scope: accountScope(scopeKey, accountId),
          capabilities: ['journal', 'review', 'tasks'],
        };
      },
      async tasks(request) {
        const data = await tasks.handle(request);
        return request.action === 'tasks.history'
          ? { items: data.entries, nextCursor: data.nextCursor }
          : data;
      },
    },
  });
  return router;
}
module.exports = { createPilotBackend };
