const { APP_VERSION } = require('./shared/constants');
const { ACTIONS, ERROR_CODES } = require('./shared/contracts');
const { AppError, success, failure, notImplemented } = require('./shared/result');
const {
  REQUEST_ID_PATTERN,
  validateRequest,
  validateJournalInput,
} = require('./shared/validation');
const domains = {
  journal: require('./domains/journal'),
  review: require('./domains/review'),
  campus: require('./domains/campus'),
  tasks: require('./domains/tasks'),
  account: require('./domains/account'),
  admin: require('./domains/admin'),
};
// Implement these adapters against trusted cloud records before enabling private services.
const defaultAdapters = {
  resolveAccount: async () => notImplemented(),
  resolveOperatorRoles: async () => notImplemented(),
  resolveCleanupReceipt: async () => notImplemented(),
  // Campus data access seam (W2 JH01). Left unwired by default: a deployment
  // without repositories answers NOT_IMPLEMENTED instead of inventing material.
  repositories: null,
  // Clock seam. Tests pin it; production reads the real clock. It is a service,
  // not an adapter, so verification windows stay deterministic under test.
  now: () => Date.now(),
};
function createRouter(adapters = {}) {
  const services = { ...defaultAdapters, ...adapters };
  const info = services.deploymentInfo;
  if (
    info &&
    (typeof info.buildId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(info.buildId) ||
      info.phase !== 'pre-filing' ||
      info.publicReleaseEnabled !== false ||
      info.privateBusinessEnabled !== false)
  ) {
    throw new TypeError('Invalid pre-filing deployment marker.');
  }
  const deployment = info
    ? Object.freeze({
        buildId: info.buildId,
        phase: info.phase,
        publicReleaseEnabled: false,
        privateBusinessEnabled: false,
      })
    : null;
  // Server construction only: never derive repositories or clocks from event/payload.
  // The production entry creates the router without these opt-in adapters.
  const handlers = Object.fromEntries(
    Object.entries(domains).map(([name, domain]) => [name, domain.handle]),
  );
  Object.assign(handlers, services.domainHandlers);
  return async (request, trustedContext = {}) => {
    const requestId =
      request && typeof request.requestId === 'string' && REQUEST_ID_PATTERN.test(request.requestId)
        ? request.requestId
        : null;
    try {
      const definition = validateRequest(request);
      let actor = null;
      if (definition.access === 'private' || definition.access === 'operator') {
        if (!trustedContext.OPENID) {
          throw new AppError(ERROR_CODES.UNAUTHENTICATED, '请先登录。');
        }
        const account = await services.resolveAccount(trustedContext.OPENID);
        if (!account || !account.id) {
          throw new AppError(ERROR_CODES.UNAUTHENTICATED, '账号尚未就绪。');
        }
        if (account.status !== 'active') {
          throw new AppError(ERROR_CODES.ACCOUNT_DISABLED, '账号已停用。');
        }
        actor = { accountId: account.id, roles: [] };
        if (definition.access === 'operator') {
          actor.roles = await services.resolveOperatorRoles(account.id);
          if (!Array.isArray(actor.roles) || !actor.roles.includes('data_operator')) {
            throw new AppError(ERROR_CODES.FORBIDDEN, '需要资料维护权限。');
          }
        }
      } else if (definition.access === 'receipt') {
        actor = await services.resolveCleanupReceipt(request.payload.receipt);
        if (!actor || actor.permission !== 'cleanup_status') {
          throw new AppError(ERROR_CODES.FORBIDDEN, '清理进度回执无效。');
        }
      }
      let payload = request.payload;
      if (request.action === 'journal.upsert') {
        payload = validateJournalInput(payload);
      }
      if (request.action === 'system.health') {
        return success(requestId, {
          app: 'MoodSky',
          version: APP_VERSION,
          stage: 'foundation',
          ...(deployment ? { deployment } : {}),
        });
      }
      const handler = handlers[definition.domain];
      let now;
      // Existing journal/task adapters own their clocks. Do not call them twice
      // or turn an unrelated request into a campus clock read.
      if (
        services.repositories &&
        ['campus', 'admin'].includes(definition.domain) &&
        !services.domainHandlers?.[definition.domain] &&
        request.action !== 'campus.weatherPreview'
      ) {
        const clocked = typeof services.now === 'function' ? await services.now() : services.now;
        now = clocked instanceof Date ? clocked.getTime() : clocked;
        if (!Number.isFinite(now) || Math.abs(now) > 8640000000000000) {
          throw new TypeError('Invalid server campus clock.');
        }
      }
      const data = await handler({
        action: request.action,
        payload,
        originalPayload: request.payload,
        actor,
        requestId,
        // Campus data access and the clock are server-supplied only. A deployment
        // without repositories answers NOT_IMPLEMENTED instead of inventing data.
        repositories: services.repositories,
        now,
      });
      return success(requestId, data);
    } catch (error) {
      if (error instanceof AppError) {
        return failure(requestId, error.code, error.message);
      }
      // Private payloads, identity and platform errors must never leak to responses/logs.
      return failure(requestId, ERROR_CODES.INTERNAL_ERROR, '服务暂时不可用，请稍后重试。');
    }
  };
}
module.exports = { createRouter, ACTIONS };
