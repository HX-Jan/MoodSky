// Explicit release candidate entry. The existing deployed foundation entry is untouched.
const { success, failure, AppError } = require('../shared/result');
const { validateRequest, REQUEST_ID_PATTERN } = require('../shared/validation');
const { ACTIONS } = require('../shared/contracts');
const { APP_VERSION } = require('../shared/constants');
const { readInvocationIdentity } = require('../../../tools/private-pilot/invocation');
const { createProductionBackend } = require('./backend');
const { createProductionDatabase } = require('./database');
const { createProductionAccounts } = require('./accounts');
const { createPhoneLogin } = require('./phone-login');
const { createCleanupReceiptSigner } = require('../identity');
const { createHash } = require('node:crypto');
const {
  APP_ID,
  ENV_ID,
  RELEASE_VERSION,
  readServerConfig,
  sessionScope,
  same,
} = require('./config');
const BUILD_COMMIT = process.env.MOODSKY_BUILD_COMMIT;
function createProductionEntry({
  readIdentity,
  readConfig,
  openDatabase,
  now = () => new Date(),
  tasksWritesEnabled = false,
  exchangePhone,
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
      const phoneSession = request.phoneSession;
      delete request.phoneSession;
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
          ...(/^[a-f0-9]{40}$/.test(BUILD_COMMIT) ? { buildCommit: BUILD_COMMIT } : {}),
          configured: Boolean(config),
          phoneLoginEnabled: config?.phoneLoginEnabled === true,
          campusCheckinWritesPaused: !config || config.campusCheckinWritesPaused === true,
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
      const needsScope =
        ACTIONS[request.action].access === 'private' && request.action !== 'account.session';
      if (
        needsScope &&
        (typeof suppliedScope !== 'string' || !/^scope_[a-f0-9]{64}$/.test(suppliedScope))
      ) {
        throw new AppError('UNAUTHENTICATED', '登录范围已变化，请重新登录。');
      }
      const db = openDatabase();
      const phone = createPhoneLogin({ db, config, now, exchangePhone });
      if (request.action === 'account.phoneLogin') {
        if (!config.phoneLoginEnabled || typeof exchangePhone !== 'function') {
          throw new AppError('NOT_IMPLEMENTED', '手机号登录暂未开放。');
        }
        if (request.payload.mode === 'bind') {
          const primary = await createProductionAccounts({ db, config, now }).resolve(
            identity.OPENID,
          );
          if (phoneSession || !primary || !same(suppliedScope, sessionScope(config, primary.id))) {
            throw new AppError('UNAUTHENTICATED', '请使用微信登录后绑定手机号。');
          }
        }
        return success(requestId, await phone.login(identity.OPENID, request.payload));
      }
      if (phoneSession !== undefined && !config.phoneLoginEnabled) {
        throw new AppError('UNAUTHENTICATED', '手机号登录暂未开放，请使用微信登录。');
      }
      const resolveAccount =
        phoneSession === undefined ? undefined : (openid) => phone.resolve(openid, phoneSession);
      if (request.action === 'account.registration' || request.action === 'account.register') {
        if (phoneSession !== undefined) {
          throw new AppError('UNAUTHENTICATED', '请重新授权手机号后确认注册。');
        }
        const accounts = createProductionAccounts({ db, config, now });
        if (request.action === 'account.registration') {
          if (Object.keys(request.payload).length) {
            throw new AppError('INVALID_INPUT', '注册状态不接受额外参数。');
          }
          return success(requestId, await accounts.registration(identity.OPENID));
        }
        if (
          Object.keys(request.payload).length !== 2 ||
          request.payload.confirm !== 'REGISTER' ||
          typeof request.payload.previousScope !== 'string' ||
          !/^scope_[a-f0-9]{64}$/.test(request.payload.previousScope)
        ) {
          throw new AppError('INVALID_INPUT', '请确认重新注册。');
        }
        const registered = await accounts.register(identity.OPENID, request.payload.previousScope);
        return success(requestId, await accounts.session(registered));
      }
      // An ambiguous close may already have disabled the account. Re-authentication
      // cannot resurrect it; the same authenticated user can recover its one job.
      if (request.action === 'account.close') {
        if (Object.keys(request.payload).length !== 1 || request.payload.confirm !== 'CLOSE') {
          throw new AppError('INVALID_INPUT', '请确认注销操作。');
        }
        const account = resolveAccount
          ? await resolveAccount(identity.OPENID)
          : await createProductionAccounts({ db, config, now }).resolve(identity.OPENID);
        if (!account || !same(suppliedScope, sessionScope(config, account.id))) {
          throw new AppError('UNAUTHENTICATED', '登录范围已变化，请重新登录。');
        }
        if (account?.status === 'disabled') {
          const ownerId = account.id;
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
        resolveAccount,
        ...(needsScope ? { requiredScope: suppliedScope } : {}),
      });
      const response = await router(request, { OPENID: identity.OPENID });
      if (request.action === 'account.session' && response.ok && phoneSession) {
        response.data.phoneSession = phoneSession;
        const account = await phone.resolve(identity.OPENID, phoneSession);
        if (account.phoneLabel) {
          response.data.phoneLabel = account.phoneLabel;
        }
      }
      return response;
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
    exchangePhone: (code) => cloud.openapi.phonenumber.getPhoneNumber({ code }),
    tasksWritesEnabled: process.env.MOODSKY_TASK_WRITES_PAUSED !== 'true',
    openDatabase: () =>
      createProductionDatabase(require('@cloudbase/node-sdk').init({ env: ENV_ID }).database()),
  })(event);
};
exports.createProductionEntry = createProductionEntry;
