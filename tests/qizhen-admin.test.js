const test = require('node:test');
const assert = require('node:assert/strict');

require('../admin/auth.js');
const { createClient, createDemoClient, DEFAULT_CONFIG } = globalThis.MoodSkyAdminAuth;
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
    getSession: async () => ({ data: { user: { uid: 'provider-user' } }, error: null }),
    signInWithOAuth: async () => ({ data: { url: 'https://example.test/login' }, error: null }),
  };
  const app = {
    auth,
    callFunction: async (request) => {
      calls.push(request);
      return { data: { ok: true } };
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

test('real client requires an environment id and keeps SDK version explicit', async () => {
  assert.equal(DEFAULT_CONFIG.provider, 'wechat');
  assert.match(DEFAULT_CONFIG.sdkVersion, /3\.x/);
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
  const callbackSession = { user: { uid: 'provider-user' }, accessToken: 'secret-token' };
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
  });
  assert.deepEqual(await client.verifyCallback(), callbackSession);
  await assert.rejects(client.signOut(), { message: 'sdk-signout-failed' });
  assert.equal(storage.removed, true);
});
