const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers/promises');
const { clientCapabilities } = require('../miniprogram/modules/system/capabilities');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createRequest } = require('../miniprogram/services/api');
const { createLocalStorage } = require('./helpers/local-storage');
const { businessDate } = require('../miniprogram/shared/date');
const production = {
  cloudEnabled: true,
  cloudEnvId: 'synthetic-w5',
  cloudFunctionName: 'moodsky-release',
  trustedSessionEnabled: true,
  releaseProfile: 'production',
  explicitWechatLogin: true,
};
const row = (state = 'available') => ({
  taskId: 'synthetic_w5',
  title: '合成任务',
  durationMin: 2,
  state,
});
const ok = (data) => ({ ok: true, data });
const event = (dataset) => ({ currentTarget: { dataset } });
function pageFixture(
  mode,
  { name = 'tasks', authenticated = false, failRead = false, scene, demo = false } = {},
) {
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const local = createRequire(file),
    state = createSessionState(),
    calls = [],
    navigations = [],
    menus = [];
  if (authenticated) {
    state.accept('scope_' + 'a'.repeat(64));
  }
  let definition;
  const wx = {
    ...createLocalStorage(),
    navigateTo: (x) => navigations.push(x),
    switchTab: (x) => navigations.push(x),
    showActionSheet: (x) => menus.push(x),
    showToast() {},
    ...(scene ? { getLaunchOptionsSync: () => ({ scene }) } : {}),
  };
  const publicApi = {
    suggestions: async () => {
      calls.push('tasks.suggestions');
      if (failRead) {
        throw { code: 'NETWORK_ERROR' };
      }
      return ok({ items: [row()], readOnly: false });
    },
    quickChoice: async () => {
      calls.push('tasks.quickChoice');
      return ok({ entries: [] });
    },
  };
  const privateApi = {
    suggestions: async () => {
      calls.push('tasks.mine');
      return ok({ items: [row()], readOnly: false });
    },
    quickChoice: publicApi.quickChoice,
    history: async () => {
      calls.push('tasks.history');
      return ok({ items: [], nextCursor: null });
    },
    createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
    submit: async (request) => {
      calls.push(request);
      return ok({ taskId: 'synthetic_w5', state: 'selected', date: request.payload.expectedDate });
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {
          ...production,
          ...(mode === undefined ? {} : { taskMode: mode }),
          ...(demo
            ? { releaseProfile: 'development', journalDemo: true, cloudEnabled: false }
            : {}),
        };
      }
      if (id.endsWith('/modules/tasks/service')) {
        return { ...publicApi, createPrivateTaskService: () => privateApi };
      }
      if (id.endsWith('/modules/account/cloud-session')) {
        return {
          createCloudSession: () => {
            calls.push('createSession');
            return {
              ...state,
              refresh: async () => {
                calls.push('account.session');
                return Boolean(state.capture());
              },
              dispose() {},
            };
          },
        };
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: state };
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
  return { page, state, calls, navigations, menus, privateApi, publicApi };
}

for (const mode of [undefined, 'closed', 'typo', true]) {
  test(`W5 task release scope ${String(mode)} fails closed even with a valid session`, async () => {
    const f = pageFixture(mode, { authenticated: true });
    f.page.onLoad({ view: 'history' });
    f.page.onShow();
    await setImmediate();
    assert.equal(f.page.data.tasksClosed, true);
    assert.equal(f.page._cloud, undefined);
    await f.page.onRetry();
    await f.page.onTaskAction(event({ taskId: 'synthetic_w5', action: 'complete' }));
    assert.deepEqual(f.calls, []);
    f.page.onCampus();
    assert.equal(f.navigations[0].url, '/pages/campus/index');
    f.page.onUnload();
  });
}
test('W5 capabilities separate public suggestions from personal history, without granting server access', () => {
  const closed = clientCapabilities(production).tasks;
  assert.equal(closed.state, 'unavailable');
  assert.equal(closed.historyAvailable, false);
  const readonly = clientCapabilities({ ...production, taskMode: 'readOnly' }).tasks;
  assert.equal(readonly.state, 'readOnly');
  assert.equal(readonly.historyAvailable, false);
  assert.equal(
    clientCapabilities({ ...production, taskMode: 'enabled' }).tasks.historyAvailable,
    true,
  );
  assert.equal(
    clientCapabilities({ ...production, trustedSessionEnabled: false, taskMode: 'enabled' }).tasks
      .state,
    'unavailable',
  );
});
test('W5 readonly Page ignores a history deep link and never opens session, private reads, outbox or writes', async () => {
  const f = pageFixture('readOnly', { authenticated: true });
  f.page.onLoad({ view: 'history' });
  await setImmediate();
  assert.equal(f.page.data.view, 'suggestions');
  assert.equal(f.page.data.tasksReadOnly, true);
  assert.equal(f.page.data.taskListLoaded, true);
  assert.equal(f.page.data.suggestions.length, 1);
  await f.page.onView(event({ view: 'history' }));
  await f.page.onTaskAction(event({ taskId: 'synthetic_w5', action: 'complete' }));
  await f.page.onRetry();
  await f.page.onLoadMoreHistory();
  f.page.onWechatLogin();
  assert(f.calls.every((x) => ['tasks.suggestions', 'tasks.quickChoice'].includes(x)));
  assert.equal(f.page._cloudSession, null);
  assert.equal(f.navigations.length, 0);
  f.page.onHide();
  f.page.onShow();
  await setImmediate();
  assert(f.calls.every((x) => ['tasks.suggestions', 'tasks.quickChoice'].includes(x)));
  f.page.onUnload();
});
test('W5 readonly demo also rejects forced login, private history and task actions', () => {
  const f = pageFixture('readOnly', { demo: true });
  f.page.onLoad();
  const before = JSON.stringify(f.page.data.suggestions);
  f.page.onToggleAuth();
  f.page.onView(event({ view: 'history' }));
  f.page.onTaskAction(event({ taskId: f.page.data.suggestions[0].id, action: 'select' }));
  assert.equal(f.page.data.isAuthenticated, false);
  assert.equal(f.page.data.view, 'suggestions');
  assert.equal(JSON.stringify(f.page.data.suggestions), before);
  assert.deepEqual(f.calls, []);
  f.page.onUnload();
});
test('W5 enabled guest reads only public suggestions and explicitly logs in to the original task history route', async () => {
  const f = pageFixture('enabled');
  f.page.onLoad({ view: 'history' });
  await setImmediate();
  assert.equal(f.page.data.isAuthenticated, false);
  assert.equal(f.page.data.view, 'suggestions');
  assert(f.calls.includes('tasks.suggestions'));
  assert(!f.calls.includes('tasks.mine'));
  assert(!f.calls.includes('account.session'));
  f.page.onWechatLogin();
  assert.match(f.navigations[0].url, /returnTo=%2Fpages%2Ftasks%2Findex%3Fview%3Dhistory/);
  f.page.onHide();
  f.page.onWechatLogin();
  assert.equal(f.navigations.length, 1);
  f.page.onUnload();
});
for (const mode of ['closed', 'readOnly', 'enabled']) {
  test(`W5 task ${mode} timeline scene 1154 remains static and makes no service calls`, async () => {
    const f = pageFixture(mode, { scene: 1154 });
    f.page.onLoad({ view: 'history' });
    f.page.onShow();
    await setImmediate();
    assert.equal(f.page.data.shareSinglePage, true);
    assert.deepEqual(f.calls, []);
    f.page.onWechatLogin();
    f.page.onCampus();
    f.page.onRetry();
    assert.equal(f.navigations.length, 0);
  });
}
for (const mode of ['closed', 'readOnly', 'enabled']) {
  test(`W5 Today ${mode} scope matches the visible menu and cannot navigate through a removed task option`, () => {
    const f = pageFixture(mode, { name: 'today' });
    f.page._journal = {
      getState: () => ({ inputLocked: false, date: '2026-11-09' }),
      dispose() {},
    };
    f.page.onNeeds();
    assert.equal(f.menus.length, 1);
    assert.equal(f.menus[0].itemList.length, mode === 'closed' ? 1 : 2);
    f.menus[0].success({ tapIndex: 1 });
    assert.equal(f.navigations.length, mode === 'closed' ? 0 : 1);
    f.page.onUnload();
  });
}
test('W5 failed suggestions and failed history never become confirmed empty states', async () => {
  const f = pageFixture('readOnly', { failRead: true });
  f.page.onLoad();
  await setImmediate();
  assert.equal(f.page.data.taskListLoaded, false);
  assert.equal(f.page.data.errorCode, 'NETWORK_ERROR');
  assert.match(f.page.data.notice, /读取失败/);
  f.page.onUnload();
  const state = {},
    session = {
      capture: () => 'synthetic',
      isCurrent: (x) => x === 'synthetic',
      subscribe: () => () => {},
    };
  let failed = false;
  const c = createCloudTaskController({
    session,
    publish: (p) => Object.assign(state, p),
    api: {
      history: async () => {
        if (failed) {
          throw { code: 'NETWORK_ERROR' };
        }
        return ok({ items: [] });
      },
    },
  });
  await c.load('history');
  assert.equal(state.historyLoaded, true);
  failed = true;
  await c.load('history');
  assert.equal(state.historyLoaded, false);
  assert.match(state.notice, /读取失败/);
  c.dispose();
});
test('W5 readonly build rejects a private completed state and cannot be promoted by readOnly:false', async () => {
  const state = {},
    calls = [];
  let taskState = 'available';
  const c = createCloudTaskController({
    readOnly: true,
    publish: (p) => Object.assign(state, p),
    api: {
      suggestions: async () => ok({ items: [row(taskState)], readOnly: false }),
      submit: async (x) => calls.push(x),
      history: async () => calls.push('history'),
    },
  });
  await c.load();
  assert.equal(state.tasksReadOnly, true);
  await c.transition('synthetic_w5', 'select');
  await c.load('history');
  assert.deepEqual(calls, []);
  taskState = 'completed';
  await c.load();
  assert.equal(state.errorCode, 'INVALID_RESPONSE');
  assert.equal(state.taskListLoaded, false);
  assert.equal(state.suggestions.length, 0);
  c.dispose();
});
test('W5 pending operation remains visibly unconfirmed until the original request is acknowledged', async () => {
  const state = {},
    sent = [],
    session = {
      capture: () => 'synthetic',
      isCurrent: (x) => x === 'synthetic',
      subscribe: () => () => {},
    };
  let acknowledge;
  const c = createCloudTaskController({
    session,
    publish: (p) => Object.assign(state, p),
    api: {
      suggestions: async () => ok({ items: [row()], readOnly: false }),
      createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
      submit: (request) => {
        sent.push(request);
        return new Promise((resolve) => {
          acknowledge = () =>
            resolve(
              ok({ taskId: 'synthetic_w5', state: 'selected', date: request.payload.expectedDate }),
            );
        });
      },
    },
  });
  await c.load();
  const writing = c.transition('synthetic_w5', 'select');
  assert.equal(state.busy, true);
  assert.equal(state.retryPending, true);
  assert.equal(state.writeBlocked, true);
  assert.equal(state.suggestions[0].state, 'available');
  await c.transition('synthetic_w5', 'complete');
  assert.equal(sent.length, 1);
  acknowledge();
  await writing;
  assert.equal(state.retryPending, false);
  assert.equal(state.suggestions[0].state, 'selected');
  c.dispose();
});
test('W5 task markup keeps empty history conditional on successful reading and uses an explicit guest login', () => {
  const s = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/tasks/index.wxml'),
    'utf8',
  );
  assert.match(s, /history.length === 0 && \(isDemo \|\| historyLoaded\)/);
  assert.match(s, /bindtap="onWechatLogin"/);
  assert.doesNotMatch(s, /暂无任务建议/);
  assert.match(s, /tasksReadOnly \? '建议' : item.stateLabel/);
  assert.equal(businessDate(new Date('2026-11-08T16:00:00Z')), '2026-11-09');
});
