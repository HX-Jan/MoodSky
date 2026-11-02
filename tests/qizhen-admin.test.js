const test = require('node:test');
const assert = require('node:assert/strict');

require('../admin/auth.js');
const { createClient, createDemoClient, DEFAULT_CONFIG } = globalThis.MoodSkyAdminAuth;
const { validateApiEnvelope: validateAdminResponse } = globalThis.MoodSkyAdminAuth;
const { createRouter } = require('../cloudfunctions/moodsky/router');

const request = (action, payload = {}) => ({
  apiVersion: '1',
  requestId: 'req_qizhen_001',
  action,
  payload,
});

test('admin demo keeps browsing and server-authorized writes separate', async () => {
  const student = createDemoClient({ role: 'student' });
  assert.equal(await student.session(), null);
  await student.signIn();
  await assert.rejects(student.call('admin.updatePlace', { name: 'synthetic' }), {
    message: 'FORBIDDEN',
  });

  const operator = createDemoClient();
  await operator.signIn();
  const result = await operator.call('admin.updatePlace', { name: 'synthetic' });
  assert.deepEqual(result.data, {
    simulated: true,
    action: 'admin.updatePlace',
    payload: { name: 'synthetic' },
  });
  await operator.signOut();
  await assert.rejects(operator.call('admin.updatePlace'), { message: 'UNAUTHENTICATED' });
});

test('disabled operator is denied even after a successful login', async () => {
  const client = createDemoClient({ role: 'data_operator', status: 'disabled' });
  await client.signIn();
  await assert.rejects(client.call('admin.reviewCorrection'), { message: 'ACCOUNT_DISABLED' });
});

test('router authorizes only an active server-resolved data operator', async () => {
  const authorized = createRouter({
    resolveAccount: async () => ({ id: 'operator_a', status: 'active' }),
    resolveOperatorRoles: async () => ['data_operator'],
  });
  assert.equal(
    (await authorized(request('admin.updatePlace'), { OPENID: 'trusted-web-context' })).error.code,
    'NOT_IMPLEMENTED',
  );
  const disabled = createRouter({
    resolveAccount: async () => ({ id: 'operator_a', status: 'disabled' }),
    resolveOperatorRoles: async () => ['data_operator'],
  });
  assert.equal(
    (await disabled(request('admin.updatePlace'), { OPENID: 'trusted-web-context' })).error.code,
    'ACCOUNT_DISABLED',
  );
});

test('real client sends only business payload to the cloud function', async () => {
  const calls = [];
  const auth = {
    getSession: async () => ({
      data: { session: {}, user: { uid: 'provider-user' } },
      error: null,
    }),
    signInWithOAuth: async () => ({ data: { url: 'https://example.test/login' }, error: null }),
  };
  const app = {
    auth,
    callFunction: async (request) => {
      calls.push(request);
      return {
        result: {
          apiVersion: '1',
          requestId: request.data.requestId,
          ok: true,
          data: { updated: true },
        },
      };
    },
  };
  const client = createClient({
    cloudbase: { init: () => app },
    config: { envId: 'synthetic-env' },
  });
  await client.call('admin.updateTaskTemplate', { title: 'synthetic' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].data.payload, { title: 'synthetic' });
  assert.equal(Object.hasOwn(calls[0].data.payload, 'OPENID'), false);
  assert.equal(Object.hasOwn(calls[0].data.payload, 'ownerId'), false);
  assert.equal(Object.hasOwn(calls[0].data.payload, 'uid'), false);
  assert.equal(Object.hasOwn(calls[0].data.payload, 'roles'), false);
});

test('real client returns only a correlated success envelope', async () => {
  const calls = [];
  const client = createClient({
    cloudbase: {
      init: () => ({
        auth: {},
        callFunction: async (request) => {
          calls.push(request);
          return {
            result: {
              apiVersion: '1',
              requestId: request.data.requestId,
              ok: true,
              data: { saved: true },
            },
          };
        },
      }),
    },
    config: { envId: 'synthetic-env' },
  });
  const result = await client.call('admin.updatePlace', { name: 'synthetic' });
  assert.deepEqual(result, {
    apiVersion: '1',
    requestId: calls[0].data.requestId,
    ok: true,
    data: { saved: true },
  });
});

