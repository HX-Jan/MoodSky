const api = require('../../services/api');
function createPrivateTaskService() {
  return { ...module.exports, suggestions: () => api.call(api.createRequest('tasks.mine')) };
}
module.exports = {
  createPrivateTaskService,
  suggestions: (preferences = {}) => api.call(api.createRequest('tasks.suggestions', preferences)),
  history: (input = {}) => api.call(api.createRequest('tasks.history', input)),
  quickChoice: () => api.call(api.createRequest('tasks.quickChoice')),
  createTransitionRequest: (input) => api.createRequest('tasks.transition', input),
  submit: (request) => api.call(request),
};
