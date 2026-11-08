const { AppError } = require('../../shared/result');
const { validateRequest } = require('../../shared/validation');
const { CLOUD_FUNCTION_NAME } = require('../../shared/constants');
const { PLACES } = require('../../shared/campus-checkins');
const PREFIX = 'moodsky.campus.manual-pending.v1:';
function createCheckinOutbox(storage, environment) {
  const namespace = JSON.stringify([
    environment.cloudEnabled === true,
    environment.cloudEnvId || '',
    environment.cloudFunctionName || CLOUD_FUNCTION_NAME,
    environment.releaseProfile || '',
  ]);
  const fail = () => {
    throw new AppError('CONFLICT', '本机打卡记录暂时无法确认，请稍后重试。');
  };
  function key(scope) {
    if (typeof scope !== 'string' || !/^scope_[a-f0-9]{64}$/.test(scope)) {
      return fail();
    }
    return PREFIX + encodeURIComponent(namespace) + ':' + scope;
  }
  function requestCopy(request) {
    validateRequest(request);
    if (
      request.action !== 'campus.checkIn' ||
      Object.keys(request.payload).length !== 1 ||
      !PLACES.some((p) => p.placeId === request.payload.placeId)
    ) {
      return fail();
    }
    return Object.freeze({
      apiVersion: request.apiVersion,
      action: request.action,
      requestId: request.requestId,
      payload: Object.freeze({ placeId: request.payload.placeId }),
    });
  }
  function read(scope) {
    const saved = storage.getStorageSync(key(scope));
    if (saved === undefined || saved === '') {
      return null;
    }
    if (
      !saved ||
      saved.version !== 1 ||
      saved.scope !== scope ||
      saved.namespace !== namespace ||
      Object.keys(saved).some((k) => !['version', 'scope', 'namespace', 'request'].includes(k))
    ) {
      return fail();
    }
    return requestCopy(saved.request);
  }
  function purge(scope) {
    storage.removeStorageSync(key(scope));
    if (read(scope) !== null) {
      return fail();
    }
  }
  return {
    read,
    save(scope, request) {
      const copy = requestCopy(request);
      const previous = read(scope);
      if (previous && JSON.stringify(previous) !== JSON.stringify(copy)) {
        return fail();
      }
      storage.setStorageSync(key(scope), { version: 1, scope, namespace, request: copy });
      if (JSON.stringify(read(scope)) !== JSON.stringify(copy)) {
        return fail();
      }
    },
    clear(scope, request) {
      const previous = read(scope);
      if (previous && JSON.stringify(previous) !== JSON.stringify(requestCopy(request))) {
        return fail();
      }
      purge(scope);
    },
    // Account closure may also remove a corrupt entry, only for its exact local scope.
    purge,
  };
}
module.exports = { createCheckinOutbox };
