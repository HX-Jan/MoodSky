const config = require('./config');

// Sources for an explicitly authorized IDE runtime evaluation. Importing/building never invokes wx.
function commandSources() {
  return Object.fromEntries(
    ['prepare', 'workers', 'read', 'inspect'].map((phase) => {
      const requests =
        phase === 'workers'
          ? Array.from({ length: config.workerCount }, (_, worker) => ({
              operation: 'worker',
              runId: config.runId,
              worker,
            }))
          : [{ operation: phase, runId: config.runId }];
      return [
        phase,
        `async function () {
          wx.cloud.init({ env: ${JSON.stringify(config.environmentId)}, traceUser: false });
          const requests = ${JSON.stringify(requests)};
          return Promise.all(requests.map(async data => {
            try {
              const response = await wx.cloud.callFunction({
                name: ${JSON.stringify(config.functionName)},
                data
              });
              return { operation: data.operation, worker: data.worker, state: 'returned', result: response.result };
            } catch (error) {
              return { operation: data.operation, worker: data.worker, state: 'unknown',
                errorCode: typeof error.errCode === 'number' ? error.errCode : 'CALL_FAILED' };
            }
          }));
        }`,
      ];
    }),
  );
}
module.exports = { commandSources };
