const api = require('../../services/api');
module.exports = {
  createPreferencesRequest: (input) => api.createRequest('account.preferences', input),
  createExportRequest: (format) => api.createRequest('account.requestExport', { format }),
  exportStatus: (jobId) => api.call(api.createRequest('account.exportStatus', { jobId })),
  downloadExport: (jobId) => api.call(api.createRequest('account.downloadExport', { jobId })),
  // The server requires an explicit confirmation word; send it instead of an
  // empty payload so the shipped client can actually close an account.
  createClosureRequest: (confirm = 'CLOSE') => api.createRequest('account.close', { confirm }),
  // Progress is bound to one job: the receipt alone cannot name another job.
  cleanupStatus: (jobId, receipt) =>
    api.call(api.createRequest('account.cleanupStatus', { jobId, receipt })),
  submit: (request) => api.call(request),
};
