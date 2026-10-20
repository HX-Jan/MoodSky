const crypto = require('node:crypto');
const config = require('./config');
const { ERROR_CODES } = require('../../miniprogram/shared/contracts');
const { isObject } = require('../../miniprogram/shared/validation');
const { runSuite, inspectRun, cleanupRun } = require('./suite');

const OPERATIONS = ['identify', 'run', 'inspect', 'cleanup-preview', 'cleanup'];
const RUN_PATTERN = /^h03_[a-z0-9_-]{8,32}$/;
const MESSAGES = {
  INVALID_REQUEST: '验证请求格式无效。',
  FORBIDDEN: '验证入口尚未授权或调用上下文不匹配。',
  CONFLICT: '该测试批次已存在或仍在运行，请先检查状态。',
  INTERNAL_ERROR: '隔离验证未能完成，请保留批次并检查安全报告。',
};

function operatorFingerprint(openid) {
  return crypto
    .createHash('sha256')
    .update('moodsky-h03-operator:' + openid)
    .digest('hex');
}

function fingerprintMatches(actual, expected) {
  return (
    typeof expected === 'string' &&
    /^[a-f0-9]{64}$/.test(expected) &&
    crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  );
}

function validateControlRequest(event) {
  if (
    !isObject(event) ||
    Object.keys(event).some((key) => !['operation', 'runId', 'confirm'].includes(key)) ||
    !OPERATIONS.includes(event.operation) ||
    (event.operation !== 'identify' &&
      (typeof event.runId !== 'string' || !RUN_PATTERN.test(event.runId))) ||
    (event.operation === 'identify' && event.runId !== undefined) ||
    (event.operation !== 'cleanup' && event.confirm !== undefined) ||
    (event.operation === 'cleanup' && event.confirm !== config.cleanupConfirmation)
  ) {
    const error = new Error(MESSAGES.INVALID_REQUEST);
    error.code = ERROR_CODES.INVALID_REQUEST;
    throw error;
  }
}

const DIAGNOSTIC_TAG = 'h03-control-shape-20261014';

function controlDiagnostic(event) {
  const object = isObject(event);
  const keys = object ? Object.keys(event) : [];
  const shownKeys = keys
    .filter((key) => /^[A-Za-z_$][A-Za-z0-9_$]{0,47}$/.test(key))
    .sort()
    .slice(0, 16);
  return {
    buildTag: DIAGNOSTIC_TAG,
    stage: 'control-validation',
    eventType: event === null ? 'null' : Array.isArray(event) ? 'array' : typeof event,
    topLevelKeys: shownKeys,
    fieldCount: keys.length,
    omittedFieldCount: keys.length - shownKeys.length,
    userInfoPresent: object && Object.prototype.hasOwnProperty.call(event, 'userInfo'),
    tcbContextPresent: object && Object.prototype.hasOwnProperty.call(event, 'tcbContext'),
    operationType: object ? typeof event.operation : 'absent',
    operationRecognized: object && OPERATIONS.includes(event.operation),
    runIdType: object ? typeof event.runId : 'absent',
    runIdIsArray: object && Array.isArray(event.runId),
    unexpectedFieldCount: keys.filter(
      (key) => !['operation', 'runId', 'confirm', 'userInfo', 'tcbContext'].includes(key),
    ).length,
    databaseAccessed: false,
  };
}

function traceFixed(adapters, stage) {
  try {
    if (typeof adapters.trace === 'function') {
      adapters.trace(stage);
    }
  } catch {
    // A failed diagnostic sink cannot change validation or authorization.
  }
}

function createProbe(adapters) {
  return async (event) => {
    const receivedEvent = event;
    let controlValidated = false;
    traceFixed(adapters, 'entry');
    try {
      // Transport metadata never supplies identity or control arguments.
      const userInfoMetadataIgnored =
        isObject(event) && Object.prototype.hasOwnProperty.call(event, 'userInfo');
      const tcbContextMetadataIgnored =
        isObject(event) && Object.prototype.hasOwnProperty.call(event, 'tcbContext');
      if (userInfoMetadataIgnored || tcbContextMetadataIgnored) {
        event = Object.fromEntries(
          Object.entries(event).filter(([key]) => !['userInfo', 'tcbContext'].includes(key)),
        );
      }
      validateControlRequest(event);
      controlValidated = true;
      traceFixed(adapters, 'control-accepted');
      const context = adapters.readTrustedContext();
      if (
        !context ||
        context.ENV !== config.environmentId ||
        context.APPID !== config.appId ||
        typeof context.OPENID !== 'string' ||
        !context.OPENID ||
        context.OPENID.length > 256
      ) {
        return { ok: false, error: { code: ERROR_CODES.FORBIDDEN, message: MESSAGES.FORBIDDEN } };
      }
      const fingerprint = operatorFingerprint(context.OPENID);
      // Registration reports only this caller's hash. It never opens the database.
      if (event.operation === 'identify') {
        return {
          ok: true,
          probeVersion: '1',
          operation: 'identify',
          data: {
            operatorFingerprint: fingerprint,
            databaseAccessed: false,
            userInfoMetadataIgnored,
            tcbContextMetadataIgnored,
          },
        };
      }
      if (!fingerprintMatches(fingerprint, adapters.readOperatorFingerprint())) {
        return { ok: false, error: { code: ERROR_CODES.FORBIDDEN, message: MESSAGES.FORBIDDEN } };
      }
      const db = adapters.openDatabase();
      let data;
      if (event.operation === 'run') {
        data = await (adapters.executeSuite || runSuite)(db, event.runId);
      } else if (event.operation === 'cleanup') {
        data = await cleanupRun(db, event.runId);
      } else {
        data = await inspectRun(db, event.runId);
      }
      return { ok: true, probeVersion: '1', operation: event.operation, runId: event.runId, data };
    } catch (error) {
      const code =
        error && Object.prototype.hasOwnProperty.call(MESSAGES, error.code)
          ? error.code
          : ERROR_CODES.INTERNAL_ERROR;
      const response = { ok: false, error: { code, message: MESSAGES[code] } };
      if (!controlValidated && code === ERROR_CODES.INVALID_REQUEST) {
        traceFixed(adapters, 'control-rejected');
        response.diagnostic = controlDiagnostic(receivedEvent);
      } else {
        traceFixed(adapters, 'execution-failed');
      }
      return response;
    }
  };
}

let cloud;
function getCloud() {
  if (!cloud) {
    cloud = require('wx-server-sdk');
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  }
  return cloud;
}

exports.main = createProbe({
  trace: (stage) => console.info('[' + DIAGNOSTIC_TAG + '] ' + stage),
  readTrustedContext: () => getCloud().getWXContext(),
  readOperatorFingerprint: () => process.env[config.operatorSetting],
  openDatabase: () => getCloud().database({ throwOnNotFound: false }),
});
exports.createProbe = createProbe;
exports.operatorFingerprint = operatorFingerprint;
exports.validateControlRequest = validateControlRequest;
