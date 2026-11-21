// Local production entry with synthetic identities and the existing offline SDK transport.
// Used by the W6-JF sample collector and focused tests. No cloud, network or real account.
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const { createProductionDatabase } = require('../../cloudfunctions/moodsky/production/database');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../../cloudfunctions/moodsky/production/config');
const { withOfflineWxDatabase } = require('../../tests/helpers/offline-wx-database');

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'true',
});

async function withTaskWorld(options, work) {
  const {
    seed = {},
    tasksWritesEnabled = true,
    now = new Date('2026-11-18T04:00:00.000Z'),
    fault = () => null,
  } = options || {};
  return withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      const scopes = {};
      let clock = now instanceof Date ? new Date(now.getTime()) : new Date(now);
      let serial = 0;
      const world = {
        inspect,
        calls: [],
        rows: (collection) =>
          Object.entries(inspect())
            .filter(([key]) => key.startsWith(collection + ':'))
            .map(([, row]) => row),
        count: (collection) =>
          Object.keys(inspect()).filter((key) => key.startsWith(collection + ':')).length,
        setNow(value) {
          clock = value instanceof Date ? new Date(value.getTime()) : new Date(value);
        },
        now: () => new Date(clock.getTime()),
        request(action, payload = {}, requestId) {
          return {
            apiVersion: '1',
            action,
            payload,
            requestId: requestId || 'req_w6_jf_' + ++serial,
          };
        },
        async send(request, who = 'a') {
          world.calls.push(JSON.parse(JSON.stringify(request)));
          const entry = createProductionEntry({
            tasksWritesEnabled,
            readConfig: () => config,
            openDatabase: () => createProductionDatabase(nativeDb),
            now: () => clock,
            readIdentity: () => ({
              APPID: APP_ID,
              ENV: ENV_ID,
              SOURCE: 'wx_client',
              OPENID: 'synthetic_w6_jf_' + who,
              identityFromCurrentInvocation: true,
            }),
          });
          const response = await entry({
            ...request,
            ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
          });
          if (request.action === 'account.session' && response.ok) {
            scopes[who] = response.data.scope;
          }
          if (fault) {
            const injected = fault({ request, response });
            if (injected) {
              return injected;
            }
          }
          return response;
        },
        async login(who = 'a') {
          const response = await world.send(world.request('account.session'), who);
          if (!response.ok) {
            throw new Error(response.error.code);
          }
          return response.data.scope;
        },
      };
      return work(world);
    },
    { nativeDatabase: true, taskStoreReads: true, conflictScope: 'written-documents' },
  );
}

module.exports = { withTaskWorld };
