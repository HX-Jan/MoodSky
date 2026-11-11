const { createHmac, timingSafeEqual } = require('node:crypto');
const APP_ID = 'wxf602e991ff44e6c8';
const ENV_ID = 'mood-sky-d5gqy3spkff37566d';
const RELEASE_VERSION = '0.5.0';
const PACKAGED_RELEASE = process.env.MOODSKY_PACKAGED_RELEASE === 'true';
function readProductionConfig(env = {}) {
  if (env.MOODSKY_PRODUCTION_ENABLED !== 'true') {
    return null;
  }
  const names = ['IDENTITY', 'SESSION', 'RECEIPT'];
  const result = {};
  for (const name of names) {
    const value = env['MOODSKY_' + name + '_KEY_HEX'];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      return null;
    }
    result[name.toLowerCase() + 'Key'] = Buffer.from(value, 'hex');
  }
  if (new Set(names.map((name) => env['MOODSKY_' + name + '_KEY_HEX'])).size !== 3) {
    return null;
  }
  const pauseCheckins = env.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED;
  result.campusCheckinWritesPaused =
    pauseCheckins === undefined ? PACKAGED_RELEASE : pauseCheckins !== 'false';
  return result;
}
function readServerConfig(env = {}, readLocal) {
  const names = [
    'MOODSKY_PRODUCTION_ENABLED',
    'MOODSKY_IDENTITY_KEY_HEX',
    'MOODSKY_SESSION_KEY_HEX',
    'MOODSKY_RECEIPT_KEY_HEX',
  ];
  // Platform settings take precedence, including an explicit emergency shutdown.
  if (names.some((name) => Object.hasOwn(env, name))) {
    return readProductionConfig(env);
  }
  let local;
  try {
    local = readLocal
      ? readLocal()
      : JSON.parse(
          require('node:fs').readFileSync(
            require('node:path').join(__dirname, 'runtime.local.json'),
            'utf8',
          ),
        );
  } catch {
    return null;
  }
  if (
    !local ||
    local.storage !== 'server-deployment-config-v1' ||
    local.appId !== APP_ID ||
    local.environmentId !== ENV_ID
  ) {
    return null;
  }
  return readProductionConfig(local);
}
function digest(key, kind, value) {
  return createHmac('sha256', key)
    .update(JSON.stringify([kind, APP_ID, value]))
    .digest('hex');
}
const accountId = (config, openid) =>
  'acct_' + digest(config.identityKey, 'wechat-account-v1', openid);
const sessionScope = (config, ownerId) =>
  'scope_' + digest(config.sessionKey, 'session-v1', ownerId);
function same(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
module.exports = {
  APP_ID,
  ENV_ID,
  RELEASE_VERSION,
  readProductionConfig,
  readServerConfig,
  accountId,
  sessionScope,
  digest,
  same,
};
