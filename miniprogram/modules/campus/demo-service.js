const api = require('../../services/api');
const { success, AppError } = require('../../shared/result');
const { ERROR_CODES } = require('../../shared/contracts');
const { DEMO_PLACES } = require('./demo-places');
const { filterAndPagePlaces } = require('./presentation');

// Explicit local adapter. Never used as an automatic fallback for cloud failures.
function createPlaceDemo() {
  const favoriteIds = new Set();
  const reply = (action, payload, data) => {
    const request = api.createRequest(action, payload);
    return success(request.requestId, { ...data, simulated: true, label: '合成演示' });
  };
  return {
    listPlaces(filters, today) {
      return reply('campus.listPlaces', filters, filterAndPagePlaces(DEMO_PLACES, filters, today));
    },
    listFavorites() {
      return reply('campus.favorites', { operation: 'list' }, { placeIds: Array.from(favoriteIds) });
    },
    setFavorite(placeId, operation) {
      if (!DEMO_PLACES.some((place) => place.placeId === placeId) || !['add', 'remove'].includes(operation)) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, '合成收藏参数无效。');
      }
      if (operation === 'add') {
        favoriteIds.add(placeId);
      } else {
        favoriteIds.delete(placeId);
      }
      return reply('campus.favorites', { placeId, operation }, { placeIds: Array.from(favoriteIds) });
    },
    getPlace(placeId) {
      const place = DEMO_PLACES.find((item) => item.placeId === placeId);
      if (!place) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, '合成地点不存在。');
      }
      return reply('campus.getPlace', { placeId }, { place });
    },
  };
}
module.exports = { createPlaceDemo };
