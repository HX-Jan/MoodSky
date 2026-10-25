const api = require('../../services/api');
const { cloudSessionState } = require('../../services/session-state');
const { AppError } = require('../../shared/result');
function createCloudSession({
  state = cloudSessionState,
  authenticate = () => api.call(api.createRequest('account.session')),
} = {}) {
  let sequence = 0;
  let disposed = false;
  return {
    capture: state.capture,
    isCurrent: state.isCurrent,
    subscribe: state.subscribe,
    async refresh() {
      const token = ++sequence;
      try {
        const result = await authenticate();
        if (disposed || token !== sequence) {
          return false;
        }
        if (
          result?.ok !== true ||
          result.data?.authenticated !== true ||
          typeof result.data.scope !== 'string' ||
          !/^scope_[a-f0-9]{64}$/.test(result.data.scope) ||
          !Array.isArray(result.data.capabilities) ||
          !['journal', 'review', 'tasks'].every((x) => result.data.capabilities.includes(x))
        ) {
          throw new AppError('INVALID_RESPONSE', '登录服务响应不兼容。');
        }
        state.accept(result.data.scope);
        return true;
      } catch {
        if (!disposed && token === sequence) {
          state.clear();
        }
        return false;
      }
    },
    dispose() {
      disposed = true;
      sequence++;
    },
  };
}
let shared;
let pending;
async function ensureCloudSession() {
  if (cloudSessionState.capture()) {
    return true;
  }
  if (!shared) {
    shared = createCloudSession();
  }
  if (!pending) {
    pending = shared.refresh().finally(() => {
      pending = null;
    });
  }
  return pending;
}
module.exports = { createCloudSession, ensureCloudSession };
