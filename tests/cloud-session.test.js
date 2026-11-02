const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createCloudSession } = require('../miniprogram/modules/account/cloud-session');
const { createApiClient, createRequest } = require('../miniprogram/services/api');
const a = 'scope_' + 'a'.repeat(64),
  b = 'scope_' + 'b'.repeat(64);
const reply = (scope) => ({
  ok: true,
  data: { authenticated: true, scope, capabilities: ['journal', 'review', 'tasks'] },
});

test('same server binding preserves pending-request epoch; account change and clear invalidate it', () => {
  const state = createSessionState();
  let changed = 0;
  state.subscribe(() => changed++);
  const first = state.accept(a);
  assert.equal(state.accept(a), first);
  assert.equal(changed, 1);
  state.accept(b);
  assert.equal(state.isCurrent(first), false);
  assert.equal(changed, 2);
  state.clear();
  assert.equal(state.capture(), null);
  assert.equal(changed, 3);
});

test('late and disposed authentication responses cannot replace the latest verified account', async () => {
  const state = createSessionState(),
    pending = [];
  const session = createCloudSession({
    state,
    authenticate: () => new Promise((resolve) => pending.push(resolve)),
  });
  const first = session.refresh(),
    second = session.refresh();
  pending[1](reply(b));
  await second;
  pending[0](reply(a));
  await first;
  assert.equal(state.capture().scope, b);
  const third = session.refresh();
  session.dispose();
  pending[2](reply(a));
  await third;
  assert.equal(state.capture().scope, b);
});

test('failed and malformed authentication clear stale private scope without saving a token', async () => {
  const state = createSessionState();
  state.accept(a);
  const session = createCloudSession({
    state,
    authenticate: async () => ({
      ok: true,
      data: { authenticated: true, scope: {}, capabilities: [] },
    }),
  });
  assert.equal(await session.refresh(), false);
  assert.equal(state.capture(), null);
});

test('pilot retries pin original function, environment, request and account binding across client recreation', async () => {
  const state = createSessionState();
  state.accept(a);
  const sent = [];
  const platform = {
    cloud: {
      async callFunction(options) {
        sent.push(options);
        throw Error('synthetic timeout');
      },
    },
  };
  const request = createRequest('tasks.transition', { taskId: 'task_a', transition: 'select' });
  await assert.rejects(
    createApiClient(
      platform,
      { cloudEnabled: true, cloudEnvId: 'env-a', cloudFunctionName: 'moodsky-private-pilot' },
      { sessionState: state },
    ).call(request),
    { code: 'NETWORK_ERROR' },
  );
  state.accept(b);
  await assert.rejects(
    createApiClient(
      platform,
      { cloudEnabled: true, cloudEnvId: 'env-b' },
      { sessionState: state },
    ).call(request),
    { code: 'NETWORK_ERROR' },
  );
  assert.equal(sent.length, 2);
  for (const call of sent) {
    assert.equal(call.name, 'moodsky-private-pilot');
    assert.equal(call.config.env, 'env-a');
    assert.equal(call.data.request, request);
    assert.equal(call.data.sessionScope, a);
  }
});

test('handshake never reuses old binding and invalid function config never dispatches', async () => {
  const state = createSessionState();
  state.accept(a);
  const sent = [];
  const platform = {
    cloud: {
      async callFunction(options) {
        sent.push(options);
        return {
          result: {
            ok: true,
            apiVersion: '1',
            requestId: options.data.request.requestId,
            data: {},
          },
        };
      },
    },
  };
  const config = {
    cloudEnabled: true,
    cloudEnvId: 'env-a',
    cloudFunctionName: 'moodsky-private-pilot',
  };
  await createApiClient(platform, config, { sessionState: state }).call(
    createRequest('account.session'),
  );
  assert.equal(sent[0].data.sessionScope, undefined);
  await assert.rejects(
    createApiClient(platform, { ...config, cloudFunctionName: 'unrelated-function' }).call(
      createRequest('system.health'),
    ),
    { code: 'CLOUD_NOT_CONFIGURED' },
  );
  assert.equal(sent.length, 1);
});
