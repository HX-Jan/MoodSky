const test = require('node:test');
const assert = require('node:assert/strict');
require('../admin/auth');
const { createClient } = globalThis.MoodSkyAdminAuth;
test('pinned SDK uses manual callback verification once and does not persist or send credentials', async () => {
  let callbacks = 0;
  let config;
  const sdk = {
    init(input) {
      config = input;
      return {
        auth: {
          verifyOAuth: async () => {
            callbacks++;
            return { data: { session: {}, user: { id: 'provider-user' } } };
          },
          getSession: async () => ({ data: { session: {}, user: { id: 'provider-user' } } }),
        },
      };
    },
  };
  const fresh = createClient({
    cloudbase: sdk,
    config: { envId: 'synthetic' },
    location: { href: 'https://example.test/admin/' },
  });
  await fresh.verifyCallback();
  assert.equal(callbacks, 0);
  const callback = createClient({
    cloudbase: sdk,
    config: { envId: 'synthetic' },
    location: { href: 'https://example.test/admin/?code=test&state=test' },
  });
  await callback.verifyCallback();
  assert.equal(callbacks, 1);
  assert.equal(config.auth.detectSessionInUrl, false);
});
test('invalid or expired SDK OAuth result is rejected', async () => {
  for (const method of ['getSession', 'verifyOAuth']) {
    const client = createClient({
      config: { envId: 'synthetic' },
      location: { href: 'https://example.test/?code=bad&state=bad' },
      cloudbase: {
        init: () => ({ auth: { [method]: async () => ({ error: new Error('expired') }) } }),
      },
    });
    await assert.rejects(
      client[method === 'getSession' ? 'session' : 'verifyCallback'](),
      /expired/,
    );
  }
});

test('empty SDK session is treated as signed out', async () => {
  const client = createClient({
    config: { envId: 'synthetic' },
    cloudbase: { init: () => ({ auth: { getSession: async () => ({ data: {} }) } }) },
  });
  assert.equal(await client.session(), null);
});

test('OAuth callback verification is shared and removes only one-time credentials from the URL', async () => {
  let verified = 0;
  let cleaned;
  const client = createClient({
    config: { envId: 'synthetic' },
    location: { href: 'https://example.test/admin/?view=places&code=one-time&state=nonce#place' },
    replaceUrl: (url) => {
      cleaned = url;
    },
    cloudbase: {
      init: () => ({
        auth: {
          verifyOAuth: async () => {
            verified++;
            return { data: { session: {}, user: { id: 'operator' } } };
          },
        },
      }),
    },
  });
  await Promise.all([client.verifyCallback(), client.verifyCallback()]);
  assert.equal(verified, 1);
  assert.equal(cleaned, 'https://example.test/admin/?view=places#place');
});
