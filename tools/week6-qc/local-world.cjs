// Local production entry with synthetic identities and the existing offline SDK transport.
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const { createProductionDatabase } = require('../../cloudfunctions/moodsky/production/database');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../../cloudfunctions/moodsky/production/config');
const { withOfflineWxDatabase } = require('../../tests/helpers/offline-wx-database');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');
const { AppError } = require('../../miniprogram/shared/result');

async function withLocalWorld(work, { campusWritesPaused = true } = {}) {
  const seed = Object.fromEntries(DEFAULT_TASKS.map((row) => ['task_templates:' + row._id, row]));
  return withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      const config = readProductionConfig({
        MOODSKY_PRODUCTION_ENABLED: 'true',
        MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
        MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
        MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
        MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: String(campusWritesPaused),
      });
      const scopes = {},
        calls = [];
      let serial = 0;
      const world = {
        db: createProductionDatabase(nativeDb),
        now: new Date('2026-11-18T04:00:00Z'),
        who: 'a',
        taskWrites: true,
        fault: null,
        hold: null,
        inspect,
        calls,
        rows: (collection) =>
          Object.entries(inspect())
            .filter(([key]) => key.startsWith(collection + ':'))
            .map(([, row]) => row),
        async raw(request, who = world.who) {
          const entry = createProductionEntry({
            tasksWritesEnabled: world.taskWrites,
            readConfig: () => config,
            openDatabase: () => createProductionDatabase(nativeDb),
            now: () => world.now,
            readIdentity: () => ({
              APPID: APP_ID,
              ENV: ENV_ID,
              SOURCE: 'wx_client',
              OPENID: 'synthetic_w6_qc_' + who,
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
          return response;
        },
        async call(request) {
          calls.push(JSON.parse(JSON.stringify(request)));
          const fault = world.fault?.action === request.action ? world.fault : null;
          if (fault) {
            world.fault = null;
          }
          if (fault?.kind === 'before') {
            throw new AppError('NETWORK_ERROR', 'Synthetic offline failure');
          }
          const who = world.who;
          if (world.hold?.action === request.action) {
            await world.hold.wait;
          }
          const response = await world.raw(request, who);
          if (!response.ok) {
            throw new AppError(response.error.code, response.error.message);
          }
          if (fault?.kind === 'after') {
            throw new AppError('NETWORK_ERROR', 'Synthetic lost response');
          }
          return response;
        },
        request(action, payload = {}) {
          return { apiVersion: '1', action, payload, requestId: 'req_w6_qc_' + ++serial };
        },
        async login(who = world.who) {
          const response = await world.raw(world.request('account.session'), who);
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
module.exports = { withLocalWorld };
