const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequest, createApiClient } = require('../miniprogram/services/api');
const config = { cloudEnabled: true, cloudEnvId: 'synthetic-test-env' };
const platform = (callFunction) => ({ cloud: { callFunction } });

test('application startup requires an explicit boolean enable and valid environment before SDK init', () => {
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
  function launch(settings, init) {
    let app;
    vm.runInNewContext(source, {
      require: (name) =>
        name.includes('environment.local') ? settings : { APP_NAME: 'SYNTHETIC' },
      wx: { cloud: { init } },
      App: (definition) => {
        app = definition;
      },
    });
    app.onLaunch();
    return app;
  }
  let calls = 0;
  for (const settings of [
    null,
    {},
    { cloudEnabled: 'false', cloudEnvId: 'synthetic' },
    { cloudEnabled: 1, cloudEnvId: 'synthetic' },
    { cloudEnabled: true, cloudEnvId: 5 },
    { cloudEnabled: true, cloudEnvId: '  ' },
    { cloudEnabled: false, cloudEnvId: 'synthetic' },
  ]) {
    assert.equal(
      launch(settings, () => {
        calls++;
      }).globalData.cloudReady,
      false,
    );
  }
  assert.equal(calls, 0);
  assert.equal(launch(config, undefined).globalData.cloudReady, false);
  assert.equal(
    launch(config, () => {
      throw new Error('SYNTHETIC init failure');
    }).globalData.cloudReady,
    false,
  );
  assert.equal(
    launch(config, (options) => {
      calls++;
      assert.equal(options.env, config.cloudEnvId);
      assert.equal(options.traceUser, false);
    }).globalData.cloudReady,
    true,
  );
  assert.equal(calls, 1);
});

test('each dispatched request pins its explicit cloud environment across client recreation and retry', async () => {
  const settings = { cloudEnabled: true, cloudEnvId: 'synthetic-env-a' };
  const sent = [];
  const sdk = platform(async (options) => {
    sent.push(options);
    throw new Error('SYNTHETIC response lost');
  });
  const original = createRequest('account.close');
  await assert.rejects(createApiClient(sdk, settings).call(original), { code: 'NETWORK_ERROR' });
  settings.cloudEnvId = 'synthetic-env-b';
  await assert.rejects(createApiClient(sdk, settings).call(original), { code: 'NETWORK_ERROR' });
  const next = createRequest('account.close');
  await assert.rejects(createApiClient(sdk, settings).call(next), { code: 'NETWORK_ERROR' });
  assert.deepEqual(
    sent.map((options) => options.config && options.config.env),
    ['synthetic-env-a', 'synthetic-env-a', 'synthetic-env-b'],
  );
  assert.equal(sent[1].data, original);
});

test('malformed cloud settings never dispatch or bind a request before valid configuration', async () => {
  const sent = [];
  const sdk = platform(async (options) => {
    sent.push(options);
    return { result: { apiVersion: '1', requestId: options.data.requestId, ok: true, data: {} } };
  });
  const request = createRequest('system.health');
  for (const settings of [
    null,
    {},
    { cloudEnabled: 'false', cloudEnvId: 'synthetic' },
    { cloudEnabled: 1, cloudEnvId: 'synthetic' },
    { cloudEnabled: true, cloudEnvId: 7 },
    { cloudEnabled: true, cloudEnvId: '   ' },
    ...[0, -1, NaN, Infinity, 60001, '15000'].map((requestTimeoutMs) => ({
      cloudEnabled: true,
      cloudEnvId: 'synthetic',
      requestTimeoutMs,
    })),
  ]) {
    await assert.rejects(createApiClient(sdk, settings).call(request), {
      code: 'CLOUD_NOT_CONFIGURED',
    });
  }
  await assert.rejects(createApiClient({ cloud: {} }, config).call(request), {
    code: 'CLOUD_NOT_CONFIGURED',
  });
  assert.equal(sent.length, 0);
  await createApiClient(sdk, config).call(request);
  assert.equal(sent[0].config.env, config.cloudEnvId);
});

test(
  'a stalled transport reaches its local deadline and retry keeps the exact original request and environment',
  { timeout: 1000 },
  async () => {
    const sent = [];
    const client = createApiClient(
      platform((options) => {
        sent.push(options);
        if (sent.length === 1) {
          return new Promise(() => {});
        }
        return Promise.resolve({
          result: {
            apiVersion: '1',
            requestId: options.data.requestId,
            ok: true,
            data: { confirmed: true },
          },
        });
      }),
      { ...config, requestTimeoutMs: 10 },
    );
    const request = createRequest('account.close');
    await assert.rejects(client.call(request), { code: 'NETWORK_ERROR' });
    assert.equal(sent.length, 1, 'No automatic retry may be dispatched');
    assert.equal((await client.call(request)).data.confirmed, true);
    assert.equal(sent[0].data, request);
    assert.equal(sent[1].data, request);
    assert.equal(sent[0].config.env, sent[1].config.env);
  },
);

