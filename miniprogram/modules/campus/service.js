const api = require('../../services/api');
module.exports = {
  createPlaceDemo: () => require('./demo-service').createPlaceDemo(),
  listPlaces: (filters = {}) => api.call(api.createRequest('campus.listPlaces', filters)),
  getPlace: (placeId) => api.call(api.createRequest('campus.getPlace', { placeId })),
  supportResources: () => api.call(api.createRequest('campus.supportResources')),
  weatherPreview: () => api.call(api.createRequest('campus.weatherPreview')),
  createFavoriteRequest: (input) => api.createRequest('campus.favorites', input),
  createCorrectionRequest: (input) => api.createRequest('campus.correctPlace', input),
  submit: (request) => api.call(request),
};
