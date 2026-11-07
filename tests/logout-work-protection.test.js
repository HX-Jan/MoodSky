const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createAppRuntime } = require('../miniprogram/modules/system/runtime');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { LOGIN_KEY } = require('../miniprogram/modules/account/login-memory');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createProductionAccountController } = require('../miniprogram/modules/account/production');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');

function surface(name) {
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    require: createRequire(file),
  });
  return {
    ...definition,
    _connectSequence: 0,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

async function hiddenTask(f, t, submit) {
  const p = surface('tasks');
  const sent = [];
  p._cloud = createCloudTaskController({
    now: () => new Date('2026-11-04T04:00:00.000Z'),
    session: f.state,
    publish: (patch) => p.setData(patch),
    api: {
      suggestions: async () => ({
        ok: true,
        data: {
          items: [
            {
              taskId: 'synthetic_task',
              title: '合成任务',
              durationMin: 2,
              state: 'available',
            },
          ],
        },
      }),
      quickChoice: async () => ({ ok: true, data: { entries: [] } }),
      createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
      submit(input) {
        sent.push(input);
        return submit(input);
      },
    },
  });
  const untrack = f.runtime.trackPage(p);
  t.after(() => {
    p._cloud.dispose();
    untrack();
  });
  await p._cloud.load();
  return { page: p, controller: p._cloud, sent };
}

async function fixture(t) {
  const state = createSessionState();
  const binding = state.accept('scope_' + 'a'.repeat(64));
  const values = new Map([[LOGIN_KEY, true]]);
  const modals = [],
    notices = [],
    sent = [];
  const platform = {
    getStorageSync: (key) => values.get(key),
    removeStorageSync: (key) => values.delete(key),
    showModal: (input) => modals.push(input),
    showToast: (input) => notices.push(input.title),
  };
  const now = () => new Date('2026-11-04T04:00:00.000Z');
  const memory = createMemoryJournalService({ now });
  const journal = createJournalController({
    service: {
      ...memory,
      submit(input) {
        sent.push(input);
        return memory.submit(input);
      },
    },
    now,
    sessionState: state,
  });
  await journal.loadDate();
  const pages = [];
  const runtime = createAppRuntime({ pages: () => pages });
  // Cached Today has cleared its render layer; its real controller still owns the draft.
  const untrack = runtime.trackPage({ data: {}, _journal: journal });
  const file = path.resolve(__dirname, '../miniprogram/pages/me/index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../modules/system/runtime') {
        return { appRuntime: runtime };
      }
      if (id === '../../config/environment.local') {
        return { releaseProfile: 'production' };
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
  pages.push(page);
  page.onLoad();
  page.loadWechatProfile = () => {}; // No profile transport is part of these logout tests.
  t.after(() => {
    page.onUnload();
    journal.dispose();
    untrack();
  });
  return {
    page,
    runtime,
    journal,
    memory,
    state,
    binding,
    values,
    modals,
    notices,
    sent,
    platform,
  };
}

test('logout sees a hidden real journal draft, cancel preserves it and only explicit confirmation discards it', async (t) => {
  const f = await fixture(t);
  f.journal.chooseWeather('SUNNY');
  f.journal.setText('synthetic unsaved text');
  f.page.onLogout();
  f.page.onLogout();
  assert.equal(f.journal.getState().text, 'synthetic unsaved text');
  assert.equal(f.modals.length, 1);
  assert.equal(f.state.capture(), f.binding);
  f.modals[0].success({ confirm: false });
  assert.equal(f.values.get(LOGIN_KEY), true);
  f.page.onLogout();
  f.modals[0].complete();
  f.page.onLogout();
  assert.equal(f.modals.length, 2);
  f.modals[1].success({ confirm: true });
  assert.equal(f.state.capture(), null);
  assert.equal(f.values.has(LOGIN_KEY), false);
  assert.equal(f.journal.getState().text, '');
  assert.equal(f.sent.length, 0);
});

test('logout cannot discard an unknown save or automatically replay it; explicit retry retains the original request', async (t) => {
  const f = await fixture(t);
  f.journal.chooseWeather('SUNNY');
  f.memory.failNext('after-save');
  assert.equal(await f.journal.save(), false);
  const original = f.sent[0];
  f.page.onLogout();
  assert.equal(f.state.capture(), f.binding);
  assert.equal(f.journal.getState().pendingRetry, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.modals.length, 0);
  assert.match(f.notices.at(-1), /重试.*退出/);
  assert.equal(await f.journal.retry(), true);
  assert.equal(f.sent[1], original);
  assert.equal((await f.memory.get('2026-11-04')).data.entry.version, 1);
});

test('a save that becomes uncertain while logout confirmation is open prevents logout', async (t) => {
  const f = await fixture(t);
  f.journal.chooseWeather('SUNNY');
  f.page.onLogout();
  assert.equal(f.modals.length, 1);
  f.memory.failNext('after-save');
  await f.journal.save();
  f.modals[0].success({ confirm: true });
  assert.equal(f.state.capture(), f.binding);
  assert.equal(f.values.get(LOGIN_KEY), true);
  assert.equal(f.journal.getState().pendingRetry, true);
  assert.equal(f.sent.length, 1);
  assert.match(f.notices.at(-1), /重试/);
});

test('logout dialog exceptions and failure keep the draft and allow retry without stale completion unlocking a new dialog', async (t) => {
  const f = await fixture(t);
  f.journal.chooseWeather('SUNNY');
  f.platform.showModal = () => {
    throw Error('synthetic dialog unavailable');
  };
  assert.doesNotThrow(() => f.page.onLogout());
  assert.equal(f.state.capture(), f.binding);
  assert.equal(f.notices.length, 1);
  f.platform.showModal = (input) => f.modals.push(input);
  f.page.onLogout();
  f.modals[0].fail();
  f.page.onLogout();
  f.modals[0].complete();
  f.page.onLogout();
  assert.equal(f.modals.length, 2);
  assert.equal(f.notices.length, 2);
  assert.equal(f.journal.getState().weather, 'SUNNY');
});

for (const boundary of ['hide', 'unload', 'account']) {
  test(`old logout confirmation cannot affect the account after ${boundary}`, async (t) => {
    const f = await fixture(t);
    f.journal.chooseWeather('SUNNY');
    f.page.onLogout();
    assert.equal(f.modals.length, 1);
    if (boundary === 'hide') {
      f.page.onHide();
      f.page.onShow();
    } else if (boundary === 'unload') {
      f.page.onUnload();
    } else {
      f.state.accept('scope_' + 'b'.repeat(64));
      await f.journal.loadDate();
      f.journal.chooseWeather('CLOUDY');
    }
    const binding = f.state.capture();
    f.modals[0].success({ confirm: true });
    assert.equal(f.state.capture(), binding);
    assert.equal(f.values.get(LOGIN_KEY), true);
    assert.equal(f.notices.length, 0);
  });
}

test('queued logout from a hidden or static My page cannot clear a clean account', async (t) => {
  const f = await fixture(t);
  f.page.onHide();
  f.page.onLogout();
  assert.equal(f.state.capture(), f.binding);
  f.page.onShow();
  f.page.data.shareSinglePage = true;
  f.page.onLogout();
  f.page.data.shareSinglePage = false;
  f.page._shareLoginRedirected = true;
  f.page.onLogout();
  assert.equal(f.state.capture(), f.binding);
  assert.equal(f.values.get(LOGIN_KEY), true);
  assert.equal(f.modals.length, 0);
});

test('hidden task original retry blocks logout and updates even when its rendered busy/retry flags were cleared', async (t) => {
  const f = await fixture(t);
  let fail = true;
  const task = await hiddenTask(f, t, async () => {
    if (fail) {
      throw new AppError('NETWORK_ERROR', 'synthetic uncertain task');
    }
    return { ok: true, data: { taskId: 'synthetic_task', state: 'selected', date: '2026-11-04' } };
  });
  await task.controller.transition('synthetic_task', 'select');
  task.page.onHide();
  assert.equal(task.page.data.busy, false);
  assert.equal(task.page.data.retryPending, false);
  let ready,
    applied = 0;
  f.runtime.start({
    ...f.platform,
    getUpdateManager: () => ({
      onCheckForUpdate() {},
      onUpdateFailed() {},
      onUpdateReady(fn) {
        ready = fn;
      },
      applyUpdate() {
        applied++;
      },
    }),
  });
  ready();
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 0);
  assert.equal(applied, 0);
  f.page.onLogout();
  assert.equal(f.state.capture(), f.binding);
  assert.equal(task.sent.length, 1);
  fail = false;
  await task.controller.resume();
  await task.controller.retry();
  assert.equal(task.sent.length, 2);
  assert.equal(task.sent[1], task.sent[0]);
  f.page.onLogout();
  assert.equal(f.state.capture(), null);
});

test('hidden in-flight task blocks logout until its real response settles', async (t) => {
  const f = await fixture(t);
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const task = await hiddenTask(f, t, () => gate);
  const writing = task.controller.transition('synthetic_task', 'select');
  try {
    task.page.onHide();
    assert.equal(task.page.data.busy, false);
    f.page.onLogout();
    assert.equal(f.state.capture(), f.binding);
    assert.equal(f.modals.length, 0);
    assert.equal(task.sent.length, 1);
  } finally {
    finish({ ok: true, data: { taskId: 'synthetic_task', state: 'selected', date: '2026-11-04' } });
    await writing;
  }
  f.page.onLogout();
  assert.equal(f.state.capture(), null);
});

test('a suspended account read with stale rendered busy does not block clean logout', async (t) => {
  const f = await fixture(t);
  const p = surface('account');
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  let reached;
  const started = new Promise((resolve) => {
    reached = resolve;
  });
  p._controller = createProductionAccountController({
    service: {
      authenticate: async () => true,
      preferences: () => {
        reached();
        return gate;
      },
    },
    session: f.state,
    storage: f.platform,
    publish: (patch) => p.setData(patch),
  });
  const untrack = f.runtime.trackPage(p);
  t.after(() => {
    p._controller.dispose();
    untrack();
  });
  const reading = p._controller.load();
  await started;
  p.onHide();
  assert.equal(p.data.busy, true); // The hidden render layer has not received another publish.
  f.page.onLogout();
  finish({ ok: true, data: { cardTextPreview: false, decorationsEnabled: true } });
  await reading;
  assert.equal(f.state.capture(), null);
  assert.equal(f.modals.length, 0);
});

test('account unknown preferences remain protected after its busy read state was suspended', async (t) => {
  const f = await fixture(t);
  const p = surface('account');
  const sent = [];
  p._controller = createProductionAccountController({
    service: {
      authenticate: async () => true,
      preferences: async () => ({
        ok: true,
        data: { cardTextPreview: false, decorationsEnabled: true },
      }),
      createPreferences: (payload) => createRequest('account.preferences', payload),
      submit(input) {
        sent.push(input);
        throw new AppError('NETWORK_ERROR', 'synthetic preference uncertainty');
      },
    },
    session: f.state,
    storage: f.platform,
    publish: (patch) => p.setData(patch),
  });
  const untrack = f.runtime.trackPage(p);
  t.after(() => {
    p._controller.dispose();
    untrack();
  });
  await p._controller.load();
  assert.equal(p.data.authenticated, true);
  await p._controller.savePreference('cardTextPreview', true);
  assert.equal(sent.length, 1);
  assert.equal(p.data.pendingKind, 'preferences');
  p.onHide();
  f.page.onLogout();
  assert.equal(f.state.capture(), f.binding);
  assert.equal(sent.length, 1);
  assert.equal(p.data.pendingKind, 'preferences');
});
