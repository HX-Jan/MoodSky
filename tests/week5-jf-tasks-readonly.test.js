// W5 JF — 普通任务只读收敛：未取得目标云与真实账号证据前，生产入口默认只提供
// 建议与本人状态读取，写动作在进入任何存储前即被拒绝。
// 合成替身，无云、无网络、无真实账号。
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createRequest } = require('../miniprogram/services/api');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const now = () => new Date('2026-11-11T04:00:00Z'); // 2026-11-11 12:00 Asia/Shanghai

function seed() {
  return {
    'task_templates:synthetic_task': {
      _id: 'synthetic_task',
      enabled: true,
      title: '合成任务',
      steps: ['合成步骤'],
      durationMin: 5,
      tags: [],
    },
  };
}

async function world({ tasksWritesEnabled } = {}) {
  const fixture = databaseFixture(seed());
  const scopes = {};
  let serial = 0;
  const call = async (who, action, payload = {}) => {
    const request = { ...createRequest(action, payload), requestId: 'req_w5_ro_' + ++serial };
    const options = {
      readConfig: () => config,
      openDatabase: () => fixture.db,
      now,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: who,
        identityFromCurrentInvocation: true,
      }),
    };
    if (tasksWritesEnabled !== undefined) {
      options.tasksWritesEnabled = tasksWritesEnabled;
    }
    const result = await createProductionEntry(options)({
      ...request,
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
    });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  };
  await call('synthetic_ro_a', 'account.session');
  return { call, fixture };
}

const rows = (data, prefix) => Object.entries(data).filter(([key]) => key.startsWith(prefix + ':'));

test('W5-JF-RO-01 the default production entry serves suggestions read-only and refuses writes', async () => {
  const w = await world();
  const suggestions = await w.call('synthetic_ro_a', 'tasks.suggestions');
  assert.equal(suggestions.ok, true, JSON.stringify(suggestions));
  assert.equal(suggestions.data.readOnly, true);

  const blocked = await w.call('synthetic_ro_a', 'tasks.transition', {
    taskId: 'synthetic_task',
    transition: 'select',
    expectedDate: '2026-11-11',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'FORBIDDEN');
  assert.match(blocked.error.message, /暂未开放/);

  const data = w.fixture.inspect();
  assert.equal(rows(data, 'task_history').length, 0);
  assert.equal(rows(data, 'request_receipts').length, 0);
});

test('W5-JF-RO-02 own state and history stay readable while writes are closed', async () => {
  // The light fixture only implements `command.gt`, so the paged history query needs
  // the native offline SDK instead.
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb }) => {
      const entry = createProductionEntry({
        openDatabase: () => createProductionDatabase(nativeDb),
        readConfig: () => config,
        now,
        readIdentity: () => ({
          APPID: APP_ID,
          ENV: ENV_ID,
          SOURCE: 'wx_client',
          OPENID: 'synthetic_ro_a',
          identityFromCurrentInvocation: true,
        }),
      });
      let serial = 0;
      const call = (action, payload = {}, sessionScope) =>
        entry({
          ...createRequest(action, payload),
          requestId: 'req_w5_ro_native_' + ++serial,
          ...(sessionScope ? { sessionScope } : {}),
        });
      const login = await call('account.session');
      assert.equal(login.ok, true, JSON.stringify(login));
      const scope = login.data.scope;

      const mine = await call('tasks.mine', {}, scope);
      assert.equal(mine.ok, true, JSON.stringify(mine));
      assert.ok(Array.isArray(mine.data.items));

      const history = await call('tasks.history', { from: '2026-11-01', to: '2026-11-11' }, scope);
      assert.equal(history.ok, true, JSON.stringify(history));
      assert.ok(Array.isArray(history.data.items));

      const blocked = await call(
        'tasks.transition',
        { taskId: 'synthetic_task', transition: 'select', expectedDate: '2026-11-11' },
        scope,
      );
      assert.equal(blocked.ok, false);
      assert.equal(blocked.error.code, 'FORBIDDEN');
    },
    { nativeDatabase: true, taskStoreReads: true },
  );
});

test('W5-JF-RO-03 the write entry opens only when the assembly opts in', async () => {
  const closed = await world();
  const denied = await closed.call('synthetic_ro_a', 'tasks.transition', {
    taskId: 'synthetic_task',
    transition: 'select',
    expectedDate: '2026-11-11',
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'FORBIDDEN');

  const open = await world({ tasksWritesEnabled: true });
  // The capability flag the client greys writes with must match the write switch.
  const openSuggestions = await open.call('synthetic_ro_a', 'tasks.suggestions');
  assert.equal(openSuggestions.ok, true, JSON.stringify(openSuggestions));
  assert.equal(openSuggestions.data.readOnly, false);
  const allowed = await open.call('synthetic_ro_a', 'tasks.transition', {
    taskId: 'synthetic_task',
    transition: 'select',
    expectedDate: '2026-11-11',
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.equal(rows(open.fixture.inspect(), 'task_history').length, 1);
});

test('W5-JF-RO-04 the domain default stays writable so unit callers are unaffected', async () => {
  const { createTasksDomain } = require('../cloudfunctions/moodsky/services/tasks-candidate');
  const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');
  const store = createMemoryTasksStore({
    templates: seed()['task_templates:synthetic_task']
      ? [
          {
            _id: 'synthetic_task',
            enabled: true,
            title: '合成任务',
            steps: ['合成步骤'],
            durationMin: 5,
            tags: [],
          },
        ]
      : [],
  });
  const domain = createTasksDomain({ store, clock: now });
  const result = await domain.handle({
    action: 'tasks.transition',
    actor: { accountId: 'account_alpha' },
    requestId: 'req_w5_ro_domain_001',
    payload: { taskId: 'synthetic_task', transition: 'select' },
  });
  assert.equal(result.state, 'selected');
});
