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
function load(name, config) {
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
      showToast() {},
    },
    require(id) {
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
  page.onLoad();
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
  assert.equal(urls[0], '/pages/tasks/index');
  await page.runHealth();
  assert.match(page.data.healthText, /本地合成校验通过/);
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
