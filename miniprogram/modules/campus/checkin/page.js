const { createCheckinController } = require('./controller');
const api = require('../../../services/api');
const { cloudSessionState } = require('../../../services/session-state');
function mountCheckin(page, service) {
  const controller = createCheckinController({
    service,
    pendingStorage: {
      read(binding) {
        try {
          const value = wx.getStorageSync('moodsky.campus.checkin.pending');
          if (
            value?.scope !== binding.scope ||
            !/^req_[A-Za-z0-9_-]{1,100}$/.test(value.request?.requestId || '') ||
            typeof value.request?.payload?.placeId !== 'string'
          ) {
            return null;
          }
          return value.request;
        } catch {
          return null;
        }
      },
      write(binding, request) {
        if (typeof wx.setStorageSync === 'function') {
          wx.setStorageSync('moodsky.campus.checkin.pending', { scope: binding.scope, request });
        }
      },
      clear() {
        if (typeof wx.removeStorageSync === 'function') {
          wx.removeStorageSync('moodsky.campus.checkin.pending');
        }
      },
    },
    createRequest: (placeId) => ({
      requestId: api.createRequest('system.health').requestId,
      payload: { placeId },
    }),
    onChange: (state) => {
      const placeId = page.data.selectedPlace?.placeId;
      page.setData({
        checkinState: state.status,
        checkinError: state.error,
        checkinHistory: state.visits,
        checkinDone: state.visits.some(
          (v) => v.placeId === placeId && v.date === require('../../../shared/date').businessDate(),
        ),
      });
    },
  });
  controller.session(cloudSessionState.capture());
  return controller;
}
module.exports = { mountCheckin };
