const { createRouter } = require('./router');

let cloud;
let wiredRouter = null;

function initCloud() {
  if (!cloud) {
    cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
}

// Only a genuinely absent module means "this package has no business modules".
// A constructor that throws, a store that cannot be built or a changed SDK shape
// is a real failure and must surface as one instead of looking unimplemented.
function isMissingModule(error) {
  return Boolean(error) && error.code === 'MODULE_NOT_FOUND';
}

// Account services and the store both need cloud.database(). Without it there
// is nothing to wire, so the shipped default router (NOT_IMPLEMENTED for every
// business action) stays in place instead of failing at require time.
function accountRouter() {
  if (wiredRouter) {
    return wiredRouter;
  }
  if (!cloud || typeof cloud.database !== 'function') {
    return createRouter();
  }
  try {
    const { createIdentityServices } = require('./identity');
    const { createAccountDomain } = require('./domains/account');
    const { createTasksDomain } = require('./domains/tasks');
    const { createCloudTasksStore } = require('./stores/tasks-store');
    const identity = createIdentityServices(cloud);
    wiredRouter = createRouter(
      {
        resolveAccount: identity.resolveAccount,
        // Operator roles remain Junhan's adapters.js semantics; identity only
        // forwards them so both seams share one trusted account lookup.
        resolveOperatorRoles: identity.resolveOperatorRoles,
        resolveCleanupReceipt: identity.resolveCleanupReceipt,
      },
      {
        account: createAccountDomain({
          store: identity.store,
          clock: identity.clock,
          issueCleanupReceipt: identity.issueCleanupReceipt,
        }),
        tasks: createTasksDomain({
          store: createCloudTasksStore({ db: cloud.database() }),
        }),
      },
    );
    return wiredRouter;
  } catch (error) {
    if (isMissingModule(error)) {
      // A package that really lacks the business modules keeps answering with the
      // unwired router rather than pretending a private write succeeded. Nothing is
      // cached, so the next call retries (require has its own module cache).
      return createRouter();
    }
    // Log the failure class and code only: never the payload, the OPENID or any
    // other identity value. Rethrow so the platform reports the real failure.
    console.error('[moodsky] router wiring failed', error && error.name, error && error.code);
    throw error;
  }
}

exports.main = async (event) => {
  initCloud();
  let request = event;
  if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
    request = { ...event };
    // Transport metadata never supplies identity, controls or business input.
    delete request.userInfo;
    delete request.tcbContext;
  }
  // Never get identity from event/payload. Do not log this context.
  return accountRouter()(request, cloud.getWXContext());
};
