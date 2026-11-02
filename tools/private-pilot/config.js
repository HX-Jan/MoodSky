const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { createReceiptPolicy } = require('../../cloudfunctions/moodsky/services/receipt-policy');
const { businessDate, isBusinessDate } = require('../../cloudfunctions/moodsky/shared/date');
const settings = Object.freeze({
  functionName: 'moodsky-private-pilot',
  appId: 'wxf602e991ff44e6c8',
  environmentId: 'mood-sky-d5gqy3spkff37566d',
  keyId: 'pilot-20261025',
  receiptMaxAgeMs: 86400000,
});
function operatorFingerprint(openid) {
  // Matches the existing H03 identify output, so no raw OPENID is copied to config.
  return createHash('sha256')
    .update('moodsky-h03-operator:' + openid)
    .digest('hex');
}
function same(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}
function accountScope(key, ownerId) {
  return (
    'scope_' +
    createHmac('sha256', key)
      .update('moodsky-private-account:' + ownerId)
      .digest('hex')
  );
}
function readPilotConfig(env = {}, instant = new Date()) {
  if (
    env.MOODSKY_PRIVATE_PILOT_ENABLED !== 'true' ||
    env.MOODSKY_PILOT_ACCOUNT_INDEX_VERIFIED !== 'true' ||
    !/^[a-f0-9]{64}$/.test(env.MOODSKY_PILOT_OPERATOR_FINGERPRINT || '') ||
    typeof env.MOODSKY_PILOT_RECEIPT_KEY_BASE64 !== 'string'
  ) {
    return null;
  }
  const expires = Date.parse(env.MOODSKY_PILOT_EXPIRES_AT);
  if (
    !Number.isFinite(expires) ||
    new Date(expires).toISOString() !== env.MOODSKY_PILOT_EXPIRES_AT ||
    expires <= instant.getTime() ||
    expires - instant.getTime() > 86400000 ||
    !isBusinessDate(env.MOODSKY_PILOT_TEST_DATE) ||
    env.MOODSKY_PILOT_TEST_DATE !== businessDate(instant)
  ) {
    return null;
  }
  const key = Buffer.from(env.MOODSKY_PILOT_RECEIPT_KEY_BASE64, 'base64');
  if (key.length !== 32 || key.toString('base64') !== env.MOODSKY_PILOT_RECEIPT_KEY_BASE64) {
    return null;
  }
  return {
    operatorFingerprint: env.MOODSKY_PILOT_OPERATOR_FINGERPRINT,
    scopeKey: key,
    testDate: env.MOODSKY_PILOT_TEST_DATE,
    expiresAt: env.MOODSKY_PILOT_EXPIRES_AT,
    receiptPolicy: createReceiptPolicy({
      activeKeyId: settings.keyId,
      keys: { [settings.keyId]: key },
      maxAgeMs: settings.receiptMaxAgeMs,
    }),
  };
}
function pilotIdentity(key, openid) {
  return (
    'pilot_' +
    createHmac('sha256', key)
      .update('moodsky-pilot-identity:' + openid)
      .digest('hex')
  );
}
module.exports = {
  settings,
  readPilotConfig,
  operatorFingerprint,
  accountScope,
  pilotIdentity,
  same,
};
