const { readServerConfig, ENV_ID, digest, same } = require('./config');
const { createProductionDatabase } = require('./database');
const { createProductionCleanup } = require('./cleanup');
const { createExportMaintenance } = require('./maintenance');
const { readInvocationIdentity } = require('../../../tools/private-pilot/invocation');
const TIMER_NAME = 'moodsky-maintenance-5m';
function readWorkerIdentity(context) {
  const identity = readInvocationIdentity(context);
  try {
    let triggerSource;
    if (typeof context?.environment === 'string') {
      triggerSource = JSON.parse(context.environment)?.TRIGGER_SRC;
    } else if (typeof context?.environ === 'string') {
      const pairs = context.environ.split(';').filter((pair) => pair.startsWith('TRIGGER_SRC='));
      if (pairs.length > 1) {
        return {};
      }
      triggerSource = pairs[0]?.slice('TRIGGER_SRC='.length);
    }
    return { ...identity, triggerSource: typeof triggerSource === 'string' ? triggerSource : null };
  } catch {
    return {};
  }
}
function timerChecks(event, identity) {
  return {
    freshIdentity: identity?.identityFromCurrentInvocation === true,
    environmentMatches: identity?.ENV === ENV_ID,
    sourceMatches:
      identity?.SOURCE === 'wx_trigger' ||
      (!identity?.SOURCE && identity?.triggerSource === 'timer'),
    noUserIdentity: !identity?.OPENID,
    triggerNameMatches: event?.TriggerName === TIMER_NAME,
  };
}
function createWorkerEntry({ readConfig, readIdentity, openDatabase }) {
  return async (event) => {
    const config = readConfig();
    // Event fields alone are forgeable. Only this invocation's platform context
    // can authorize the scheduler; never consult cached process identity.
    // CloudBase's observed timer envelope does not satisfy SCF's Type='Timer'
    // format. Type is not an authorization credential; fresh source is.
    const identity = readIdentity();
    const timer = Object.values(timerChecks(event, identity)).every(Boolean);
    if (
      !config ||
      identity?.OPENID ||
      (!timer && !same(event?.workerToken, digest(config.receiptKey, 'cleanup-worker-v1', ENV_ID)))
    ) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    try {
      const db = openDatabase();
      const expiredExports = await createExportMaintenance({ db })();
      return { ok: true, expiredExports, ...(await createProductionCleanup({ db }).tick()) };
    } catch {
      return { ok: false, code: 'RETRY_REQUIRED' };
    }
  };
}
exports.main = async (event, context) => {
  const identity = readWorkerIdentity(context);
  const result = await createWorkerEntry({
    readConfig: () => readServerConfig(process.env),
    readIdentity: () => identity,
    openDatabase: () =>
      createProductionDatabase(require('@cloudbase/node-sdk').init({ env: ENV_ID }).database()),
  })(event);
  // Booleans and counts only: no IDs, event payloads, credentials or private content.
  console.info(
    JSON.stringify({
      event: 'moodsky-maintenance',
      ...result,
      checks: timerChecks(event, identity),
    }),
  );
  return result;
};
exports.createWorkerEntry = createWorkerEntry;
exports.TIMER_NAME = TIMER_NAME;
exports.readWorkerIdentity = readWorkerIdentity;
