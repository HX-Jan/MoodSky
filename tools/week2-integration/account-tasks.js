// Local/server construction only. Never imported by the production entry.
const { createIdentityServices } = require('../../cloudfunctions/moodsky/identity');
const { createAccountDomain } = require('../../cloudfunctions/moodsky/services/account-candidate');
const { createTasksDomain } = require('../../cloudfunctions/moodsky/services/tasks-candidate');
const { notImplemented } = require('../../cloudfunctions/moodsky/shared/result');

function createAccountTasksAdapters({ repository, store, taskStore, clock, ...options } = {}) {
  if (!repository || typeof repository.getOrCreateAccount !== 'function' || !store || !taskStore) {
    throw new TypeError(
      'Explicit trusted account repository, account store and task store required.',
    );
  }
  const identity = createIdentityServices({ ...options, repository, store, clock });
  const account = createAccountDomain({
    store,
    clock: identity.clock,
    issueCleanupReceipt: identity.issueCleanupReceipt,
  });
  const tasks = createTasksDomain({ store: taskStore, clock: identity.clock });
  return {
    resolveAccount: identity.resolveAccount,
    resolveOperatorRoles: identity.resolveOperatorRoles,
    resolveCleanupReceipt: identity.resolveCleanupReceipt,
    domainHandlers: {
      account: account.handle,
      async tasks(request) {
        // Keep public suggestions/quickChoice on the existing bounded read path.
        if (!['tasks.transition', 'tasks.history'].includes(request.action)) {
          return notImplemented();
        }
        const data = await tasks.handle(request);
        // Current client reads items; preserve the member's standalone proposal
        // internally without making the current controller accept two schemas.
        return request.action === 'tasks.history'
          ? { items: data.entries, nextCursor: data.nextCursor }
          : data;
      },
    },
  };
}
module.exports = { createAccountTasksAdapters };
