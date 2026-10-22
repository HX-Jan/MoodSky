const api = require('../../services/api');
module.exports = {
  // JH04 identity, operations and idempotency are not an approved live contract yet.
  privateActionsReady: false,
  createPlaceDemo: () => require('./demo-service').createPlaceDemo(),
  createFieldNotePreview: () => require('./field-note-service').createFieldNotePreview(),
  listPlaces: (filters = {}) => api.call(api.createRequest('campus.listPlaces', filters)),
  getPlace: (placeId) => api.call(api.createRequest('campus.getPlace', { placeId })),
  supportResources: () => api.call(api.createRequest('campus.supportResources')),
  weatherPreview: () => api.call(api.createRequest('campus.weatherPreview')),
  listFavorites: () => api.call(api.createRequest('campus.favorites', { operation: 'list' })),
  createFavoriteRequest: (input) => api.createRequest('campus.favorites', input),
  createCorrectionRequest: (input) => api.createRequest('campus.correctPlace', input),
  submit: (request) => api.call(request),
};
