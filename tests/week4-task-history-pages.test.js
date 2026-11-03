const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const NOW = new Date('2026-11-02T16:05:00Z');
const A = 'scope_' + 'a'.repeat(64),
  B = 'scope_' + 'b'.repeat(64);
const row = (id) => ({
  taskId: id,
  date: '2026-11-03',
  state: 'completed',
  createdAt: '2026-11-03T00:00:00Z',
});
const reply = (rows, nextCursor = null) => ({ ok: true, data: { items: rows, nextCursor } });
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture(history) {
  const session = createSessionState();
  session.accept(A);
  const state = {},
    queries = [];
  const controller = createCloudTaskController({
    session,
    now: () => NOW,
    api: {
      history: (input) => {
        queries.push(input);
        return history(input, queries.length);
      },
      quickChoice: async () => ({ ok: true, data: { entries: [] } }),
    },
    publish: (patch) => Object.assign(state, patch),
  });
  return { controller, session, state, queries };
}

test('W4 real production history accepts the client date window and all 43 rows remain reachable in pages', async () => {
  const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
  const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
  const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
  const {
    readProductionConfig,
    APP_ID,
    ENV_ID,
    accountId,
  } = require('../cloudfunctions/moodsky/production/config');
  const {
    TASK_LAYOUT,
    historyId,
  } = require('../cloudfunctions/moodsky/stores/transactional-tasks');
  const config = readProductionConfig({
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  });
  const owner = accountId(config, 'synthetic_history_a');
  const seed = {};
  for (let i = 0; i < 43; i++) {
    const value = {
      ...row('synthetic_' + i),
      ownerId: owner,
      layout: TASK_LAYOUT,
      createdAt: new Date(NOW.getTime() - i * 1000).toISOString(),
    };
    value._id = historyId(owner, value.taskId, value.date);
    seed['task_history:' + value._id] = value;
  }
  const otherOwner = accountId(config, 'synthetic_history_b');
  const other = {
    ...row('SYNTHETIC_OTHER_ACCOUNT'),
    ownerId: otherOwner,
    layout: TASK_LAYOUT,
    _id: historyId(otherOwner, 'SYNTHETIC_OTHER_ACCOUNT', '2026-11-03'),
  };
  seed['task_history:' + other._id] = other;
  await withOfflineWxDatabase(
    seed,
    async ({ nativeDb }) => {
      const entry = createProductionEntry({
        openDatabase: () => createProductionDatabase(nativeDb),
        now: () => NOW,
        readConfig: () => config,
        readIdentity: () => ({
          APPID: APP_ID,
          ENV: ENV_ID,
          SOURCE: 'wx_devtools',
          OPENID: 'synthetic_history_a',
          identityFromCurrentInvocation: true,
        }),
      });
      const signedIn = await entry(createRequest('account.session'));
      assert.equal(signedIn.ok, true);
      const f = fixture(async (input) => {
        const result = await entry({
          ...createRequest('tasks.history', input),
          sessionScope: signedIn.data.scope,
        });
        if (!result.ok) {
          throw new AppError(result.error.code, result.error.message);
        }
        return result;
      });
      await f.controller.load('history');
      assert.equal(f.state.history.length, 20);
      assert.deepEqual(f.queries[0], { from: '2026-08-06', to: '2026-11-03' });
      assert.equal(f.state.historyHasMore, true);
      await f.controller.loadMoreHistory();
      assert.equal(f.state.history.length, 40);
      await f.controller.loadMoreHistory();
      assert.equal(f.state.history.length, 43);
      assert.equal(new Set(f.state.history.map((x) => x.taskId)).size, 43);
      assert.ok(!f.state.history.some((x) => x.taskId === other.taskId));
      assert.equal(f.state.historyHasMore, false);
      await f.controller.loadMoreHistory();
      assert.equal(f.queries.length, 3);
      assert.doesNotMatch(JSON.stringify(f.state), /scope_|ownerId|nextCursor|cursor/);
      f.controller.dispose();
    },
    { nativeDatabase: true, taskStoreReads: true },
  );
});

