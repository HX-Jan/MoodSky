// Actual production entry and locked native SDK with local synthetic transport only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createLocalStorage } = require('./helpers/local-storage');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../cloudfunctions/moodsky/production/config');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createTaskOutbox } = require('../miniprogram/modules/tasks/outbox');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
test('durable task retry crosses midnight through production entry/native SDK without a second history write', async () => {
  const seed = {};
  for (let i = 0; i < 4; i++) {
    seed['task_templates:task_' + i] = {
      _id: 'task_' + i,
      enabled: true,
      title: '合成小任务 ' + i,
      steps: ['合成步骤'],
      durationMin: 2,
      tags: [],
    };
  }
  await withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      const config = readProductionConfig({
        MOODSKY_PRODUCTION_ENABLED: 'true',
        MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
        MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
        MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
      });
      let now = new Date('2026-11-06T15:59:00Z'),
        loseAcknowledgement = true;
      const entry = createProductionEntry({
        openDatabase: () => createProductionDatabase(nativeDb),
        tasksWritesEnabled: true,
        readConfig: () => config,
        now: () => now,
        readIdentity: () => ({
          APPID: APP_ID,
          ENV: ENV_ID,
          SOURCE: 'wx_devtools',
          OPENID: 'synthetic_outbox_owner',
          identityFromCurrentInvocation: true,
        }),
      });
      const login = await entry(createRequest('account.session'));
      assert.equal(login.ok, true);
      const session = createSessionState();
      session.accept(login.data.scope);
      const outbox = createTaskOutbox(createLocalStorage(), {
        cloudEnabled: true,
        cloudEnvId: 'synthetic-production',
        releaseProfile: 'production',
      });
      const sent = [],
        state = {};
      async function call(request) {
        const result = await entry({ ...request, sessionScope: login.data.scope });
        if (!result.ok) {
          throw new AppError(result.error.code, result.error.message);
        }
        return result;
      }
      const api = {
        suggestions: () => call(createRequest('tasks.mine')),
        quickChoice: () => call(createRequest('tasks.quickChoice')),
        history: (query) => call(createRequest('tasks.history', query)),
        createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
        async submit(request) {
          sent.push(request);
          const result = await call(request);
          if (loseAcknowledgement) {
            throw new AppError('NETWORK_ERROR', 'synthetic response loss');
          }
          return result;
        },
      };
      const create = () =>
        createCloudTaskController({
          session,
          pendingStorage: outbox,
          api,
          now: () => now,
          publish: (patch) => Object.assign(state, patch),
        });
      let controller = create();
      await controller.load();
      assert.equal(state.suggestions.length, 3);
      await controller.transition('task_0', 'select');
      assert.equal(state.retryPending, true);
      controller.dispose();
      now = new Date('2026-11-06T16:01:00Z');
      controller = create();
      await controller.load();
      assert.equal(sent.length, 1);
      assert.equal(state.suggestions.length, 0);
      loseAcknowledgement = false;
      await controller.retry();
      assert.deepEqual(sent[1], sent[0]);
      assert.equal(outbox.read(login.data.scope), null);
      let rows = Object.entries(inspect())
        .filter(([key]) => key.startsWith('task_history:'))
        .map(([, row]) => row);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].date, '2026-11-06');
      const owner = accountId(config, 'synthetic_outbox_owner');
      assert.equal(inspect()['accounts:' + owner].sourceRevisions.tasks, 1);
      await controller.load('history');
      assert.equal(state.history.length, 1);
      assert.equal(state.history[0].date, '2026-11-06');
      await controller.load();
      await controller.transition('task_1', 'select');
      await controller.transition('task_1', 'complete');
      await controller.load('history');
      rows = state.history;
      assert.equal(rows.find((row) => row.taskId === 'task_1').state, 'completed');
      assert.equal(
        Object.entries(inspect()).filter(([key]) => key.startsWith('place_checkins:')).length,
        0,
      );
      controller.dispose();
    },
    { nativeDatabase: true, taskStoreReads: true },
  );
});

