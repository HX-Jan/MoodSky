const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createTaskDemoService } = require('../miniprogram/modules/tasks/demo');
test('implicit task selection and replacement cycles create current transitions', () => {
  const service = createTaskDemoService({ authenticated: true });
  for (let i = 0; i < 3; i++) {
    service.transition({ taskId: 'task_demo_001', action: 'select' });
    const result = service.transition({ taskId: 'task_demo_001', action: 'replace' });
    assert.equal(result.state, 'replaced');
    assert.equal(service.snapshot().suggestions[0].state, 'replaced');
  }
  assert.equal(service.getHistory().length, 8);
});
test('explicit task receipts preserve identity across reordered fields and reject unsafe controls', () => {
  const service = createTaskDemoService({ authenticated: true });
  const first = service.transition({
    taskId: 'task_demo_001',
    action: 'select',
    requestId: 'task_repeat_001',
  });
  const second = service.transition({
    requestId: 'task_repeat_001',
    action: 'select',
    taskId: 'task_demo_001',
  });
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(second.idempotent, true);
  for (const input of [
    null,
    { taskId: 'task_demo_001', action: 'select', requestId: 123 },
    { taskId: 'task_demo_001', action: 'select', ownerId: 'other' },
  ]) {
    assert.throws(() => service.transition(input), { code: 'INVALID_INPUT' });
  }
});
function load(name, config, query = {}, taskApi, healthCheck) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  const stored = new Map();
  const urls = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    setTimeout,
    clearTimeout,
    Page(value) {
      definition = value;
    },
    wx: {
      getStorageSync: (key) => stored.get(key),
      setStorageSync: (key, value) => stored.set(key, value),
      navigateTo: ({ url }) => urls.push(url),
      switchTab: ({ url }) => urls.push(url),
      showToast() {},
    },
    require(id) {
      if (healthCheck && id.endsWith('/modules/system/health')) {
        return { checkHealth: healthCheck };
      }
      if (taskApi && id.endsWith('/modules/tasks/cloud')) {
        const { createCloudTaskController } = localRequire(id);
        return {
          createCloudTaskController: ({ publish }) =>
            createCloudTaskController({
              api: taskApi,
              publish,
              session: { capture: () => taskApi, isCurrent: (token) => token === taskApi },
            }),
        };
      }
      return id.endsWith('/config/environment.local') ? config : localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      Object.assign(this.data, values);
    },
  };
  page.onLoad(query);
  return { page, urls };
}
test('task page only offers synthetic operations with explicit demo mode and disabled cloud', () => {
  for (const config of [{ cloudEnabled: true, journalDemo: true }, { cloudEnabled: false }]) {
    const { page } = load('tasks', config);
    page.onToggleAuth();
    page.onTaskAction({
      currentTarget: { dataset: { taskId: 'task_demo_001', action: 'select' } },
    });
    assert.equal(page.data.isDemo, false);
    assert.equal(page.data.suggestions.length, 0);
    assert.equal(page._service, undefined);
  }
  const { page } = load('tasks', { cloudEnabled: false, journalDemo: true });
  assert.equal(page.data.suggestions.length, 3);
  page.onToggleAuth();
  for (const action of ['select', 'replace', 'select', 'replace']) {
    page.onTaskAction({ currentTarget: { dataset: { taskId: 'task_demo_001', action } } });
  }
  assert.equal(page.data.suggestions[0].state, 'replaced');
  page.onUnload();
  const historyPage = load(
    'tasks',
    { cloudEnabled: false, journalDemo: true },
    { view: 'history' },
  ).page;
  assert.equal(historyPage.data.view, 'history');
  assert.equal(historyPage.data.isAuthenticated, false);
  assert.equal(historyPage.data.history.length, 0);
  historyPage.onUnload();
});
test('Me retains account preferences and local health while opening the task route', async () => {
  const { page, urls } = load('me', {});
  page.switchAccount({ currentTarget: { dataset: { id: 'demo-b' } } });
  page.onPreviewChange({
    currentTarget: { dataset: { key: 'cardTextPreview' } },
    detail: { value: true },
  });
  assert.equal(page.data.accountId, 'demo-b');
  assert.equal(page.data.preferences.cardTextPreview, true);
  page.onTasks();
  assert.equal(urls[0], '/pages/tasks/index?view=history');
  await page.runHealth();
  assert.match(page.data.healthText, /本地合成校验通过/);
  assert.equal(page.data.healthVersion, require('../miniprogram/shared/constants').APP_VERSION);
  assert.equal(typeof page.startExport, 'function');
  assert.equal(typeof page.confirmAccount, 'function');
  page.onUnload();
  const app = require('../miniprogram/app.json');
  for (const route of [
    'pages/record/index',
    'pages/review/archive/index',
    'pages/review/month/index',
    'pages/review/detail/index',
    'pages/review/insights/index',
    'pages/tasks/index',
  ]) {
    assert(app.pages.includes(route));
  }
});

