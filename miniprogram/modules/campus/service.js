const api = require('../../services/api');
module.exports = {
  // JH04 identity, operations and idempotency are not an approved live contract yet.
  // W2 JH04 added the backend contract and local tests only; the flag stays false
  // until the interface review approves the operation payload.
  privateActionsReady: false,
  createPlaceDemo: () => require('./demo-service').createPlaceDemo(),
  createFieldNotePreview: () => require('./field-note-service').createFieldNotePreview(),
  listPlaces: (filters = {}) => api.call(api.createRequest('campus.listPlaces', filters)),
  getPlace: (placeId) => api.call(api.createRequest('campus.getPlace', { placeId })),
  // supportResources takes no filter: the backend rejects an unexpected field
  // rather than pretending to filter, so adding a campus filter needs a
  // frontend + contract change in one review.
  supportResources: () => api.call(api.createRequest('campus.supportResources')),
  weatherPreview: () => api.call(api.createRequest('campus.weatherPreview')),
  // campus.favorites is one action with an explicit operation (docs/api.md).
  // These helpers are the only place the client builds that payload.
  listFavorites: (page = 1, pageSize = 10) =>
    api.call(api.createRequest('campus.favorites', { operation: 'list', page, pageSize })),
  addFavorite: (placeId) =>
    api.call(api.createRequest('campus.favorites', { operation: 'add', placeId })),
  removeFavorite: (placeId) =>
    api.call(api.createRequest('campus.favorites', { operation: 'remove', placeId })),
  correctPlace: (placeId, text) =>
    api.call(api.createRequest('campus.correctPlace', { placeId, text })),
  createFavoriteRequest: (input) => api.createRequest('campus.favorites', input),
  createCorrectionRequest: (input) => api.createRequest('campus.correctPlace', input),
  submit: (request) => api.call(request),
};