test('W4 a failed next page keeps confirmed rows and retries the identical date/cursor query', async () => {
  const f = fixture(async (_, number) => {
    if (number === 1) {
      return reply([row('first')], 'synthetic_cursor_1');
    }
    if (number === 2) {
      throw new AppError('NETWORK_ERROR', 'synthetic');
    }
    return reply([row('second')]);
  });
  await f.controller.load('history');
  await f.controller.loadMoreHistory();
  assert.equal(f.state.history.length, 1);
  assert.equal(f.state.historyHasMore, true);
  assert.ok(f.state.historyMoreError);
  await f.controller.loadMoreHistory();
  assert.equal(f.queries[1], f.queries[2]);
  assert.deepEqual(f.queries[1], {
    from: '2026-08-06',
    to: '2026-11-03',
    cursor: 'synthetic_cursor_1',
  });
  assert.equal(f.state.history.length, 2);
  assert.equal(f.state.historyMoreError, '');
  f.controller.dispose();
});

test('W4 repeated next-page taps send once and overlapping daily task rows do not duplicate', async () => {
  const wait = deferred();
  const f = fixture(async (_, number) =>
    number === 1 ? reply([row('first')], 'synthetic_next') : wait.promise,
  );
  await f.controller.load('history');
  const loading = f.controller.loadMoreHistory();
  await f.controller.loadMoreHistory();
  assert.equal(f.queries.length, 2);
  assert.equal(f.state.historyLoadingMore, true);
  wait.resolve(reply([row('first'), row('second')]));
  await loading;
  assert.deepEqual(
    f.state.history.map((x) => x.taskId),
    ['first', 'second'],
  );
  assert.equal(f.state.historyLoadingMore, false);
  f.controller.dispose();
});

for (const event of ['hide', 'switch', 'unload']) {
  test(`W4 history pagination clears private rows and ignores a late page after ${event}`, async () => {
    const wait = deferred();
    const f = fixture(async (_, number) =>
      number === 1 ? reply([row('first')], 'synthetic_next') : wait.promise,
    );
    await f.controller.load('history');
    const loading = f.controller.loadMoreHistory();
    if (event === 'hide') {
      f.controller.suspend();
    }
    if (event === 'switch') {
      f.session.accept(B);
    }
    if (event === 'unload') {
      f.controller.suspend();
      f.controller.dispose();
    }
    const before = JSON.stringify(f.state);
    wait.resolve(reply([row('SYNTHETIC_OLD_A')]));
    await loading;
    assert.equal(JSON.stringify(f.state), before);
    assert.deepEqual(f.state.history, []);
    assert.equal(f.state.historyHasMore, false);
    f.controller.dispose();
  });
}

for (const invalidCursor of [{ invalid: true }, 'synthetic_next']) {
  test(`W4 invalid or looping history cursor does not append a partial next page ${JSON.stringify(invalidCursor)}`, async () => {
    const f = fixture(async (_, number) =>
      number === 1
        ? reply([row('first')], 'synthetic_next')
        : reply([row('unconfirmed')], invalidCursor),
    );
    await f.controller.load('history');
    await f.controller.loadMoreHistory();
    assert.equal(f.state.history.length, 1);
    assert.ok(f.state.historyMoreError);
    assert.equal(f.state.historyLoadingMore, false);
    f.controller.dispose();
  });
}

test('W4 refreshing history discards an outstanding old page and resets pagination', async () => {
  const wait = deferred();
  const f = fixture(async (_, number) =>
    number === 1
      ? reply([row('first')], 'synthetic_next')
      : number === 2
        ? wait.promise
        : reply([row('refreshed')]),
  );
  await f.controller.load('history');
  const loading = f.controller.loadMoreHistory();
  await f.controller.load('history');
  wait.resolve(reply([row('old_page')]));
  await loading;
  assert.deepEqual(
    f.state.history.map((x) => x.taskId),
    ['refreshed'],
  );
  assert.equal(f.state.historyHasMore, false);
  assert.equal(f.state.historyLoadingMore, false);
  f.controller.dispose();
});

for (const code of ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN']) {
  test(`W4 a next-page ${code} clears earlier private history and its cursor`, async () => {
    const f = fixture(async (_, number) => {
      if (number === 1) {
        return reply([row('first')], 'synthetic_next');
      }
      throw new AppError(code, 'synthetic');
    });
    await f.controller.load('history');
    await f.controller.loadMoreHistory();
    assert.deepEqual(f.state.history, []);
    assert.equal(f.state.historyHasMore, false);
    assert.equal(f.state.historyLoadingMore, false);
    assert.equal(f.state.writeBlocked, true);
    await f.controller.loadMoreHistory();
    assert.equal(f.queries.length, 2);
    f.controller.dispose();
  });
}

