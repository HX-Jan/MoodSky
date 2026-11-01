const { AppError, notImplemented } = require('../shared/result');
const { createCandidateRouter } = require('../candidate-router');
const { createAccountAdapters, createAccountReaders } = require('../services/account-adapters');
const { createAccountDomain } = require('../services/account-candidate');
const {
  createCloudJournalRepository,
} = require('../../../tools/journal-storage/cloudbase-candidate');
const { createTasksDomain } = require('../services/tasks-candidate');
const { createTransactionalTasksStore } = require('../stores/transactional-tasks');
const { createReceiptPolicy } = require('../services/receipt-policy');
const { createTaskSuggestionsService } = require('../services/task-suggestions');
const { createRepositories } = require('../repositories');
const campus = require('../domains/campus');
const { createProductionAccounts } = require('./accounts');
const { createProductionExports } = require('./exports');
const { createProductionCleanup } = require('./cleanup');
const { createProductionProfile } = require('./profile');
function createProductionBackend({ db, config, provision = false, now = () => new Date() }) {
  const accounts = createProductionAccounts({ db, config, now });
  const readers = createAccountReaders({ db });
  const adapters = createAccountAdapters({
    repository: { getOrCreateAccount: (openid) => accounts.resolve(openid, provision) },
    clock: now,
    receiptSecret: config.receiptKey.toString('hex'),
    ...readers,
  });
  const account = createAccountDomain({
    store: accounts.store,
    transactions: accounts.transactions,
    clock: now,
    issueCleanupReceipt: adapters.issueCleanupReceipt,
    readCleanupJob: readers.readCleanupJob,
  });
  const exports = createProductionExports({ db, now });
  const cleanup = createProductionCleanup({ db, now });
  const profile = createProductionProfile({ db, transactions: accounts.transactions, now });
  const tasks = createTasksDomain({
    store: createTransactionalTasksStore({ db, sourceRevisionsEnabled: true }),
    clock: now,
  });
  const publicTasks = createTaskSuggestionsService({
    repository: {
      listEnabled: async ({ limit }) =>
        (
          await db
            .collection('task_templates')
            .where({ enabled: true })
            .orderBy('_id', 'asc')
            .limit(limit)
            .field({
              _id: true,
              title: true,
              steps: true,
              durationMin: true,
              enabled: true,
              tags: true,
            })
            .get()
        ).data,
    },
  });
  const repositories = createRepositories({ database: () => db });
  return createCandidateRouter({
    ...adapters,
    repositories,
    now,
    journalRepository: createCloudJournalRepository(db, { sourceRevisionsEnabled: true }),
    journalReceiptPolicy: createReceiptPolicy({
      activeKeyId: 'production-v1',
      keys: { 'production-v1': config.receiptKey },
      maxAgeMs: 30 * 86400000,
    }),
    domainHandlers: {
      async account(request) {
        if (request.action === 'account.profile') {
          return profile(request);
        }
        if (request.action === 'account.session') {
          if (Object.keys(request.payload).length) {
            throw new AppError('INVALID_INPUT', '登录不接受额外参数。');
          }
          return accounts.session(request.actor.accountId);
        }
        if (
          ['account.requestExport', 'account.exportStatus', 'account.downloadExport'].includes(
            request.action,
          )
        ) {
          return exports(request);
        }
        if (request.action === 'account.cleanupStatus') {
          if (
            Object.keys(request.payload).some((key) => !['jobId', 'receipt'].includes(key)) ||
            request.actor.jobId !== request.payload.jobId
          ) {
            throw new AppError('FORBIDDEN', '清理进度回执无效。');
          }
          return cleanup.step(request.actor.jobId);
        }
        return account.handle(request);
      },
      async tasks(request) {
        if (['tasks.suggestions', 'tasks.quickChoice'].includes(request.action)) {
          return publicTasks(request);
        }
        const data = await tasks.handle(request);
        return request.action === 'tasks.history'
          ? { items: data.entries, nextCursor: data.nextCursor }
          : data;
      },
      campus(request) {
        // Existing campus mutations do not yet share the lifecycle fence. Keep those
        // actions closed; public verified material remains browsable.
        return [
          'campus.listPlaces',
          'campus.getPlace',
          'campus.supportResources',
          'campus.weatherPreview',
        ].includes(request.action)
          ? campus.handle(request)
          : notImplemented();
      },
    },
  });
}
module.exports = { createProductionBackend };
