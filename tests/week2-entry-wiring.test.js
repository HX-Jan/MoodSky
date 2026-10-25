// Integration keeps production inert and makes member adapters explicit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createAccountTasksAdapters } = require('../tools/week2-integration/account-tasks');
function production() {
  const exports = {};
  let calls = 0;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../cloudfunctions/moodsky/index.js'), 'utf8'),
    {
      exports,
      require(name) {
        if (name === './router') {
          return { createRouter };
        }
        assert.equal(name, 'wx-server-sdk');
        return {
          init() {},
          getWXContext: () => ({ OPENID: 'synthetic_trusted' }),
          database() {
            calls++;
            throw new Error('Database must not open by default');
          },
        };
      },
    },
  );
  return { main: exports.main, calls: () => calls };
}
const request = (action, payload = {}) => ({
  apiVersion: '1',
  requestId: 'req_wiring_default',
  action,
  payload,
});
test('WIRING-01 production health stays available when the SDK exposes a database', async () => {
  const f = production();
  assert.equal((await f.main(request('system.health'))).data.version, '0.2.3');
  assert.equal(f.calls(), 0);
});
test('WIRING-02 production retains account/task write gates after member integration', async () => {
  const f = production();
  for (const [action, payload] of [
    ['account.preferences', { operation: 'set', decorationsEnabled: false }],
    ['account.close', { confirm: 'CLOSE' }],
    ['tasks.transition', { taskId: 'synthetic_task', transition: 'select' }],
  ]) {
    assert.equal((await f.main(request(action, payload))).error.code, 'NOT_IMPLEMENTED');
  }
  assert.equal(f.calls(), 0);
});
test('WIRING-03 incomplete opt-in construction throws instead of creating implicit memory/cloud stores', () => {
  for (const options of [undefined, {}, { store: {}, taskStore: {} }, { repository: {} }]) {
    assert.throws(() => createAccountTasksAdapters(options), TypeError);
  }
});
