const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const now = () => new Date('2026-11-02T04:00:00Z');
const scope = (letter) => 'scope_' + letter.repeat(64);
const row = {
  id: 'synthetic_A',
  date: '2026-11-02',
  weather: 'CUSTOM',
  weatherName: '旧账号名称',
  tags: ['CALM'],
  text: 'SYNTHETIC_PRIVATE_A',
  version: 1,
  createdAt: '2026-11-02T04:00:00.000Z',
  updatedAt: '2026-11-02T04:00:00.000Z',
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function loadPage(name, state, service) {
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    getCurrentPages: () => [],
    wx: { getStorageSync: () => true },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { cloudEnabled: true, explicitWechatLogin: true, releaseProfile: 'production' };
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: state };
      }
      if (id.endsWith('/journal/service')) {
        return service;
      }
      if (id.endsWith('/journal/controller')) {
        return {
          createJournalController: (options) => createJournalController({ ...options, now }),
        };
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
  page.onLoad({ date: row.date });
  return page;
}
for (const name of ['today', 'record']) {
  test(`W4 H02 ${name} removes old account draft on logout and A→B→A without a page show`, async () => {
    const state = createSessionState();
    state.accept(scope('a'));
    const page = loadPage(name, state, { get: async () => ({ ok: true, data: { entry: row } }) });
    await settle();
    page._journal.setText('SYNTHETIC_UNSAVED_A');
    assert.equal(page._journal.getState().hasUnsavedChanges, true);
    page.onHide?.();
    state.clear();
    state.accept(scope('b'));
    state.accept(scope('a'));
    const result = page._journal.getState();
    assert.equal(result.loaded, false);
    assert.equal(result.entry, null);
    assert.equal(result.text, '');
    assert.equal(result.weatherName, '');
    assert.equal(result.pendingRetry, false);
    assert.equal(await page._journal.save(), false);
    assert.doesNotMatch(JSON.stringify(page.data), /SYNTHETIC_|旧账号名称/);
    page.onUnload();
  });
}
test('W4 H02 a late save from A cannot repopulate B or trigger a saved notification', async () => {
  const state = createSessionState();
  state.accept(scope('a'));
  let complete;
  const notifications = [];
  const controller = createJournalController({
    sessionState: state,
    now,
    service: {
      get: async () => ({ ok: true, data: { entry: null } }),
      createSaveRequest: (input) => createRequest('journal.upsert', input),
      submit: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
    onChanged: (value) => notifications.push(value),
  });
  await controller.loadDate(row.date);
  controller.chooseWeather('CUSTOM');
  controller.setWeatherName('旧账号名称');
  const pending = controller.save();
  state.accept(scope('b'));
  complete({ ok: true, data: { entry: { ...row, text: '', tags: [] } } });
  assert.equal(await pending, false);
  assert.equal(controller.getState().loaded, false);
  assert.equal(controller.getState().entry, null);
  assert.equal(await controller.retry(), false);
  assert.deepEqual(notifications, []);
  controller.dispose();
});
test('W4 H02 same-account offline retry keeps the identical request and first authentication does not cancel a read', async () => {
  const state = createSessionState();
  let finish,
    attempts = 0;
  const requests = [];
  const controller = createJournalController({
    sessionState: state,
    now,
    service: {
      get: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      createSaveRequest: (input) => createRequest('journal.upsert', input),
      submit: async (request) => {
        requests.push(request);
        attempts++;
        if (attempts === 1) {
          throw new AppError('NETWORK_ERROR', 'SYNTHETIC');
        }
        return { ok: true, data: { entry: { ...row, text: '', tags: [] } } };
      },
    },
  });
  const loading = controller.loadDate(row.date);
  state.accept(scope('a'));
  finish({ ok: true, data: { entry: null } });
  assert.equal(await loading, true);
  controller.chooseWeather('CUSTOM');
  controller.setWeatherName(row.weatherName);
  assert.equal(await controller.save(), false);
  state.accept(scope('a'));
  assert.equal(controller.getState().pendingRetry, true);
  assert.equal(await controller.retry(), true);
  assert.equal(requests[0], requests[1]);
  assert.equal(controller.getState().entry.weatherName, row.weatherName);
  controller.dispose();
});