test('real client maps business failures and preserves the request correlation', async () => {
  for (const code of ['FORBIDDEN', 'ACCOUNT_DISABLED', 'UNAUTHENTICATED', 'NOT_IMPLEMENTED']) {
    let sentRequest;
    const client = createClient({
      cloudbase: {
        init: () => ({
          auth: {},
          callFunction: async (request) => {
            sentRequest = request;
            return {
              result: {
                apiVersion: '1',
                requestId: request.data.requestId,
                ok: false,
                error: { code, message: 'synthetic ' + code },
              },
            };
          },
        }),
      },
      config: { envId: 'synthetic-env' },
    });
    await assert.rejects(client.call('admin.updatePlace'), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.equal(error.requestId, sentRequest.data.requestId);
      return true;
    });
  }
});

test('real client rejects malformed, stale, or uncorrelated API envelopes', async () => {
  const cases = [
    { apiVersion: '2', requestId: 'will-be-replaced', ok: true, data: {} },
    { apiVersion: '1', requestId: 'different-request', ok: true, data: {} },
    { apiVersion: '1', ok: true, data: {} },
    { apiVersion: '1', requestId: 'req_valid_001', error: { code: 'FORBIDDEN', message: 'no' } },
    {
      apiVersion: '1',
      requestId: 'req_valid_001',
      ok: false,
      error: { code: 'FORBIDDEN' },
    },
  ];
  for (const envelope of cases) {
    const client = createClient({
      cloudbase: {
        init: () => ({
          auth: {},
          callFunction: async () => ({ result: envelope }),
        }),
      },
      config: { envId: 'synthetic-env' },
    });
    await assert.rejects(client.call('admin.updatePlace'), (error) => {
      assert.equal(error.code, 'INVALID_RESPONSE');
      return true;
    });
  }
});

test('network failures become correlated business errors', async () => {
  const client = createClient({
    cloudbase: {
      init: () => ({
        auth: {},
        callFunction: async () => {
          throw new Error('synthetic network down');
        },
      }),
    },
    config: { envId: 'synthetic-env' },
  });
  await assert.rejects(client.call('admin.updatePlace'), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.message, 'NETWORK_ERROR');
    assert.match(error.requestId, /^admin_/);
    return true;
  });
});

test('admin response guard allows success and rejects failure without a success path', () => {
  const success = {
    apiVersion: '1',
    requestId: 'req_app_success_001',
    ok: true,
    data: { saved: true },
  };
  assert.equal(validateAdminResponse(success), success);
  assert.throws(
    () =>
      validateAdminResponse({
        apiVersion: '1',
        requestId: 'req_app_forbidden_001',
        ok: false,
        error: { code: 'FORBIDDEN', message: 'synthetic denied' },
      }),
    (error) => {
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.requestId, 'req_app_forbidden_001');
      return true;
    },
  );
  assert.throws(
    () =>
      validateAdminResponse({ apiVersion: '1', requestId: 'req_app_bad_001', ok: true, error: {} }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
});

test('real client requires an environment id and keeps SDK version explicit', async () => {
  assert.equal(DEFAULT_CONFIG.provider, 'wechat');
  assert.equal(DEFAULT_CONFIG.sdkVersion, '3.4.8');
  await assert.rejects(createClient({ cloudbase: { init: () => ({}) } }).session(), {
    message: 'Missing CloudBase environment id.',
  });
});

test('real client verifies an OAuth callback without persisting the session token', async () => {
  const storage = {
    removed: false,
    removeItem() {
      this.removed = true;
    },
  };
  const callbackSession = {
    user: { uid: 'provider-user' },
    session: { access_token: 'secret-token' },
  };
  const auth = {
    verifyOAuth: async () => ({ data: callbackSession, error: null }),
    getSession: async () => ({ data: callbackSession, error: null }),
    signOut: async () => {
      throw new Error('sdk-signout-failed');
    },
  };
  const client = createClient({
    cloudbase: { init: () => ({ auth }) },
    config: { envId: 'synthetic-env' },
    storage,
    location: { href: 'https://example.test/admin?code=synthetic&state=synthetic' },
  });
  assert.deepEqual(await client.verifyCallback(), callbackSession);
  await assert.rejects(client.signOut(), { message: 'sdk-signout-failed' });
  assert.equal(storage.removed, true);
});
