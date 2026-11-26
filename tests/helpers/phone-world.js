const { databaseFixture } = require('./w2-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../../cloudfunctions/moodsky/production/config');
function world(enabled = true) {
  const f = databaseFixture();
  let serial = 0;
  let time = new Date('2026-11-22T00:00:00Z');
  let exchanges = 0;
  const config = readProductionConfig({
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
    MOODSKY_PHONE_LOGIN_ENABLED: String(enabled),
  });
  const call = (action, payload = {}, extra = {}, who = 'synthetic_wechat') =>
    createProductionEntry({
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        OPENID: who,
        SOURCE: 'wx_client',
        identityFromCurrentInvocation: true,
      }),
      readConfig: () => config,
      openDatabase: () => f.db,
      now: () => time,
      exchangePhone: async (code) => {
        exchanges++;
        if (code === 'invalid') {
          throw new Error('synthetic');
        }
        return {
          phoneInfo: {
            countryCode: '86',
            purePhoneNumber: code === 'primary' ? '13800000001' : '13800000002',
          },
        };
      },
    })({ apiVersion: '1', requestId: 'req_phone_' + ++serial, action, payload, ...extra });
  return {
    ...f,
    call,
    expire: () => {
      time = new Date(time.getTime() + 8 * 86400000);
    },
    exchanges: () => exchanges,
    advanceMinutes: (minutes) => {
      time = new Date(time.getTime() + minutes * 60000);
    },
  };
}
module.exports = { phoneWorld: world };
