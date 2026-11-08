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

test('only the separate Web admin candidate selects the pinned SDK CLOUD_API transport', () => {
  const { createCloudBaseApp } = globalThis.MoodSkyAdminAuth;
  for (const functionName of [undefined, 'moodsky', 'moodsky-web-admin']) {
    let observed;
    const marker = {};
    const result = createCloudBaseApp(
      {
        init: (input) => {
          observed = input;
          return marker;
        },
      },
      {
        envId: 'synthetic_environment',
        region: 'ap-shanghai',
        functionName,
        publishableKey: 'synthetic_publishable_key',
        endPointMode: 'GATEWAY',
      },
    );
    assert.equal(result, marker);
    assert.equal(observed.env, 'synthetic_environment');
    assert.equal(observed.region, 'ap-shanghai');
    assert.equal(observed.accessKey, 'synthetic_publishable_key');
    assert.equal(observed.auth.detectSessionInUrl, false);
    if (functionName === 'moodsky-web-admin') {
      assert.equal(observed.endPointMode, 'CLOUD_API');
    } else {
      assert.equal(Object.hasOwn(observed, 'endPointMode'), false);
    }
  }
});

test('candidate password session and business request share one transport without forwarding credentials or identity', async () => {
  let initialized = 0;
  const calls = [];
  const credentials = { username: 'synthetic_user', password: 'synthetic_password' };
  const session = { session: {}, user: { id: 'synthetic_uid' } };
  const client = createClient({
    config: { envId: 'synthetic', functionName: 'moodsky-web-admin', loginMethod: 'password' },
    cloudbase: {
      init(config) {
        initialized++;
        assert.equal(config.endPointMode, 'CLOUD_API');
        return {
          auth: {
            signInWithPassword: async (input) => {
              assert.deepEqual(input, credentials);
              return { data: session };
            },
            getSession: async () => ({ data: session }),
          },
          callFunction: async (input) => {
            calls.push(input);
            return {
              result: {
                apiVersion: '1',
                requestId: input.data.requestId,
                ok: false,
                error: { code: 'FORBIDDEN', message: 'synthetic role denial' },
              },
            };
          },
        };
      },
    },
  });
  assert.deepEqual(await client.signInWithPassword(credentials), session);
  assert.deepEqual(await client.session(), session);
  await assert.rejects(client.call('admin.listPlaces', { page: 1, pageSize: 1 }), {
    code: 'FORBIDDEN',
  });
  assert.equal(initialized, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'moodsky-web-admin');
  assert.deepEqual(Object.keys(calls[0].data).sort(), [
    'action',
    'apiVersion',
    'payload',
    'requestId',
  ]);
  assert.deepEqual(calls[0].data.payload, { page: 1, pageSize: 1 });
  assert.equal(JSON.stringify(calls).includes('synthetic_password'), false);
  assert.equal(JSON.stringify(calls).includes('synthetic_uid'), false);
});

test('candidate transport errors remain failures without switching channels or replaying an operation', async () => {
  let initialized = 0,
    sent = 0;
  const client = createClient({
    config: { envId: 'synthetic', functionName: 'moodsky-web-admin' },
    cloudbase: {
      init(config) {
        initialized++;
        assert.equal(config.endPointMode, 'CLOUD_API');
        return {
          auth: {},
          callFunction: async () => {
            sent++;
            throw Error('synthetic network failure');
          },
        };
      },
    },
  });
  await assert.rejects(
    client.call('admin.reviewCorrection', {
      correctionId: 'synthetic_correction',
      decision: 'approved',
    }),
    { code: 'NETWORK_ERROR' },
  );
  assert.equal(initialized, 1);
  assert.equal(sent, 1);
});
