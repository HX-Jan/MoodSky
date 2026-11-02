const test = require('node:test');
const assert = require('node:assert/strict');
const { createProbe, operatorFingerprint } = require('../tools/h03-probe/index.js');
const config = require('../tools/h03-probe/config.js');

const trusted = {
  ENV: config.environmentId,
  APPID: config.appId,
  OPENID: 'synthetic-trusted-operator',
};
const runId = 'h03_metadata_checks_001';
function fixture(context = trusted, fingerprint) {
  let databaseCalls = 0;
  return {
    probe: createProbe({
      readTrustedContext: () => context,
      readOperatorFingerprint: () => fingerprint,
      openDatabase: () => {
        databaseCalls += 1;
        throw new Error('No database access is permitted in these local checks.');
      },
    }),
    databaseCalls: () => databaseCalls,
  };
}

test('candidate accepts transport userInfo for identify and derives only trusted identity', async () => {
  const { probe, databaseCalls } = fixture();
  const result = await probe({
    operation: 'identify',
    userInfo: { openId: 'synthetic-forged-identity', appId: 'synthetic-forged-app' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.userInfoMetadataIgnored, true);
  assert.equal(result.data.operatorFingerprint, operatorFingerprint(trusted.OPENID));
  assert.equal(result.data.databaseAccessed, false);
  assert(!JSON.stringify(result).includes('synthetic-forged'));
  assert.equal(databaseCalls(), 0);
});

test('candidate userInfo cannot bypass trusted app, environment or missing identity', async () => {
  for (const context of [{}, { ...trusted, APPID: 'wrong' }, { ...trusted, ENV: 'wrong' }]) {
    const { probe, databaseCalls } = fixture(context, operatorFingerprint(trusted.OPENID));
    const result = await probe({ operation: 'identify', userInfo: { ...trusted } });
    assert.equal(result.error.code, 'FORBIDDEN');
    assert.equal(databaseCalls(), 0);
  }
});

test('candidate userInfo cannot authorize an operator or bypass missing configuration', async () => {
  for (const fingerprint of [undefined, operatorFingerprint('another-synthetic-operator')]) {
    const { probe, databaseCalls } = fixture(trusted, fingerprint);
    const result = await probe({
      operation: 'run',
      runId,
      userInfo: {
        OPENID: trusted.OPENID,
        operatorFingerprint: operatorFingerprint(trusted.OPENID),
      },
    });
    assert.equal(result.error.code, 'FORBIDDEN');
    assert.equal(databaseCalls(), 0);
  }
});

test('candidate still rejects extra controls, invalid batches and unconfirmed cleanup', async () => {
  for (const input of [
    { operation: 'run', runId, ownerId: 'synthetic-owner' },
    { operation: 'run', runId, payload: 'synthetic-body' },
    { operation: 'run', runId, collection: 'journals' },
    { operation: 'run', runId: ['h03_metadata_checks_001'] },
    { operation: 'cleanup', runId },
  ]) {
    const { probe, databaseCalls } = fixture(trusted, operatorFingerprint(trusted.OPENID));
    const result = await probe({ ...input, userInfo: { ...trusted } });
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(databaseCalls(), 0);
  }
});
