const { AppError } = require('../../../shared/result');
// Proposed transport deliberately unavailable until a reviewed backend is wired.
// The client binding is used only for stale-session cancellation, never ownership.
function createTransport(call) {
  const read = async (action, payload, binding, requestId) => {
    if (!binding) {
      throw new AppError('UNAUTHENTICATED', '请先登录。');
    }
    const request = { apiVersion: '1', action, requestId, payload };
    const response = await call(request);
    if (!response || response.requestId !== requestId || response.ok !== true) {
      throw new AppError(
        response?.error?.code || 'INVALID_RESPONSE',
        response?.error?.message || '打卡结果未确认，请重试原请求。',
      );
    }
    return response.data;
  };
  return {
    complete: (request, binding) =>
      read('campus.checkin', request.payload, binding, request.requestId),
    history: (payload, binding) =>
      read(
        'campus.checkinHistory',
        payload,
        binding,
        require('../../../services/api').createRequest('system.health').requestId,
      ),
  };
}
module.exports = { createTransport };
