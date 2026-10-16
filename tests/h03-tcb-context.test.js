const test = require('node:test');
const assert = require('node:assert/strict');
const { createProbe, operatorFingerprint } = require('../tools/h03-probe/index.js');
const config = require('../tools/h03-probe/config.js');

const trusted = {
  ENV: config.environmentId,
  APPID: config.appId,
  OPENID: 'synthetic-context-operator',
};
const runId = 'h03_context_checks_001';
function fixture(context = trusted, fingerprint) {
  let databaseCalls = 0;
  const stages = [];
  return {
    probe: createProbe({
      trace: (stage) => stages.push(stage),
      readTrustedContext: () => context,
      readOperatorFingerprint: () => fingerprint,
      openDatabase: () => {
        databaseCalls += 1;
        throw new Error('No database access permitted in these local context checks.');
      },
    }),
    databaseCalls: () => databaseCalls,
    stages,
  };
}

test('observed transport fields are ignored while identify uses only trusted context', async () => {
  const input = {
    operation: 'identify',
    tcbContext: {
      ...trusted,
      OPENID: 'synthetic-forged-identity',
      operation: 'run',
      runId,
    },
    userInfo: { OPENID: 'synthetic-forged-identity' },
  };
  const before = JSON.stringify(input);
  const { probe, databaseCalls, stages } = fixture();
  const result = await probe(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.operatorFingerprint, operatorFingerprint(trusted.OPENID));
  assert.equal(result.data.userInfoMetadataIgnored, true);
  assert.equal(result.data.tcbContextMetadataIgnored, true);
  assert.equal(result.data.databaseAccessed, false);
  assert(!JSON.stringify(result).includes('synthetic-forged'));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(stages, ['entry', 'control-accepted']);
  assert.equal(databaseCalls(), 0);
});

test('tcbContext cannot supply missing identity or repair a wrong trusted app or environment', async () => {
  for (const context of [
    {},
    { ...trusted, OPENID: '' },
    { ...trusted, APPID: 'wrong' },
    { ...trusted, ENV: 'wrong' },
  ]) {
    const { probe, databaseCalls } = fixture(context);
    const result = await probe({
      operation: 'identify',
      tcbContext: { ...trusted },
      userInfo: { ...trusted },
    });
    assert.equal(result.error.code, 'FORBIDDEN');
    assert.equal(result.diagnostic, undefined);
    assert.equal(databaseCalls(), 0);
  }
});

test('tcbContext cannot register or authorize an operator for database operations', async () => {
  for (const fingerprint of [undefined, operatorFingerprint('another-synthetic-operator')]) {
    for (const operation of ['inspect', 'run']) {
      const { probe, databaseCalls } = fixture(trusted, fingerprint);
      const result = await probe({
        operation,
        runId,
        tcbContext: {
          operatorFingerprint: operatorFingerprint(trusted.OPENID),
          OPENID: trusted.OPENID,
        },
      });
      assert.equal(result.error.code, 'FORBIDDEN');
      assert.equal(result.diagnostic, undefined);
      assert.equal(databaseCalls(), 0);
    }
  }
});

test('ignored tcbContext never supplies controls or bypasses strict cleanup and field checks', async () => {
  for (const input of [
    { tcbContext: { operation: 'identify' } },
    { operation: 'run', tcbContext: { runId } },
    { operation: 'run', runId, ownerId: 'synthetic-owner' },
    { operation: 'run', runId: [runId] },
    {
      operation: 'cleanup',
      runId,
      tcbContext: { confirm: config.cleanupConfirmation },
    },
  ]) {
    const { probe, databaseCalls } = fixture(trusted, operatorFingerprint(trusted.OPENID));
    const result = await probe({
      tcbContext: { ...trusted },
      userInfo: { ...trusted },
      ...input,
    });
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(result.diagnostic.databaseAccessed, false);
    assert.equal(databaseCalls(), 0);
  }
});

test('context metadata values never supply controls and remain absent from diagnostics and stage logs', async () => {
  for (const tcbContext of [
    null,
    [],
    'synthetic-private-context',
    { OPENID: 'synthetic-private-context' },
  ]) {
    const { probe, databaseCalls, stages } = fixture();
    const accepted = await probe({ operation: 'identify', tcbContext });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.data.tcbContextMetadataIgnored, true);
    const rejected = await probe({
      operation: 'identify',
      tcbContext,
      payload: 'synthetic-private-body',
    });
    assert.equal(rejected.error.code, 'INVALID_REQUEST');
    assert.equal(rejected.diagnostic.tcbContextPresent, true);
    assert.equal(rejected.diagnostic.unexpectedFieldCount, 1);
    assert.deepEqual(rejected.diagnostic.topLevelKeys, ['operation', 'payload', 'tcbContext']);
    assert(!JSON.stringify(rejected).includes('synthetic-private'));
    assert.deepEqual(stages, ['entry', 'control-accepted', 'entry', 'control-rejected']);
    assert.equal(databaseCalls(), 0);
  }
});