for (const failure of ['before-server', 'delayed-delivery']) {
  test(
    'production refuses an uncommitted previous-day task after ' +
      failure +
      ' and requires a fresh user choice',
    async () => {
      await withOfflineWxDatabase(
        {
          'task_templates:task_0': {
            _id: 'task_0',
            enabled: true,
            title: '合成任务',
            steps: ['合成步骤'],
            durationMin: 2,
            tags: [],
          },
        },
        async ({ nativeDb, inspect }) => {
          const config = readProductionConfig({
            MOODSKY_PRODUCTION_ENABLED: 'true',
            MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
            MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
            MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
          });
          let now = new Date('2026-11-06T15:59:00Z'),
            first = true;
          const entry = createProductionEntry({
            openDatabase: () => createProductionDatabase(nativeDb),
            tasksWritesEnabled: true,
            readConfig: () => config,
            now: () => now,
            readIdentity: () => ({
              APPID: APP_ID,
              ENV: ENV_ID,
              SOURCE: 'wx_devtools',
              OPENID: 'synthetic_crossday_owner',
              identityFromCurrentInvocation: true,
            }),
          });
          const login = await entry(createRequest('account.session'));
          assert.equal(login.ok, true);
          const session = createSessionState();
          session.accept(login.data.scope);
          const outbox = createTaskOutbox(createLocalStorage(), {
            cloudEnabled: true,
            cloudEnvId: 'synthetic',
            releaseProfile: 'production',
          });
          const sent = [],
            state = {};
          const call = async (request) => {
            const result = await entry({ ...request, sessionScope: login.data.scope });
            if (!result.ok) {
              throw new AppError(result.error.code, result.error.message);
            }
            return result;
          };
          const api = {
            suggestions: () => call(createRequest('tasks.mine')),
            quickChoice: () => call(createRequest('tasks.quickChoice')),
            createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
            submit: async (request) => {
              sent.push(request);
              if (first) {
                first = false;
                if (failure === 'before-server') {
                  throw new AppError('NETWORK_ERROR', 'synthetic disconnect before dispatch');
                }
                now = new Date('2026-11-06T16:01:00Z');
              }
              return call(request);
            },
          };
          const make = () =>
            createCloudTaskController({
              api,
              session,
              pendingStorage: outbox,
              now: () => now,
              publish: (patch) => Object.assign(state, patch),
            });
          let controller = make();
          await controller.load();
          const before = inspect();
          await controller.transition('task_0', 'select');
          assert.equal(sent[0].payload.expectedDate, '2026-11-06');
          if (failure === 'before-server') {
            assert.equal(state.retryPending, true);
            controller.dispose();
            now = new Date('2026-11-06T16:01:00Z');
            controller = make();
            await controller.load();
            assert.equal(sent.length, 1, 'reopen never submits automatically');
            await controller.retry();
            assert.deepEqual(sent[1], sent[0]);
          }
          assert.deepEqual(
            inspect(),
            before,
            'expired attempt creates neither history nor receipt nor revision',
          );
          assert.equal(outbox.read(login.data.scope), null);
          assert.equal(state.retryPending, false);
          assert.equal(state.writeBlocked, true);
          assert.deepEqual(state.suggestions, []);
          assert.match(state.notice, /跨日/);
          const rejectedCount = sent.length;
          await controller.transition('task_0', 'select');
          assert.equal(sent.length, rejectedCount, 'no write before explicit current-day read');
          await controller.retry();
          assert.equal(state.suggestions[0].state, 'available');
          assert.equal(sent.length, rejectedCount, 'current-day read is not a write');
          await controller.transition('task_0', 'select');
          assert.equal(sent.length, rejectedCount + 1);
          assert.notEqual(sent.at(-1).requestId, sent[0].requestId);
          assert.equal(sent.at(-1).payload.expectedDate, '2026-11-07');
          const history = Object.entries(inspect())
            .filter(([key]) => key.startsWith('task_history:'))
            .map(([, row]) => row);
          assert.equal(history.length, 1);
          assert.equal(history[0].date, '2026-11-07');
          assert.equal(
            inspect()['accounts:' + accountId(config, 'synthetic_crossday_owner')].sourceRevisions
              .tasks,
            1,
          );
          controller.dispose();
        },
        { nativeDatabase: true, taskStoreReads: true },
      );
    },
  );
}
