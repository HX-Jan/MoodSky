// Explicit release candidate entry. The existing deployed foundation entry is untouched.
const { success, failure, AppError } = require('../shared/result');
const { validateRequest, REQUEST_ID_PATTERN } = require('../shared/validation');
const { ACTIONS } = require('../shared/contracts');
const { APP_VERSION } = require('../shared/constants');
const { readInvocationIdentity } = require('../../../tools/private-pilot/invocation');
const { createProductionBackend } = require('./backend');
const { createProductionDatabase } = require('./database');
const { createProductionAccounts } = require('./accounts');
const { createCleanupReceiptSigner } = require('../identity');
const { createHash } = require('node:crypto');
const {
  APP_ID,
  ENV_ID,
  RELEASE_VERSION,
  readServerConfig,
  accountId,
  sessionScope,
  same,
} = require('./config');
function createProductionEntry({
  readIdentity,
  readConfig,
  openDatabase,
  now = () => new Date(),
  tasksWritesEnabled = false,
}) {
  return async (event) => {
    let requestId = null;
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new AppError('INVALID_REQUEST', '请求格式无效。');
      }
      const request = { ...event };
      delete request.userInfo;
      delete request.tcbContext;
      const suppliedScope = request.sessionScope;
      delete request.sessionScope;
      if (typeof request.requestId === 'string' && REQUEST_ID_PATTERN.test(request.requestId)) {
        requestId = request.requestId;
      }
      validateRequest(request);
      const config = readConfig();
      if (request.action === 'system.health') {
        if (Object.keys(request.payload).length) {
          throw new AppError('INVALID_INPUT', '健康检查不接受额外参数。');
        }
        return success(requestId, {
          app: 'MoodSky',
          version: APP_VERSION,
          stage: 'production-candidate',
          releaseVersion: RELEASE_VERSION,
          configured: Boolean(config),
        });
      }
      if (!config) {
        throw new AppError('NOT_IMPLEMENTED', '正式云服务尚未配置完成。');
      }
      const identity = readIdentity();
      if (
        identity?.identityFromCurrentInvocation !== true ||
        identity.APPID !== APP_ID ||
        identity.ENV !== ENV_ID ||
        !['wx_client', 'wx_devtools'].includes(identity.SOURCE) ||
        typeof identity.OPENID !== 'string' ||
        !identity.OPENID ||
        identity.OPENID.length > 256
      ) {
        throw new AppError('FORBIDDEN', '本次调用未携带可信微信身份。');
      }
      const ownerId = accountId(config, identity.OPENID);
      if (
        ACTIONS[request.action].access === 'private' &&
        request.action !== 'account.session' &&
        !same(suppliedScope, sessionScope(config, ownerId))
      ) {
        throw new AppError('UNAUTHENTICATED', '登录范围已变化，请重新登录。');
      }
      const db = openDatabase();
      // An ambiguous close may already have disabled the account. Re-authentication
      // cannot resurrect it; the same authenticated user can recover its one job.
      if (request.action === 'account.close') {
        if (Object.keys(request.payload).length !== 1 || request.payload.confirm !== 'CLOSE') {
          throw new AppError('INVALID_INPUT', '请确认注销操作。');
        }
        const account = await createProductionAccounts({ db, config, now }).resolve(
          identity.OPENID,
        );
        if (account?.status === 'disabled') {
          const jobId = createHash('sha256')
            .update(JSON.stringify(['cleanup-job', ownerId]))
            .digest('hex')
            .slice(0, 32);
          const job = (await db.collection('cleanup_jobs').doc(jobId).get()).data;
          if (!job || job.ownerId !== ownerId || job.exportAccessRevoked !== true) {
            throw new AppError('FORBIDDEN', '无法恢复清理任务。');
          }
          const signer = createCleanupReceiptSigner({
            secret: config.receiptKey.toString('hex'),
            clock: now,
          });
          return success(requestId, {
            accountStatus: 'disabled',
            privateActionsDenied: true,
            sessionRevoked: false,
            sessionRevocation: 'not_implemented',
            cleanup: { jobId, state: job.state },
            receipt: signer.issue({ jobId }),
          });
        }
      }
      const router = createProductionBackend({
        db,
        config,
        now,
        provision: request.action === 'account.session',
        tasksWritesEnabled,
      });
      return router(request, { OPENID: identity.OPENID });
    } catch (error) {
      return error instanceof AppError
        ? failure(requestId, error.code, error.message)
        : failure(requestId, 'INTERNAL_ERROR', '操作结果尚未确认，请保留原请求重试。');
    }
  };
}
let cloud;
exports.main = async (event, platformContext) => {
  if (!cloud) {
    cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
  return createProductionEntry({
    readIdentity: () => readInvocationIdentity(platformContext),
    readConfig: () => readServerConfig(process.env),
    openDatabase: () =>
      createProductionDatabase(require('@cloudbase/node-sdk').init({ env: ENV_ID }).database()),
  })(event);
};
exports.createProductionEntry = createProductionEntry;
