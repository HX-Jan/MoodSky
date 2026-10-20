const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequest, createApiClient } = require('../miniprogram/services/api');
const config = { cloudEnabled: true, cloudEnvId: 'synthetic-test-env' };
const platform = (callFunction) => ({ cloud: { callFunction } });

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
