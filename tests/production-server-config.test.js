const test = require('node:test');
const assert = require('node:assert/strict');
const { readServerConfig, APP_ID, ENV_ID } = require('../cloudfunctions/moodsky/production/config');
const fixture = () => ({
  storage: 'server-deployment-config-v1',
  appId: APP_ID,
  environmentId: ENV_ID,
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
test('server-only deployment config supplies independent keys; platform disable always wins', () => {
  const config = readServerConfig({}, fixture);
  assert.equal(config.identityKey.length, 32);
  assert.notDeepEqual(config.identityKey, config.sessionKey);
  let reads = 0;
  assert.equal(
    readServerConfig({ MOODSKY_PRODUCTION_ENABLED: 'false' }, () => {
      reads++;
      return fixture();
    }),
    null,
  );
  assert.equal(reads, 0);
});
test('wrong destination, malformed or missing server config leaves private services closed', () => {
  for (const local of [
    null,
    {},
    { ...fixture(), appId: 'another_app' },
    { ...fixture(), environmentId: 'another_env' },
    { ...fixture(), MOODSKY_RECEIPT_KEY_HEX: '11'.repeat(32) },
  ]) {
    assert.equal(
      readServerConfig({}, () => local),
      null,
    );
  }
  assert.equal(
    readServerConfig({}, () => {
      throw new Error('unavailable');
    }),
    null,
  );
});
test('partial platform settings fail closed instead of silently enabling a deployment file', () => {
  assert.equal(readServerConfig({ MOODSKY_SESSION_KEY_HEX: 'invalid' }, fixture), null);
});
