const { API_VERSION, APP_VERSION } = require('../../shared/constants');
const { createApiClient, createRequest, call } = require('../../services/api');
const { AppError } = require('../../shared/result');
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
    const deployment = result.data.deployment;
    if (
      deployment !== undefined &&
      (!deployment ||
        typeof deployment.buildId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(deployment.buildId) ||
        deployment.phase !== 'pre-filing' ||
        deployment.publicReleaseEnabled !== false ||
        deployment.privateBusinessEnabled !== false)
    ) {
      throw new AppError('INVALID_RESPONSE', '部署状态格式不兼容，请核对版本。');
    }
    return {
      mode,
      ok: true,
      apiVersion: result.apiVersion,
      requestId: result.requestId,
      message: result.data.stage || '响应成功',
      version: result.data.version || '',
      ...(deployment === undefined
        ? {}
        : {
            deployment: {
              buildId: deployment.buildId,
              phase: deployment.phase,
              publicReleaseEnabled: false,
              privateBusinessEnabled: false,
            },
          }),
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
