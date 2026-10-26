const environment = require('../config/environment.local');
const { API_VERSION, CLOUD_FUNCTION_NAME } = require('../shared/constants');
const { ERROR_CODES, ACTIONS } = require('../shared/contracts');
const { AppError } = require('../shared/result');
const { isObject, validateRequest } = require('../shared/validation');
const { cloudSessionState } = require('./session-state');
let requestSequence = 0;
// A retry remains in the namespace that received its first dispatch, including
// when the public call helper constructs a fresh client for each attempt.
const requestEnvironments = new WeakMap();
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function createRequest(action, payload = {}) {
  requestSequence += 1;
  const requestId =
    'req_' +
    Date.now().toString(36) +
    '_' +
    requestSequence.toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 10);
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(payload));
  } catch (_error) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, '输入不能序列化。');
  }
  const request = { apiVersion: API_VERSION, requestId, action, payload: copy };
  validateRequest(request);
  return freezeDeep(request);
}

function validateResponse(result, request) {
  if (
    !isObject(result) ||
    result.apiVersion !== API_VERSION ||
    result.requestId !== request.requestId ||
    typeof result.ok !== 'boolean'
  ) {
    throw new AppError(ERROR_CODES.INVALID_RESPONSE, '服务返回格式不兼容。');
  }
  if (result.ok) {
    if (
      !Object.prototype.hasOwnProperty.call(result, 'data') ||
      result.data === undefined ||
      Object.prototype.hasOwnProperty.call(result, 'error')
    ) {
      throw new AppError(ERROR_CODES.INVALID_RESPONSE, '服务未返回结果。');
    }
    return result;
  }
  if (
    Object.prototype.hasOwnProperty.call(result, 'data') ||
    !isObject(result.error) ||
    typeof result.error.code !== 'string' ||
    !Object.values(ERROR_CODES).includes(result.error.code) ||
    typeof result.error.message !== 'string'
  ) {
    throw new AppError(ERROR_CODES.INVALID_RESPONSE, '服务错误格式不兼容。');
  }
  throw new AppError(result.error.code, result.error.message);
}

function createApiClient(platform, config, { sessionState = cloudSessionState } = {}) {
  return {
    async call(request) {
      validateRequest(request);
      if (
        !config ||
        config.cloudEnabled !== true ||
        typeof config.cloudEnvId !== 'string' ||
        !config.cloudEnvId.trim() ||
        !platform ||
        !platform.cloud ||
        typeof platform.cloud.callFunction !== 'function'
      ) {
        throw new AppError(ERROR_CODES.CLOUD_NOT_CONFIGURED, '云服务尚未配置。');
      }
      const timeoutMs =
        config.requestTimeoutMs === undefined
          ? DEFAULT_REQUEST_TIMEOUT_MS
          : config.requestTimeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
        throw new AppError(ERROR_CODES.CLOUD_NOT_CONFIGURED, '云服务等待时限配置无效。');
      }
      if (!requestEnvironments.has(request)) {
        const name =
          config.cloudFunctionName === undefined ? CLOUD_FUNCTION_NAME : config.cloudFunctionName;
        if (!['moodsky', 'moodsky-private-pilot'].includes(name)) {
          throw new AppError(ERROR_CODES.CLOUD_NOT_CONFIGURED, '云函数配置无效。');
        }
        requestEnvironments.set(request, {
          env: config.cloudEnvId,
          name,
          scope:
            request.action === 'account.session' ? null : sessionState.capture()?.scope || null,
        });
      }
      const destination = requestEnvironments.get(request);
      let response;
      let deadlineTimer;
      try {
        const invocation = platform.cloud.callFunction({
          name: destination.name,
          data:
            destination.name === 'moodsky-private-pilot'
              ? { request, ...(destination.scope ? { sessionScope: destination.scope } : {}) }
              : request,
          config: { env: destination.env },
        });
        const deadline = new Promise((_resolve, reject) => {
          deadlineTimer = setTimeout(
            () => reject(new Error('Request wait deadline exceeded')),
            timeoutMs,
          );
        });
        // Stop waiting locally, without claiming cancellation or retrying a server write.
        // Promise.race also consumes a late rejection from the original invocation.
        response = await Promise.race([invocation, deadline]);
      } catch (_error) {
        // Do not auto-retry a write with a new request ID.
        throw new AppError(ERROR_CODES.NETWORK_ERROR, '连接失败，请保留输入并重试原请求。');
      } finally {
        if (deadlineTimer !== undefined) {
          clearTimeout(deadlineTimer);
        }
      }
      return validateResponse(response && response.result, request);
    },
  };
}

async function call(request) {
  const pilot =
    environment.cloudEnabled === true &&
    environment.cloudFunctionName === 'moodsky-private-pilot' &&
    environment.trustedSessionEnabled === true;
  validateRequest(request);
  if (
    pilot &&
    request.action !== 'account.session' &&
    ACTIONS[request.action].access === 'private'
  ) {
    const { ensureCloudSession } = require('../modules/account/cloud-session');
    if (!(await ensureCloudSession())) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, '本人测试账号尚未验证。');
    }
  }
  try {
    return await createApiClient(typeof wx === 'undefined' ? null : wx, environment).call(request);
  } catch (error) {
    if (pilot && ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(error.code)) {
      cloudSessionState.clear();
    }
    throw error;
  }
}
module.exports = { createRequest, createApiClient, call };
