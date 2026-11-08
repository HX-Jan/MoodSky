const test = require('node:test');
const assert = require('node:assert/strict');
require('../admin/auth');
const { createClient } = globalThis.MoodSkyAdminAuth;
const data = { session: {}, user: { id: 'synthetic-user' } };
function fixture(auth, extras = {}) {
  return createClient({
    config: { envId: 'synthetic-only', loginMethod: 'password' },
    cloudbase: { init: () => ({ auth }) },
    ...extras,
  });
}
test('password login sends only credentials to the SDK and never writes app storage or calls business services', async () => {
  const calls = [];
  const client = fixture(
    {
      signInWithPassword: async (input) => {
        calls.push(input);
        return { data };
      },
    },
    {
      storage: {
        setItem() {
          assert.fail('credentials must not be stored');
        },
      },
    },
  );
  assert.deepEqual(
    await client.signInWithPassword({
      username: ' synthetic-user ',
      password: ' synthetic-password ',
    }),
    data,
  );
  assert.deepEqual(calls, [{ username: 'synthetic-user', password: ' synthetic-password ' }]);
});
test('password input must have the configured method and exactly username/password fields', async () => {
  let calls = 0;
  const auth = {
    signInWithPassword: async () => {
      calls++;
      return { data };
    },
  };
  for (const input of [
    null,
    {},
    { username: '', password: 'x' },
    { username: 'u', password: '' },
    { username: 'u', password: 'x', role: 'data_operator' },
  ]) {
    await assert.rejects(fixture(auth).signInWithPassword(input), { code: 'INVALID_LOGIN_INPUT' });
  }
  await assert.rejects(
    fixture(auth, { config: { envId: 'synthetic-only' } }).signInWithPassword({
      username: 'u',
      password: 'x',
    }),
    { code: 'INVALID_LOGIN_INPUT' },
  );
  assert.equal(calls, 0);
});
test('password SDK failures never expose SDK error text, account details, or credentials', async () => {
  for (const throws of [false, true]) {
    const client = fixture({
      signInWithPassword: async () => {
        const error = new Error('synthetic sensitive failure details');
        if (throws) {
          throw error;
        }
        return { data, error };
      },
    });
    await assert.rejects(client.signInWithPassword({ username: 'u', password: 'x' }), {
      message: 'SIGN_IN_FAILED',
      code: 'SIGN_IN_FAILED',
    });
  }
});
test('password login rejects malformed success and does not fall back to OAuth', async () => {
  for (const result of [
    undefined,
    {},
    { data: {} },
    { data: { session: {} } },
    { data: { user: { id: 'u' } } },
    { data: { session: {}, user: { id: 123 } } },
  ]) {
    const client = fixture({
      signInWithPassword: async () => result,
      signInWithOAuth: () => assert.fail('no fallback'),
    });
    await assert.rejects(client.signInWithPassword({ username: 'u', password: 'x' }), {
      code: 'INVALID_RESPONSE',
    });
  }
  await assert.rejects(fixture({}).signInWithPassword({ username: 'u', password: 'x' }), {
    code: 'SDK_PASSWORD_UNAVAILABLE',
  });
});
test('password navigation permits only known local return pages and drops current query credentials', async () => {
  for (const [path, target] of [
    ['places.html?code=synthetic&state=nonce', 'places.html'],
    ['catalogue.html', 'catalogue.html'],
    ['elsewhere.html?returnTo=https://example.invalid', 'index.html'],
  ]) {
    let navigated;
    const client = fixture(
      {},
      {
        location: { href: 'https://example.test/admin/' + path },
        navigate: (url) => {
          navigated = url;
        },
      },
    );
    assert.equal(await client.signIn(), null);
    assert.equal(navigated, 'https://example.test/admin/login.html?returnTo=' + target);
  }
});
test('unknown login method and unavailable navigation fail explicitly', async () => {
  await assert.rejects(fixture({}).signIn(), { code: 'LOGIN_PAGE_UNAVAILABLE' });
  await assert.rejects(
    fixture({}, { config: { envId: 'synthetic-only', loginMethod: 'unknown' } }).signIn(),
    { code: 'INVALID_LOGIN_METHOD' },
  );
});
