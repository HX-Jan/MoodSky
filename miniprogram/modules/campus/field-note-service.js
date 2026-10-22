const api = require('../../services/api');
const { AppError, success } = require('../../shared/result');
const { ERROR_CODES } = require('../../shared/contracts');
const { LIMITS } = require('../../shared/constants');
const { FIELD_NOTE_PLACES } = require('./field-note-places');
const { filterAndPagePlaces } = require('./presentation');

const PREVIEW_META = Object.freeze({
  preview: true,
  label: '成员提交资料本地预览',
  source: 'week2-local-catalogue',
});

function reply(action, payload, data) {
  const request = api.createRequest(action, payload);
  return success(request.requestId, { ...data, ...PREVIEW_META });
}

function ensurePlace(placeId) {
  const place = FIELD_NOTE_PLACES.find((item) => item.placeId === placeId);
  if (!place) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, '地点参数无效。');
  }
  return place;
}

function createFieldNotePreview() {
  const favoriteIds = new Set();

  return {
    listPlaces(filters = {}, today) {
      return reply(
        'campus.listPlaces',
        filters,
        filterAndPagePlaces(FIELD_NOTE_PLACES, filters, today),
      );
    },

    getPlace(placeId) {
      return reply('campus.getPlace', { placeId }, { place: ensurePlace(placeId) });
    },

    listFavorites() {
      return reply(
        'campus.favorites',
        { operation: 'list' },
        {
          placeIds: Array.from(favoriteIds),
        },
      );
    },

    setFavorite(placeId, operation) {
      ensurePlace(placeId);
      if (!['add', 'remove'].includes(operation)) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, '收藏操作无效。');
      }
      if (operation === 'add') {
        favoriteIds.add(placeId);
      } else {
        favoriteIds.delete(placeId);
      }
      return reply(
        'campus.favorites',
        { operation, placeId },
        {
          placeIds: Array.from(favoriteIds),
        },
      );
    },

    submitCorrection(placeId, content) {
      ensurePlace(placeId);
      const value = typeof content === 'string' ? content : '';
      const length = Array.from(value).length;
      if (length < 1 || length > LIMITS.correctionTextCodePoints || value.trim().length === 0) {
        throw new AppError(ERROR_CODES.INVALID_INPUT, '纠错内容必须为 1—200 个 Unicode 码点。');
      }
      const request = api.createRequest('campus.correctPlace', { placeId, content: value });
      return success(request.requestId, {
        correctionId: `local-${request.requestId}`,
        status: 'pending',
        ...PREVIEW_META,
      });
    },

    supportResources() {
      return reply('campus.supportResources', {}, { items: [], verified: false });
    },
  };
}

module.exports = { createFieldNotePreview, FIELD_NOTE_PLACES };
