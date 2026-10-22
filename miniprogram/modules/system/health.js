const { API_VERSION, APP_VERSION } = require('../../shared/constants');
const { createApiClient, createRequest, call } = require('../../services/api');
async function checkHealth(mode = 'demo', dependencies = {}) {
  const request = createRequest('system.health');
  try {
    const result =
      mode === 'demo'
        ? await createApiClient(
            {
              cloud: {
                async callFunction({ data }) {
                  return {
                    result: {
                      apiVersion: API_VERSION,
                      requestId: data.requestId,
                      ok: true,
                      data: { app: 'MoodSky', version: APP_VERSION, stage: 'local-synthetic' },
                    },
                  };
                },
              },
            },
            { cloudEnabled: true, cloudEnvId: 'synthetic-only' },
          ).call(request)
        : await (dependencies.call || call)(request);
    return {
      mode,
      ok: true,
      apiVersion: result.apiVersion,
      requestId: result.requestId,
      message: result.data.stage || '响应成功',
      version: result.data.version || '',
    };
  } catch (error) {
    return {
      mode,
      ok: false,
      apiVersion: request.apiVersion,
      requestId: request.requestId,
      code: error.code || 'INTERNAL_ERROR',
      message: error.message,
    };
  }
}
module.exports = { checkHealth };
