const environment = require('../config/environment.local');
const { API_VERSION, CLOUD_FUNCTION_NAME } = require('../shared/constants');
const { ERROR_CODES } = require('../shared/contracts');
const { AppError } = require('../shared/result');
const { isObject, validateRequest } = require('../shared/validation');
let requestSequence = 0;

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

function createApiClient(platform, config) {
  return {
    async call(request) {
      validateRequest(request);
      if (!config.cloudEnabled || !config.cloudEnvId || !platform || !platform.cloud) {
        throw new AppError(ERROR_CODES.CLOUD_NOT_CONFIGURED, '云服务尚未配置。');
      }
      let response;
      try {
        response = await platform.cloud.callFunction({ name: CLOUD_FUNCTION_NAME, data: request });
      } catch (_error) {
        // Do not auto-retry a write with a new request ID.
        throw new AppError(ERROR_CODES.NETWORK_ERROR, '连接失败，请保留输入并重试原请求。');
      }
      return validateResponse(response && response.result, request);
    },
  };
}

async function call(request) {
  return createApiClient(typeof wx === 'undefined' ? null : wx, environment).call(request);
}
module.exports = { createRequest, createApiClient, call };
