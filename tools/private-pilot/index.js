const { settings, readPilotConfig, operatorFingerprint, same } = require('./config');
const { createPilotBackend } = require('./backend');
const { createNativeJournalDatabase } = require('../journal-storage/native-database');
const {
  validateRequest,
  REQUEST_ID_PATTERN,
} = require('../../cloudfunctions/moodsky/shared/validation');
const { success, failure, AppError } = require('../../cloudfunctions/moodsky/shared/result');
const { APP_VERSION } = require('../../cloudfunctions/moodsky/shared/constants');
const { readInvocationIdentity } = require('./invocation');
const ALLOWED = new Set([
  'account.session',
  'journal.get',
  'journal.upsert',
  'journal.delete',
  'review.calendar',
  'review.distribution',
  'review.timeline',
  'review.monthArchive',
  'tasks.suggestions',
  'tasks.quickChoice',
  'tasks.mine',
  'tasks.transition',
  'tasks.history',
]);
function createPilotEntry({ readContext, readConfig, openDatabase, now } = {}) {
  return async (event) => {
    let requestId = null;
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new AppError('INVALID_REQUEST', '测试请求格式无效。');
      }
      const transport = { ...event };
      delete transport.userInfo;
      delete transport.tcbContext;
      if (Object.keys(transport).some((k) => !['request', 'sessionScope'].includes(k))) {
        throw new AppError('INVALID_REQUEST', '测试请求包含未知字段。');
      }
      const request = transport.request;
      if (typeof request?.requestId === 'string' && REQUEST_ID_PATTERN.test(request.requestId)) {
        requestId = request.requestId;
      }
      const PILOT_ONLY_ACTIONS = new Set(['account.session', 'tasks.mine']);
      if (!PILOT_ONLY_ACTIONS.has(request.action)) {
        validateRequest(request);
      } else if (!request.payload || typeof request.payload !== 'object') {
        throw new AppError('INVALID_REQUEST', 'payload必须为对象。');
      }
      if (
        transport.sessionScope !== undefined &&
        (typeof transport.sessionScope !== 'string' ||
          !/^scope_[a-f0-9]{64}$/.test(transport.sessionScope))
      ) {
        throw new AppError('INVALID_REQUEST', '登录范围无效。');
      }
      if (request.action === 'account.session' && Object.keys(request.payload).length) {
        throw new AppError('INVALID_INPUT', '登录不接受额外参数。');
      }
      const context = readContext();
      const identityReady =
        context?.identityFromCurrentInvocation === true &&
        context.APPID === settings.appId &&
        context.ENV === settings.environmentId &&
        ['wx_client', 'wx_devtools'].includes(context.SOURCE) &&
        typeof context.OPENID === 'string' &&
        Boolean(context.OPENID);
      const config = readConfig();
      if (request.action === 'system.health') {
        if (
          Object.keys(request.payload).some((key) => key !== 'identify') ||
          (request.payload.identify !== undefined && typeof request.payload.identify !== 'boolean')
        ) {
          throw new AppError('INVALID_INPUT', '测试健康入口参数无效。');
        }
        return success(requestId, {
          app: 'MoodSky',
          version: APP_VERSION,
          stage: 'private-pilot',
          pilot: {
            configured: Boolean(config),
            restrictedToOperator: true,
            publicReleaseEnabled: false,
            identityContextReady: identityReady,
            currentContextParsed: context?.identityFromCurrentInvocation === true,
            appMatched: context?.APPID === settings.appId,
            environmentMatched: context?.ENV === settings.environmentId,
            wechatIdentityPresent: typeof context?.OPENID === 'string' && Boolean(context.OPENID),
            invocationSource:
              typeof context?.SOURCE === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(context.SOURCE)
                ? context.SOURCE
                : 'unavailable',
            ...(request.payload.identify === true
              ? { operatorFingerprint: identityReady ? operatorFingerprint(context.OPENID) : null }
              : {}),
          },
        });
      }
      if (!config) {
        throw new AppError('NOT_IMPLEMENTED', '私人测试尚未配置，未访问业务数据。');
      }
      if (!identityReady) {
        throw new AppError('FORBIDDEN', '测试调用必须携带本次微信身份。');
      }
      if (
        typeof context.OPENID !== 'string' ||
        !context.OPENID ||
        context.OPENID.length > 256 ||
        !same(operatorFingerprint(context.OPENID), config.operatorFingerprint)
      ) {
        throw new AppError('FORBIDDEN', '此测试仅允许已指定账号。');
      }
      if (!ALLOWED.has(request.action)) {
        throw new AppError('NOT_IMPLEMENTED', '本次未开放该业务。');
      }
      if (
        request.action !== 'account.session' &&
        request.action !== 'tasks.mine' &&
        ['private', 'operator'].includes(validateRequest(request).access) &&
        !transport.sessionScope
      ) {
        throw new AppError('UNAUTHENTICATED', '请先验证本人登录范围。');
      }
      if (
        ['journal.upsert', 'journal.delete'].includes(request.action) &&
        request.payload.date !== config.testDate
      ) {
        throw new AppError('INVALID_INPUT', '本次只验证指定测试日期。');
      }
      if (
        request.action === 'journal.upsert' &&
        ((request.payload.text && !String(request.payload.text).startsWith('合成')) ||
          (request.payload.weatherName && !String(request.payload.weatherName).startsWith('合成')))
      ) {
        throw new AppError('INVALID_INPUT', '本次仅接受以合成开头的测试正文或自定义名称。');
      }
      const db = openDatabase();
      const router = createPilotBackend({
        db,
        receiptPolicy: config.receiptPolicy,
        scopeKey: config.scopeKey,
        sessionScope: transport.sessionScope,
        provision: request.action === 'account.session',
        accountUniqueIndexReady: true,
        now,
        trustedOpenid: context.OPENID,
      });
      return router(request, context);
    } catch (error) {
      return error instanceof AppError
        ? failure(requestId, error.code, error.message)
        : failure(requestId, 'INTERNAL_ERROR', '私人测试未确认完成，请保留原请求。');
    }
  };
}
let cloud;
exports.main = async (event, platformContext) => {
  if (!cloud) {
    cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
  const identity = readInvocationIdentity(platformContext);
  return createPilotEntry({
    readContext: () => identity,
    readConfig: () => readPilotConfig(process.env),
    openDatabase: () =>
      createNativeJournalDatabase(
        require('@cloudbase/node-sdk').init({ env: settings.environmentId }).database(),
        { taskHistoryEnabled: true },
      ),
  })(event);
};
exports.createPilotEntry = createPilotEntry;