test(
  'a late transport rejection after the deadline is consumed without reopening the original result',
  { timeout: 1000 },
  async () => {
    let rejectLate;
    let calls = 0;
    const client = createApiClient(
      platform(() => {
        calls++;
        return new Promise((_resolve, reject) => {
          rejectLate = reject;
        });
      }),
      { ...config, requestTimeoutMs: 5 },
    );
    await assert.rejects(client.call(createRequest('system.health')), { code: 'NETWORK_ERROR' });
    rejectLate(new Error('SIMULATED late transport error'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 1);
  },
);

test('request snapshots are immutable so a retry cannot accidentally change inputs', () => {
  const input = { date: '2026-10-11', weather: 'SUNNY', tags: ['REST'], expectedVersion: 0 };
  const request = createRequest('journal.upsert', input);
  input.tags.push('CALM');
  assert.deepEqual(request.payload.tags, ['REST']);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.payload.tags), true);
  assert.notEqual(
    createRequest('system.health').requestId,
    createRequest('system.health').requestId,
  );
});
test('default disabled cloud configuration cannot dispatch calls', async () => {
  let calls = 0;
  const client = createApiClient(
    platform(async () => {
      calls += 1;
    }),
    { cloudEnabled: false },
  );
  await assert.rejects(client.call(createRequest('system.health')), {
    code: 'CLOUD_NOT_CONFIGURED',
  });
  assert.equal(calls, 0);
});
test('transport failures allow retrying the exact original request and ID', async () => {
  const sent = [];
  const client = createApiClient(
    platform(async (options) => {
      sent.push(options.data);
      throw new Error('platform details must be hidden');
    }),
    config,
  );
  const request = createRequest('account.close');
  await assert.rejects(client.call(request), { code: 'NETWORK_ERROR' });
  await assert.rejects(client.call(request), { code: 'NETWORK_ERROR' });
  assert.equal(sent.length, 2);
  assert.equal(sent[0], request);
  assert.equal(sent[1], request);
});
test('client rejects mismatched request ID, version and malformed results', async () => {
  const request = createRequest('system.health');
  for (const result of [
    { apiVersion: '1', requestId: 'req_different', ok: true, data: {} },
    { apiVersion: '2', requestId: request.requestId, ok: true, data: {} },
    { apiVersion: '1', requestId: request.requestId, ok: true },
    {
      apiVersion: '1',
      requestId: request.requestId,
      ok: false,
      error: { code: 'UNKNOWN', message: 'x' },
    },
    undefined,
  ]) {
    const client = createApiClient(
      platform(async () => ({ result })),
      config,
    );
    await assert.rejects(client.call(request), { code: 'INVALID_RESPONSE' });
  }
});
test('contract success is returned and explicit business failures remain failures', async () => {
  const request = createRequest('system.health');
  const success = {
    apiVersion: '1',
    requestId: request.requestId,
    ok: true,
    data: { stage: 'foundation' },
  };
  assert.deepEqual(
    await createApiClient(
      platform(async () => ({ result: success })),
      config,
    ).call(request),
    success,
  );
  const failure = {
    apiVersion: '1',
    requestId: request.requestId,
    ok: false,
    error: { code: 'NOT_IMPLEMENTED', message: '开发中' },
  };
  await assert.rejects(
    createApiClient(
      platform(async () => ({ result: failure })),
      config,
    ).call(request),
    { code: 'NOT_IMPLEMENTED' },
  );
});

test('contradictory or undefined success results never confirm a write', async () => {
  const request = createRequest('account.close');
  const base = { apiVersion: '1', requestId: request.requestId, ok: true, data: {} };
  for (const result of [
    { ...base, data: undefined },
    { ...base, error: { code: 'CONFLICT', message: 'synthetic conflict' } },
    { ...base, ok: false, error: { code: 'CONFLICT', message: 'synthetic conflict' } },
  ]) {
    const client = createApiClient(
      platform(async () => ({ result })),
      config,
    );
    await assert.rejects(client.call(request), { code: 'INVALID_RESPONSE' });
  }
});