test('cloud page events reach task services, preserve failed actions and route quick choices without journal writes', async () => {
  const sent = [];
  let fail = true;
  const api = {
    suggestions: async () => ({
      ok: true,
      data: { items: [{ taskId: 'tpl', title: '合成夹具', durationMin: 3, state: null }] },
    }),
    history: async () => ({
      ok: true,
      data: { items: [{ taskId: 'tpl', date: '2026-10-20', state: 'completed' }] },
    }),
    quickChoice: async () => ({
      ok: true,
      data: { entries: [{ kind: 'places', enabled: true, label: '校园' }] },
    }),
    createTransitionRequest: (payload) =>
      Object.freeze({ requestId: 'original', payload: Object.freeze(payload) }),
    submit: async (request) => {
      sent.push(request);
      if (fail) {
        throw { code: 'NETWORK_ERROR' };
      }
      return { ok: true, data: { taskId: 'tpl', state: 'selected' } };
    },
  };
  const { page, urls } = load('tasks', { cloudEnabled: true }, {}, api);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.data.isDemo, false);
  assert.equal(page.data.suggestions.length, 1);
  await page.onTaskAction({ currentTarget: { dataset: { taskId: 'tpl', action: 'select' } } });
  assert.equal(page.data.suggestions[0].state, 'available');
  assert.equal(page.data.retryPending, true);
  fail = false;
  await page.onRetry();
  assert.equal(sent[0], sent[1]);
  assert.equal(page.data.suggestions[0].state, 'selected');
  await page.onView({ currentTarget: { dataset: { view: 'history' } } });
  assert.equal(page.data.history[0].date, '2026-10-20');
  page.onQuickChoice({ currentTarget: { dataset: { kind: 'places' } } });
  assert.equal(urls[0], '/pages/campus/index');
  page.onUnload();
});

test('Me health retry and account switch clear old error codes and reject late results', async () => {
  let finish;
  let calls = 0;
  const { page } = load(
    'me',
    { cloudEnabled: true, cloudEnvId: 'synthetic-only' },
    {},
    undefined,
    async () => {
      if (++calls === 1) {
        return { ok: false, code: 'UNAUTHENTICATED', message: 'synthetic', requestId: 'old' };
      }
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  await page.runHealth();
  assert.equal(page.data.healthCode, 'UNAUTHENTICATED');
  const next = page.runHealth();
  assert.equal(page.data.healthCode, '');
  assert.equal(page.data.feedbackState, 'loading');
  page.switchAccount({ currentTarget: { dataset: { id: 'demo-b' } } });
  assert.equal(page.data.healthCode, '');
  assert.equal(page.data.healthRequestId, '');
  assert.equal(page.data.feedbackState, 'empty');
  finish({ ok: true, apiVersion: '1', requestId: 'late' });
  await next;
  assert.equal(page.data.healthText, '尚未检查');
  page.onUnload();
});

test('actual task page lifecycle clears history and ignores delayed reads until a fresh show', async () => {
  let finish;
  let calls = 0;
  const { page } = load(
    'tasks',
    { cloudEnabled: true },
    { view: 'history' },
    {
      history: () =>
        ++calls === 1
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({ ok: true, data: { items: [] } }),
      quickChoice: async () => ({ ok: true, data: { entries: [] } }),
    },
  );
  page.onHide();
  const hidden = JSON.stringify(page.data);
  finish({
    ok: true,
    data: { items: [{ taskId: 'old', date: '2026-10-21', state: 'completed' }] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(JSON.stringify(page.data), hidden);
  page.onShow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  assert.equal(page.data.history.length, 0);
  page.setData({ history: [{ title: 'SYNTHETIC CACHE' }] });
  page.onUnload();
  assert.equal(page.data.history.length, 0);
});
