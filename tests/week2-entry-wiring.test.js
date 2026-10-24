// W2 entry wiring (audit D3) - what index.js does when assembly fails.
// Owner: Jiawei Fang (w2-account). Local doubles only: the entry module is loaded
// in a vm with injected dependencies, so no cloud function or database is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const ENTRY = path.join(repo, 'cloudfunctions/moodsky/index.js');
const realRouter = require(path.join(repo, 'cloudfunctions/moodsky/router'));
const realTasks = require(path.join(repo, 'cloudfunctions/moodsky/domains/tasks'));

const TRUSTED = { OPENID: 'trusted_openid_alpha' };
const request = (action, payload = {}, requestId = 'req_week2_wiring_001') => ({
  apiVersion: '1',
  requestId,
  action,
  payload,
});

function moduleMissing(name) {
  const error = new Error("Cannot find module '" + name + "'");
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

// Loads index.js in a fresh vm context. `handlers` maps a dependency name to a
// module object, a factory (called again on each require, which is how a retry can
// succeed) or an error to throw. Any dependency left unlisted is treated as absent.
function loadEntry({ context = TRUSTED, handlers = {} } = {}) {
  const logs = [];
  const exports = {};
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'synthetic-dynamic-env',
    init() {},
    getWXContext: () => context,
    database: () => ({}),
  };
  vm.runInNewContext(fs.readFileSync(ENTRY, 'utf8'), {
    exports,
    require(name) {
      if (name === 'wx-server-sdk') {
        return sdk;
      }
      if (name === './router') {
        return realRouter;
      }
      if (Object.prototype.hasOwnProperty.call(handlers, name)) {
        const value = handlers[name];
        if (typeof value === 'function') {
          return value();
        }
        if (value instanceof Error) {
          throw value;
        }
        return value;
      }
      throw moduleMissing(name);
    },
    console: {
      log() {},
      error(...items) {
        logs.push(items);
      },
    },
  });
  return { main: exports.main, logs };
}

test('WIRING-01 an absent business module keeps the unwired router and stays quiet', async () => {
  const entry = loadEntry({ handlers: { './identity': moduleMissing('./identity') } });
  const result = await entry.main(request('journal.get', { date: '2026-10-15' }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_IMPLEMENTED');
  assert.deepEqual(entry.logs, []);

  // A package with no business modules at all behaves the same way.
  const bare = loadEntry();
  assert.equal((await bare.main(request('tasks.suggestions'))).error.code, 'NOT_IMPLEMENTED');
  assert.deepEqual(bare.logs, []);
});

test('WIRING-02 a real wiring failure is logged by class and code, then rethrown', async () => {
  const entry = loadEntry({
    handlers: {
      // Every module exists, so this is a real assembly failure, not a missing one.
      './identity': () => ({
        createIdentityServices() {
          const error = new Error('synthetic wiring failure');
          error.name = 'SyntheticWiringError';
          error.code = 'E_WIRING';
          throw error;
        },
      }),
      './domains/account': { createAccountDomain: () => ({ handle: async () => ({}) }) },
      './domains/tasks': realTasks,
      './stores/tasks-store': { createCloudTasksStore: () => ({ listTemplates: async () => [] }) },
    },
  });
  const payload = { date: '2026-10-15' };
  // The platform must see the real failure; answering NOT_IMPLEMENTED would hide it.
  await assert.rejects(
    () => entry.main(request('journal.get', payload)),
    (error) => error.name === 'SyntheticWiringError' && error.code === 'E_WIRING',
  );
  assert.equal(entry.logs.length, 1);
  const logged = JSON.stringify(entry.logs);
  assert.match(logged, /SyntheticWiringError/);
  assert.match(logged, /E_WIRING/);
  // Neither identity nor payload content may reach the log.
  assert.doesNotMatch(logged, /trusted_openid|OPENID|2026-10-15|synthetic-identity-value/);
});

test('WIRING-03 a missing-module fallback is retried, never cached for the process', async () => {
  let attempts = 0;
  const entry = loadEntry({
    handlers: {
      './identity': () => {
        attempts += 1;
        if (attempts === 1) {
          throw moduleMissing('./identity');
        }
        return {
          createIdentityServices: () => ({
            store: {},
            clock: () => new Date('2026-10-24T02:00:00.000Z'),
            resolveAccount: async () => null,
            resolveOperatorRoles: async () => [],
            resolveCleanupReceipt: async () => null,
            issueCleanupReceipt: () => null,
          }),
        };
      },
      './domains/account': { createAccountDomain: () => ({ handle: async () => ({}) }) },
      './domains/tasks': realTasks,
      './stores/tasks-store': { createCloudTasksStore: () => ({ listTemplates: async () => [] }) },
    },
  });
  const first = await entry.main(request('tasks.suggestions'));
  assert.equal(first.error.code, 'NOT_IMPLEMENTED');
  const second = await entry.main(request('tasks.suggestions', {}, 'req_week2_wiring_002'));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(second.data.items, []);
  assert.equal(attempts, 2);
});
