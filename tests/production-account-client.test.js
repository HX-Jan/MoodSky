const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProductionAccountController,
  PENDING_KEY,
} = require('../miniprogram/modules/account/production');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createApiClient, createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
function fixture(overrides = {}) {
  const storage = new Map();
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  const patches = [];
  const calls = [];
  const service = {
    authenticate: async () => true,
    preferences: async () => ({
      ok: true,
      data: { cardTextPreview: false, decorationsEnabled: true },
    }),
    createPreferences: (payload) => createRequest('account.preferences', payload),
    createExport: (format) => createRequest('account.requestExport', { format }),
    createClose: () => createRequest('account.close', { confirm: 'CLOSE' }),
    submit: async (request) => {
      calls.push(request);
      return { ok: true, data: { jobId: 'synthetic_export', state: 'ready', format: 'json' } };
    },
    recoverClose: async (request, scope) => {
      calls.push({ request, scope });
      return {
        ok: true,
        data: {
          accountStatus: 'disabled',
          cleanup: { jobId: 'synthetic_cleanup', state: 'pending' },
          receipt: 'synthetic_receipt',
        },
      };
    },
    cleanupStatus: async (jobId) => ({
      ok: true,
      data: { jobId, state: 'completed', progress: { journals: 1 } },
    }),
    ...overrides,
  };
  const controller = createProductionAccountController({
    service,
    session: state,
    publish: (patch) => patches.push(patch),
    storage: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
    },
  });
  return { controller, state, service, calls, storage, patches, latest: () => patches.at(-1) };
}
test('production export retries the exact original request after unknown transport outcome', async () => {
  let fail = true;
  const sent = [];
  const f = fixture({
    submit: async (request) => {
      sent.push(request);
      if (fail) {
        throw new AppError('NETWORK_ERROR', '连接未确认');
      }
      return { ok: true, data: { jobId: 'synthetic_export', state: 'ready' } };
    },
  });
  await f.controller.load();
  await f.controller.requestExport('json');
  assert.equal(f.latest().pendingKind, 'export');
  fail = false;
  await f.controller.retry();
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.equal(f.latest().pendingKind, '');
});
test('closure persists its original scope before transmission, clears private state, and resumes progress after reopening', async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.close();
  assert.equal(f.state.capture(), null);
  assert.deepEqual(f.latest().preferences, {});
  const saved = f.storage.get(PENDING_KEY);
  assert.equal(saved.request, f.calls[0].request);
  assert.equal(saved.scope, 'scope_' + 'a'.repeat(64));
  assert.equal(saved.receipt, 'synthetic_receipt');
  await f.controller.cleanupStatus();
  assert.equal(f.latest().closure.state, 'completed');
});
test('an ambiguous closure stays bound to the original account and does not enable another new close', async () => {
  const sent = [];
  let fail = true;
  const f = fixture({
    recoverClose: async (request, scope) => {
      sent.push({ request, scope });
      if (fail) {
        throw new AppError('NETWORK_ERROR', '结果未知');
      }
      return {
        ok: true,
        data: {
          accountStatus: 'disabled',
          cleanup: { jobId: 'synthetic_cleanup', state: 'pending' },
          receipt: 'synthetic_receipt',
        },
      };
    },
  });
  await f.controller.load();
  await f.controller.close();
  assert.equal(f.latest().authenticated, false);
  assert.equal(f.latest().pendingKind, 'close');
  f.state.accept('scope_' + 'b'.repeat(64));
  fail = false;
  await f.controller.retry();
  assert.equal(sent.length, 1);
  await f.controller.load();
  assert.equal(f.latest().authenticated, true);
  assert.equal(f.latest().closure, null);
  f.state.accept('scope_' + 'a'.repeat(64));
  await f.controller.load();
  await f.controller.retry();
  assert.equal(sent[0].request, sent[1].request);
  assert.equal(sent[1].scope, 'scope_' + 'a'.repeat(64));
});
test('disposed production account page ignores a late preference response', async () => {
  let release;
  const f = fixture({
    preferences: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = f.controller.load();
  await Promise.resolve();
  f.controller.dispose();
  const count = f.patches.length;
  release({ ok: true, data: { cardTextPreview: false } });
  await pending;
  assert.equal(f.patches.length, count);
});
test('production transport sends account binding to the formal function and rejects late responses after identity changes', async () => {
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  let sent;
  let release;
  const client = createApiClient(
    {
      cloud: {
        callFunction: (input) => {
          sent = input;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    },
    {
      cloudEnabled: true,
      cloudEnvId: 'synthetic_env',
      cloudFunctionName: 'moodsky',
      releaseProfile: 'production',
    },
    { sessionState: state },
  );
  const request = createRequest('journal.get', { date: '2026-10-30' });
  const pending = client.call(request);
  assert.equal(sent.data.sessionScope, 'scope_' + 'a'.repeat(64));
  state.accept('scope_' + 'b'.repeat(64));
  release({
    result: { apiVersion: '1', requestId: request.requestId, ok: true, data: { entry: null } },
  });
  await assert.rejects(pending, (error) => error.code === 'UNAUTHENTICATED');
});
