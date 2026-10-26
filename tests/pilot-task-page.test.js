const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate } = require('node:timers');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createCloudSession } = require('../miniprogram/modules/account/cloud-session');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/tasks/index.js'),
    localRequire = createRequire(file);
  const state = createSessionState(),
    auth = [];
  let definition;
  let reads = 0,
    currentState = null;
  const session = createCloudSession({
    state,
    authenticate: () => new Promise((resolve) => auth.push(resolve)),
  });
  const api = {
    async suggestions() {
      reads++;
      return {
        ok: true,
        data: {
          items: [{ taskId: 'task_a', title: '合成测试', durationMin: 2, state: currentState }],
          readOnly: false,
        },
      };
    },
    async quickChoice() {
      return { ok: true, data: { entries: [] } };
    },
    async history() {
      reads++;
      return { ok: true, data: { items: [] } };
    },
    createTransitionRequest: (payload) => ({ payload }),
    async submit(request) {
      currentState = request.payload.transition === 'complete' ? 'completed' : 'selected';
      return { ok: true, data: { taskId: 'task_a', state: currentState } };
    },
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
          cloudFunctionName: 'moodsky-private-pilot',
          trustedSessionEnabled: true,
        };
      }
      if (id.endsWith('/modules/account/cloud-session')) {
        return { createCloudSession: () => session };
      }
      if (id.endsWith('/modules/tasks/service')) {
        return { createPrivateTaskService: () => api };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  return {
    page,
    auth,
    state,
    reads: () => reads,
    approve(index = 0) {
      auth[index]({
        ok: true,
        data: {
          authenticated: true,
          scope: 'scope_' + 'a'.repeat(64),
          capabilities: ['journal', 'review', 'tasks'],
        },
      });
    },
  };
}

test('real task page waits for the server session, then reloads authoritative task state after a write', async () => {
  const { page, approve, reads } = fixture();
  page.onLoad();
  page.onShow();
  assert.equal(reads(), 0);
  approve();
  await tick();
  assert.equal(page.data.isAuthenticated, true);
  assert.equal(page.data.suggestions[0].canSelect, true);
  await page.onTaskAction({ currentTarget: { dataset: { taskId: 'task_a', action: 'select' } } });
  assert.equal(page.data.suggestions[0].state, 'selected');
  await page.onTaskAction({ currentTarget: { dataset: { taskId: 'task_a', action: 'complete' } } });
  assert.equal(page.data.suggestions[0].state, 'completed');
  assert.equal(page.data.suggestions[0].canSelect, false);
  assert.equal(reads(), 3);
  page.onUnload();
});

test('hidden task page ignores the initial handshake until a fresh visible session verification', async () => {
  const { page, approve, reads } = fixture();
  page.onLoad();
  page.onHide();
  approve();
  await tick();
  assert.equal(reads(), 0);
  assert.equal(page.data.suggestions.length, 0);
  page.onShow();
  approve(1);
  await tick();
  assert.equal(reads(), 1);
  assert.equal(page.data.isAuthenticated, true);
  page.onUnload();
});

test('unloaded page cannot install a late login response or read private task data', async () => {
  const { page, approve, reads, state } = fixture();
  page.onLoad();
  page.onUnload();
  approve();
  await tick();
  assert.equal(state.capture(), null);
  assert.equal(reads(), 0);
});

test('pilot Me never loads synthetic account storage or presents a connection check as confirmed saving', async () => {
  const file = path.resolve(__dirname, '../miniprogram/pages/me/index.js'),
    localRequire = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    setTimeout,
    clearTimeout,
    wx: {
      getStorageSync() {
        throw Error('Pilot must not load demo identity');
      },
    },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {
          cloudEnabled: true,
          cloudFunctionName: 'moodsky-private-pilot',
          trustedSessionEnabled: true,
        };
      }
      if (id.endsWith('/modules/system/health')) {
        return {
          checkHealth: async () => ({ ok: true, requestId: 'req_pilot_health', version: '0.2.3' }),
        };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad();
  assert.equal(page.data.isPilot, true);
  assert.equal(page.account, undefined);
  await page.runHealth();
  assert.match(page.data.healthText, /实际保存需单独验证/);
  page.onUnload();
});
