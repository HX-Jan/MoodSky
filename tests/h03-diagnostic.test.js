const test = require('node:test');
const assert = require('node:assert/strict');
const { main, createProbe, operatorFingerprint } = require('../tools/h03-probe/index.js');
const config = require('../tools/h03-probe/config.js');

function fixture(options = {}) {
  const stages = [];
  let databaseCalls = 0;
  const probe = createProbe({
    trace: (stage) => {
      stages.push(stage);
      if (options.failedTrace) {
        throw new Error('synthetic-private-logger-error');
      }
    },
    readTrustedContext: () => ({
      ENV: config.environmentId,
      APPID: config.appId,
      OPENID: 'synthetic-diagnostic-operator',
    }),
    readOperatorFingerprint: () => options.fingerprint,
    openDatabase: () => {
      databaseCalls += 1;
      throw new Error('No database access permitted in these local diagnostic checks.');
    },
  });
  return { probe, stages, databaseCalls: () => databaseCalls };
}

test('shape diagnostic reports fields and types without returning payload or identity values', async () => {
  const { probe, stages, databaseCalls } = fixture();
  const result = await probe({
    operation: 'identify',
    unexpectedEnvelope: 'synthetic-private-body',
    userInfo: { OPENID: 'synthetic-private-openid' },
  });
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert.equal(result.diagnostic.stage, 'control-validation');
  assert.equal(result.diagnostic.operationRecognized, true);
  assert.equal(result.diagnostic.userInfoPresent, true);
  assert(result.diagnostic.topLevelKeys.includes('unexpectedEnvelope'));
  assert.equal(result.diagnostic.databaseAccessed, false);
  assert(!JSON.stringify(result).includes('synthetic-private'));
  assert.deepEqual(stages, ['entry', 'control-rejected']);
  assert.equal(databaseCalls(), 0);
});

test('shape diagnostic distinguishes wrapped requests from non-object inputs without decoding values', async () => {
  const { probe, databaseCalls } = fixture();
  const wrapped = await probe({ data: { operation: 'identify', text: 'synthetic-private-body' } });
  assert.deepEqual(wrapped.diagnostic.topLevelKeys, ['data']);
  assert.equal(wrapped.diagnostic.operationType, 'undefined');
  for (const [input, type] of [
    [null, 'null'],
    ['synthetic-private-body', 'string'],
    [[], 'array'],
  ]) {
    const result = await probe(input);
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(result.diagnostic.eventType, type);
    assert(!JSON.stringify(result).includes('synthetic-private-body'));
  }
  assert.equal(databaseCalls(), 0);
});

test('shape diagnostic bounds field names and omits unsafe or oversized names', async () => {
  const { probe } = fixture();
  const input = { operation: 'identify', 'unsafe/private-key-name': 'synthetic-private-value' };
  input['x'.repeat(80)] = 'synthetic-private-value';
  for (let i = 0; i < 40; i += 1) {
    input['field_' + i] = 'synthetic-private-value';
  }
  const result = await probe(input);
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert(result.diagnostic.topLevelKeys.length <= 16);
  assert(result.diagnostic.topLevelKeys.every((key) => key.length <= 48));
  assert(result.diagnostic.omittedFieldCount > 0);
  assert(!JSON.stringify(result).includes('unsafe/private-key-name'));
  assert(!JSON.stringify(result).includes('synthetic-private-value'));
});

test('shape diagnostics and failing trace sinks cannot authorize a request or change rejection', async () => {
  const { probe, stages, databaseCalls } = fixture({ failedTrace: true });
  const invalid = await probe({ operation: 'identify', ownerId: 'synthetic-owner' });
  assert.equal(invalid.error.code, 'INVALID_REQUEST');
  const unauthorized = await probe({
    operation: 'run',
    runId: 'h03_diagnostic_checks_001',
    userInfo: { operatorFingerprint: operatorFingerprint('synthetic-diagnostic-operator') },
  });
  assert.equal(unauthorized.error.code, 'FORBIDDEN');
  assert.equal(unauthorized.diagnostic, undefined);
  assert(
    stages.every((stage) => ['entry', 'control-accepted', 'control-rejected'].includes(stage)),
  );
  assert.equal(databaseCalls(), 0);
});

test('bundled cloud entry emits only fixed stage tags on a rejected synthetic request', async () => {
  const original = console.info;
  const emitted = [];
  console.info = (...args) => emitted.push(args);
  try {
    const result = await main({ operation: 'identify', payload: 'synthetic-private-body' });
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(result.diagnostic.databaseAccessed, false);
    assert.equal(emitted.length, 2);
    assert(
      emitted.every(
        (args) => args.length === 1 && args[0].startsWith('[h03-control-shape-20261014] '),
      ),
    );
    assert(!JSON.stringify(emitted).includes('synthetic-private-body'));
    assert(!JSON.stringify(emitted).includes('payload'));
  } finally {
    console.info = original;
  }
});
