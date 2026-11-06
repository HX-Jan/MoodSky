const { AppError } = require('../../shared/result');
const { validateRequest } = require('../../shared/validation');
const { CLOUD_FUNCTION_NAME } = require('../../shared/constants');
const PREFIX = 'moodsky.tasks.pending.v1:';
const transitions = ['select', 'complete', 'replace', 'skip'];
function createTaskOutbox(storage, environment) {
  const namespace = JSON.stringify([
    environment.cloudEnabled === true,
    environment.cloudEnvId || '',
    environment.cloudFunctionName || CLOUD_FUNCTION_NAME,
    environment.releaseProfile || '',
  ]);
  const fail = () => {
    throw new AppError('CONFLICT', '本机任务记录暂时无法确认，请重新读取。');
  };
  function key(scope) {
    if (typeof scope !== 'string' || !/^scope_[a-f0-9]{64}$/.test(scope)) {
      return fail();
    }
    return PREFIX + encodeURIComponent(namespace) + ':' + scope;
  }
  function copy(request) {
    validateRequest(request);
    const p = request.payload;
    const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
    if (
      request.action !== 'tasks.transition' ||
      !id(p.taskId) ||
      !transitions.includes(p.transition) ||
      Object.keys(p).some((k) => !['taskId', 'transition', 'replacementTaskId'].includes(k)) ||
      (Object.hasOwn(p, 'replacementTaskId') &&
        (p.transition !== 'replace' || !id(p.replacementTaskId)))
    ) {
      return fail();
    }
    return Object.freeze({
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      action: request.action,
      payload: Object.freeze({
        taskId: p.taskId,
        transition: p.transition,
        ...(Object.hasOwn(p, 'replacementTaskId')
          ? { replacementTaskId: p.replacementTaskId }
          : {}),
      }),
    });
  }
  function read(scope) {
    const value = storage.getStorageSync(key(scope));
    if (value === undefined || value === '') {
      return null;
    }
    if (
      !value ||
      value.version !== 1 ||
      value.scope !== scope ||
      value.namespace !== namespace ||
      Object.keys(value).some((k) => !['version', 'scope', 'namespace', 'request'].includes(k))
    ) {
      return fail();
    }
    return copy(value.request);
  }
  function purge(scope) {
    storage.removeStorageSync(key(scope));
    if (read(scope) !== null) {
      return fail();
    }
  }
  return {
    read,
    purge,
    save(scope, request) {
      const requestCopy = copy(request),
        previous = read(scope);
      if (previous && JSON.stringify(previous) !== JSON.stringify(requestCopy)) {
        return fail();
      }
      storage.setStorageSync(key(scope), { version: 1, scope, namespace, request: requestCopy });
      if (JSON.stringify(read(scope)) !== JSON.stringify(requestCopy)) {
        return fail();
      }
    },
    clear(scope, request) {
      const previous = read(scope);
      if (previous && JSON.stringify(previous) !== JSON.stringify(copy(request))) {
        return fail();
      }
      purge(scope);
    },
  };
}
module.exports = { createTaskOutbox };
