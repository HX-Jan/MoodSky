const { API_VERSION, WEATHER_TYPES, CUSTOM_WEATHER, CUSTOM_NAME_MIN, CUSTOM_NAME_MAX, JOURNAL_TAGS, LIMITS } = require('./constants');
const { ACTIONS, ERROR_CODES } = require('./contracts');
const { AppError } = require('./result');
const { isBusinessDate } = require('./date');
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const RESERVED_IDENTITY_FIELDS = [
  'ownerId',
  'owner',
  'openid',
  'OPENID',
  'role',
  'roles',
  'accountId',
];
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function invalid(message, code = ERROR_CODES.INVALID_INPUT) {
  throw new AppError(code, message);
}
function validateRequest(request) {
  if (!isObject(request)) {
    invalid('请求必须为对象。', ERROR_CODES.INVALID_REQUEST);
  }
  const allowed = ['apiVersion', 'requestId', 'action', 'payload'];
  if (Object.keys(request).some((key) => !allowed.includes(key))) {
    invalid('请求包含未约定字段。', ERROR_CODES.INVALID_REQUEST);
  }
  if (typeof request.requestId !== 'string' || !REQUEST_ID_PATTERN.test(request.requestId)) {
    invalid('请求标识格式无效。', ERROR_CODES.INVALID_REQUEST);
  }
  if (request.apiVersion !== API_VERSION) {
    invalid('接口版本不兼容。', ERROR_CODES.API_VERSION_UNSUPPORTED);
  }
  if (typeof request.action !== 'string' || !hasOwn(ACTIONS, request.action)) {
    invalid('接口不存在。', ERROR_CODES.ACTION_NOT_FOUND);
  }
  if (!isObject(request.payload)) {
    invalid('payload必须为对象。', ERROR_CODES.INVALID_REQUEST);
  }
  if (RESERVED_IDENTITY_FIELDS.some((key) => hasOwn(request.payload, key))) {
    invalid('身份与权限由服务端确定。', ERROR_CODES.INVALID_REQUEST);
  }
  return ACTIONS[request.action];
}
function validateJournalInput(payload) {
  if (!isObject(payload)) {
    invalid('记录输入必须为对象。');
  }
  const allowed = ['date', 'weather', 'tags', 'text', 'expectedVersion', 'customName'];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    invalid('记录输入包含未约定字段。');
  }
  if (!isBusinessDate(payload.date)) {
    invalid('日期必须为真实的YYYY-MM-DD日期。');
  }
  const isCustom = payload.weather === CUSTOM_WEATHER.code;
  if (!isCustom && !WEATHER_TYPES.some((item) => item.code === payload.weather)) {
    invalid('请选择七种天气之一或自定义天气。');
  }
  let customName;
  if (isCustom) {
    if (
      typeof payload.customName !== 'string' ||
      Array.from(payload.customName).length < CUSTOM_NAME_MIN ||
      Array.from(payload.customName).length > CUSTOM_NAME_MAX
    ) {
      invalid('自定义天气名称需为1至20个字符。');
    }
    customName = payload.customName;
  } else if (payload.customName !== undefined) {
    invalid('非自定义天气不得携带名称。');
  }
  const tags = payload.tags === undefined ? [] : payload.tags;
  const text = payload.text === undefined ? '' : payload.text;
  if (
    !Array.isArray(tags) ||
    tags.length > LIMITS.journalTags ||
    new Set(tags).size !== tags.length ||
    !tags.every((tag) => JOURNAL_TAGS.some((item) => item.id === tag))
  ) {
    invalid('标签必须为最多5个不同的固定标签。');
  }
  if (typeof text !== 'string' || Array.from(text).length > LIMITS.journalTextCodePoints) {
    invalid('正文不能超过1000个Unicode码点。');
  }
  if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) {
    invalid('请提供expectedVersion；新建为0，编辑为当前版本。');
  }
  return {
    date: payload.date,
    weather: payload.weather,
    ...(customName !== undefined ? { customName } : {}),
    tags: [...tags],
    text,
    expectedVersion: payload.expectedVersion,
  };
}
module.exports = { REQUEST_ID_PATTERN, isObject, validateRequest, validateJournalInput };
