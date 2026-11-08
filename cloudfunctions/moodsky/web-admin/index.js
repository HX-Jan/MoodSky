// Separate opt-in deployment candidate. Neither existing cloud entry imports it.
const { createRouter } = require('../router');
const { createAdapters } = require('../adapters');
const { createRepositories } = require('../repositories');
const { validateRequest, REQUEST_ID_PATTERN } = require('../shared/validation');
const { AppError, success, failure } = require('../shared/result');
const { ENV_ID } = require('../production/config');
const READS = Object.freeze([
  'admin.listPlaces',
  'admin.getPlace',
  'admin.listCorrections',
  'admin.listTaskTemplates',
  'admin.listSupportResources',
]);
const WRITES = Object.freeze([
  'admin.updatePlace',
  'admin.reviewCorrection',
  'admin.updateTaskTemplate',
  'admin.updateSupportResource',
]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CONTEXT_KEYS = new Set([
  'TCB_UUID',
  'TCB_ENV',
  'SCF_NAMESPACE',
  'TCB_SOURCE',
  'TCB_ISANONYMOUS_USER',
]);
function readConfig(env = {}) {
  if (env.MOODSKY_WEB_ADMIN_ENABLED !== 'true' || env.MOODSKY_WEB_ADMIN_ENV !== ENV_ID) {
    return null;
  }
  let bindings;
  try {
    bindings = JSON.parse(env.MOODSKY_WEB_ADMIN_BINDINGS || 'null');
  } catch (_error) {
    return null;
  }
  if (!Array.isArray(bindings) || !bindings.length || bindings.length > 20) {
    return null;
  }
  const subjects = new Set(),
    accounts = new Set();
  for (const binding of bindings) {
    if (
      !binding ||
      typeof binding !== 'object' ||
      Array.isArray(binding) ||
      Object.keys(binding).length !== 2 ||
      !Object.hasOwn(binding, 'uid') ||
      !Object.hasOwn(binding, 'accountId') ||
      typeof binding.uid !== 'string' ||
      !ID.test(binding.uid) ||
      typeof binding.accountId !== 'string' ||
      !ID.test(binding.accountId) ||
      subjects.has(binding.uid) ||
      accounts.has(binding.accountId)
    ) {
      return null;
    }
    subjects.add(binding.uid);
    accounts.add(binding.accountId);
  }
  return {
    envId: ENV_ID,
    writes: env.MOODSKY_WEB_ADMIN_WRITES_ENABLED === 'true',
    bindings: new Map(bindings.map(({ uid, accountId }) => [uid, accountId])),
  };
}
function readInvocationFields(context) {
  try {
    let current;
    if (typeof context?.environment === 'string') {
      current = JSON.parse(context.environment);
    } else if (typeof context?.environ === 'string') {
      current = {};
      for (const pair of context.environ.split(';')) {
        const i = pair.indexOf('=');
        if (i < 1) {
          continue;
        }
        const key = pair.slice(0, i);
        if (!CONTEXT_KEYS.has(key)) {
          continue;
        }
        if (Object.hasOwn(current, key)) {
          return null;
        }
        current[key] = pair.slice(i + 1);
      }
    }
    return current && typeof current === 'object' && !Array.isArray(current) ? current : null;
  } catch (_error) {
    return null;
  }
}
function readWebSubject(context, envId) {
  const current = readInvocationFields(context);
  if (!current) {
    return null;
  }
  const environments = [current.TCB_ENV, current.SCF_NAMESPACE, context?.namespace].filter(
    (value) => value !== undefined,
  );
  if (
    !environments.length ||
    environments.some((value) => value !== envId) ||
    typeof current.TCB_UUID !== 'string' ||
    !ID.test(current.TCB_UUID) ||
    current.TCB_SOURCE !== 'web_client' ||
    current.TCB_ISANONYMOUS_USER !== 'false'
  ) {
    return null;
  }
  return Object.freeze({ uid: current.TCB_UUID, envId, source: 'web_client' });
}
function describeSourceFormat(source) {
  const sourceShape =
    source === undefined
      ? 'missing'
      : typeof source === 'string'
        ? source.includes(',')
          ? 'comma_string'
          : 'string'
        : Array.isArray(source)
          ? 'array'
          : 'other';
  const tokens =
    typeof source === 'string' ? source.split(',') : Array.isArray(source) ? source : [];
  const position = tokens.indexOf('web_client');
  return {
    sourceShape,
    webClientPosition:
      position < 0 ? 'absent' : tokens.length === 1 ? 'only' : position === 0 ? 'first' : 'later',
  };
}
function describeWebContext(context, envId) {
  const current = readInvocationFields(context);
  const environments = [current?.TCB_ENV, current?.SCF_NAMESPACE, context?.namespace].filter(
    (value) => value !== undefined,
  );
  const source = current?.TCB_SOURCE;
  const anonymous = current?.TCB_ISANONYMOUS_USER;
  // Fixed categories only: never return raw platform values, subject or credentials.
  return {
    envelope: current
      ? typeof context.environment === 'string'
        ? 'json'
        : 'legacy'
      : 'unavailable',
    uid:
      current?.TCB_UUID === undefined
        ? 'missing'
        : typeof current.TCB_UUID === 'string' && ID.test(current.TCB_UUID)
          ? 'valid_format'
          : 'invalid_format',
    source:
      source === undefined
        ? 'missing'
        : ['web_client', 'wx_client', 'wx_devtools'].includes(source)
          ? source
          : 'other',
    ...describeSourceFormat(source),
    anonymousMarker:
      anonymous === undefined
        ? 'missing'
        : anonymous === 'false'
          ? 'false_string'
          : anonymous === 'true'
            ? 'true_string'
            : anonymous === false
              ? 'false_boolean'
              : anonymous === true
                ? 'true_boolean'
                : 'other',
    environment: !environments.length
      ? 'missing'
      : environments.every((value) => value === envId)
        ? 'match'
        : 'mismatch',
    accepted: Boolean(readWebSubject(context, envId)),
  };
}
function createWebAdminServices(cloud) {
  const db = cloud.database({ throwOnNotFound: false });
  return {
    async resolveAccountById(id) {
      const row = (await db.collection('accounts').doc(id).get())?.data;
      if (!row || row._id !== id) {
        return null;
      }
      return { id: row._id, status: row.status };
    },
    resolveOperatorRoles: createAdapters(cloud).resolveOperatorRoles,
    repositories: createRepositories(cloud),
  };
}
function createWebAdminEntry({
  readConfig: configuration,
  openServices,
  now = () => Date.now(),
  contextDiagnostics = false,
}) {
  return async (event, context) => {
    let requestId = null;
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new AppError('INVALID_REQUEST', '请求格式无效。');
      }
      const request = { ...event };
      // Transport metadata is discarded; identity is read only from platform context.
      delete request.userInfo;
      delete request.tcbContext;
      if (typeof request.requestId === 'string' && REQUEST_ID_PATTERN.test(request.requestId)) {
        requestId = request.requestId;
      }
      validateRequest(request);
      if (
        request.action !== 'system.health' &&
        !READS.includes(request.action) &&
        !WRITES.includes(request.action)
      ) {
        throw new AppError('FORBIDDEN', '此入口仅用于校园资料后台。');
      }
      const config = configuration();
      if (request.action === 'system.health') {
        if (Object.keys(request.payload).length) {
          throw new AppError('INVALID_INPUT', '健康检查不接受额外参数。');
        }
        return success(requestId, {
          stage: 'web-admin-candidate',
          configured: Boolean(config),
          readOnly: !config?.writes,
          ...(contextDiagnostics === true
            ? { contextDiagnostics: describeWebContext(context, ENV_ID) }
            : {}),
        });
      }
      if (!config) {
        throw new AppError('NOT_IMPLEMENTED', 'Web 后台尚未配置完成。');
      }
      const subject = readWebSubject(context, config.envId);
      if (!subject) {
        throw new AppError('UNAUTHENTICATED', '未确认本次 Web 身份。');
      }
      const accountId = config.bindings.get(subject.uid);
      if (!accountId) {
        throw new AppError('FORBIDDEN', 'Web 身份尚未绑定后台账号。');
      }
      if (WRITES.includes(request.action) && !config.writes) {
        throw new AppError('NOT_IMPLEMENTED', '后台处于只读模式。');
      }
      const services = openServices();
      const router = createRouter({
        resolveWebAccount: async (observed) =>
          observed === subject ? services.resolveAccountById(accountId) : null,
        resolveOperatorRoles: services.resolveOperatorRoles,
        repositories: services.repositories,
        now,
      });
      return await router(request, { webSubject: subject });
    } catch (error) {
      return error instanceof AppError
        ? failure(requestId, error.code, error.message)
        : failure(requestId, 'INTERNAL_ERROR', '后台操作结果未确认，请重新读取。');
    }
  };
}
let cloud;
exports.main = async (event, context) =>
  createWebAdminEntry({
    readConfig: () => readConfig(process.env),
    contextDiagnostics: process.env.MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS === 'true',
    openServices: () => {
      if (!cloud) {
        cloud = require('wx-server-sdk');
        cloud.init({ env: ENV_ID });
      }
      return createWebAdminServices(cloud);
    },
  })(event, context);
Object.assign(exports, {
  createWebAdminEntry,
  createWebAdminServices,
  readConfig,
  readWebSubject,
  READS,
  WRITES,
});
