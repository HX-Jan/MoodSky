const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const api = require('../../miniprogram/services/api');
const { createReviewReader } = require('../../miniprogram/modules/review/reader');
const { fixture } = require('./backend-fixture');
const { createRouter } = require('../../cloudfunctions/moodsky/router');

function backendClient({ production = false } = {}) {
  const backend = fixture();
  const requests = [];
  let actor = 'a';
  let loseAction = '';
  // Production mode keeps the shipped router (review/journal domains stay NOT_IMPLEMENTED)
  // so tests can assert the explicit blocked state instead of fabricated statistics.
  const activeRouter = production
    ? createRouter({ resolveAccount: async () => ({ id: 'synthetic_a', status: 'active' }) })
    : backend.router;
  const client = api.createApiClient(
    {
      cloud: {
        async callFunction({ data }) {
          requests.push(data);
          const result = await activeRouter(data, { OPENID: actor });
          if (loseAction === data.action) {
            loseAction = '';
            throw new Error('SYNTHETIC response lost after server commit');
          }
          return { result };
        },
      },
    },
    { cloudEnabled: true, cloudEnvId: 'synthetic_no_network' },
  );
  function loadService(relative) {
    const filename = path.resolve(__dirname, '../../miniprogram/modules', relative, 'service.js');
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module,
      require: (id) =>
        id.endsWith('/services/api')
          ? { createRequest: api.createRequest, call: (request) => client.call(request) }
          : localRequire(id),
    });
    return module.exports;
  }
  const journal = loadService('journal');
  const review = loadService('review');
  return {
    ...backend,
    journal,
    review,
    reader: createReviewReader({ journal, review }),
    requests,
    setActor(value) {
      actor = value;
    },
    loseNextResponse(action) {
      loseAction = action;
    },
  };
}
module.exports = { backendClient };