test('W4 history keeps the initial Beijing date window across midnight and refresh starts a new window', async () => {
  let time = NOW;
  const queries = [],
    session = createSessionState();
  session.accept(A);
  const controller = createCloudTaskController({
    session,
    now: () => time,
    api: {
      history: async (query) => {
        queries.push(query);
        return queries.length === 1
          ? reply([row('first')], 'synthetic_next')
          : reply([row('second')]);
      },
    },
  });
  await controller.load('history');
  time = new Date('2026-11-03T16:05:00Z');
  await controller.loadMoreHistory();
  assert.equal(queries[1].to, '2026-11-03');
  assert.equal(queries[1].from, '2026-08-06');
  await controller.load('history');
  assert.deepEqual(queries[2], { from: '2026-08-07', to: '2026-11-04' });
  controller.dispose();
});

test('W4 actual tasks Page wires the history load-more action to the scoped controller', async () => {
  const file = path.resolve(__dirname, '../miniprogram/pages/tasks/index.js');
  const local = createRequire(file),
    state = createSessionState();
  state.accept(A);
  let definition,
    reads = 0;
  const api = {
    history: async () =>
      ++reads === 1 ? reply([row('first')], 'synthetic_next') : reply([row('second')]),
    quickChoice: async () => ({ ok: true, data: { entries: [] } }),
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {},
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {
          cloudEnabled: true,
          cloudEnvId: 'synthetic-production',
          releaseProfile: 'production',
          trustedSessionEnabled: true,
        };
      }
      if (id.endsWith('/modules/account/cloud-session')) {
        return {
          createCloudSession: () => ({ ...state, refresh: async () => true, dispose() {} }),
        };
      }
      if (id.endsWith('/modules/tasks/service')) {
        return { createPrivateTaskService: () => api };
      }
      return local(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad({ view: 'history' });
  await new Promise(setImmediate);
  assert.equal(page.data.historyHasMore, true);
  await page.onLoadMoreHistory();
  assert.equal(page.data.history.length, 2);
  assert.equal(page.data.historyHasMore, false);
  assert.match(
    fs.readFileSync(file.replace('.js', '.wxml'), 'utf8'),
    /bindtap="onLoadMoreHistory"/,
  );
  page.onUnload();
});

for (const versionLookup of ['missing', 'throws']) {
  test(`W4 Me page enters task history with full production capabilities when version lookup ${versionLookup}`, () => {
    const file = path.resolve(__dirname, '../miniprogram/pages/me/index.js');
    const local = createRequire(file);
    const navigations = [];
    const cloudSessionState = {
      capture: () => null,
      subscribe: () => () => {},
    };
    const environment = {
      cloudEnabled: true,
      cloudEnvId: 'synthetic-production',
      releaseProfile: 'production',
      trustedSessionEnabled: true,
    };
    let definition;
    const wx = {
      ...(versionLookup === 'throws'
        ? {
            getAccountInfoSync: () => {
              throw new Error('synthetic unavailable');
            },
          }
        : {}),
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Page: (value) => {
        definition = value;
      },
      setTimeout,
      clearTimeout,
      wx,
      require(id) {
        if (id.endsWith('/config/environment.local')) {
          return environment;
        }
        if (id.endsWith('/modules/share/app-share')) {
          return {
            createAppShare: () => ({}),
            enableAppShare() {},
            prepareSharedPage: () => false,
          };
        }
        if (id.endsWith('/modules/account/cloud-session')) {
          return {};
        }
        if (id.endsWith('/services/session-state')) {
          return { cloudSessionState };
        }
        if (id.endsWith('/system/page-navigation')) {
          return {
            navigateOnce: (_page, _wx, url) => navigations.push(url),
            resetPageNavigation() {},
            pausePageNavigation() {},
          };
        }
        if (id.endsWith('/presentation/jiaqi-design')) {
          return { syncTab() {} };
        }
        if (id.endsWith('/account/login-memory')) {
          return { hasRememberedLogin: () => false, forgetLogin() {} };
        }
        if (id.endsWith('/system/health')) {
          return { checkHealth: async () => ({ ok: true }) };
        }
        if (id.endsWith('/system/runtime')) {
          return { appRuntime: { showUpdateStatus() {} } };
        }
        return local(id);
      },
    });
    const page = {
      ...definition,
      data: { ...definition.data },
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
    page.onLoad();
    assert.equal(page.data.tasksAvailable, true);
    page.onTasks();
    assert.deepEqual(navigations, ['/pages/tasks/index?view=history']);
    page.onUnload();
  });
}
