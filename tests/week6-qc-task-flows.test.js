const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers/promises');
const { withLocalWorld } = require('../tools/week6-qc/local-world.cjs');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createLocalStorage } = require('./helpers/local-storage');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { DEFAULT_TASKS } = require('../miniprogram/shared/task-catalogue');
const { PLACES } = require('../miniprogram/shared/campus-checkins');
const event = (dataset) => ({ currentTarget: { dataset } });
const ids = DEFAULT_TASKS.map((row) => row._id);

async function fixture(world, mode = 'enabled') {
  const state = createSessionState(),
    pages = [],
    navigations = [];
  state.accept(await world.login());
  const wx = {
    ...createLocalStorage(),
    navigateTo: (x) => navigations.push(x.url),
    navigateBack: () => {
      pages.pop();
    },
    switchTab: (x) => navigations.push(x.url),
    showToast() {},
  };
  const config = {
    releaseProfile: 'production',
    taskMode: mode,
    cloudEnabled: true,
    cloudEnvId: 'synthetic-w6-qc',
    trustedSessionEnabled: true,
  };
  const call = (action, payload) => world.call(world.request(action, payload));
  const service = {
    suggestions: () => call('tasks.suggestions'),
    quickChoice: () => call('tasks.quickChoice'),
    history: (p) => call('tasks.history', p),
    createTransitionRequest: (p) => world.request('tasks.transition', p),
    submit: (r) => world.call(r),
  };
  function load(name, query = {}) {
    const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
    const local = createRequire(file);
    let definition;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Page: (x) => {
        definition = x;
      },
      wx,
      getCurrentPages: () => pages,
      require(id) {
        if (id.endsWith('/config/environment.local')) {
          return config;
        }
        if (id.endsWith('/services/session-state')) {
          return { cloudSessionState: state };
        }
        if (id.endsWith('/services/api')) {
          return { createRequest: world.request, call: world.call };
        }
        if (id.endsWith('/modules/tasks/cloud')) {
          return {
            createCloudTaskController: (o) =>
              createCloudTaskController({ ...o, now: () => world.now }),
          };
        }
        if (id.endsWith('/modules/tasks/service')) {
          return {
            ...service,
            createPrivateTaskService: () => ({ ...service, suggestions: () => call('tasks.mine') }),
          };
        }
        if (id.endsWith('/modules/account/cloud-session')) {
          return {
            createCloudSession: () => ({ ...state, refresh: async () => true, dispose() {} }),
            ensureCloudSession: async () => true,
          };
        }
        if (id.endsWith('/modules/journal/service')) {
          return {
            get: (date) => call('journal.get', { date }),
            createSaveRequest: (p) => world.request('journal.upsert', p),
            createDeleteRequest: (p) => world.request('journal.delete', p),
            submit: (r) => world.call(r),
          };
        }
        if (id.endsWith('/modules/journal/controller')) {
          return {
            createJournalController: (o) =>
              createJournalController({ ...o, now: () => world.now, sessionState: state }),
          };
        }
        return local(id);
      },
    });
    const page = {
      ...definition,
      route: 'pages/' + name + '/index',
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(p) {
        Object.assign(this.data, p);
      },
    };
    pages.push(page);
    page.onLoad(query);
    page.onShow();
    return page;
  }
  async function settled(predicate = () => !pages.at(-1)?.data.loading) {
    for (let n = 0; n < 100; n++) {
      await setImmediate();
      if (predicate()) {
        return;
      }
    }
    throw new Error('Synthetic page did not settle: ' + JSON.stringify(pages.at(-1)?.data));
  }
  return { state, pages, navigations, load, settled };
}

for (const mode of ['closed', 'readOnly', 'enabled']) {
  test(`W6-QC mode ${mode}: Page actions agree with the local production entry`, async () => {
    await withLocalWorld(async (w) => {
      const f = await fixture(w, mode),
        page = f.load('tasks');
      await f.settled(() => mode === 'closed' || page.data.taskListLoaded);
      for (const action of ['select', 'complete', 'replace', 'skip']) {
        await page.onTaskAction(event({ taskId: ids[0], action }));
        if (mode === 'enabled' && action === 'select') {
          break;
        }
      }
      if (mode !== 'enabled') {
        await page.onView(event({ view: 'history' }));
        page.onOpenActivity(event({ taskId: ids[0] }));
        assert.equal(w.rows('task_history').length, 0);
        assert.equal(f.navigations.length, 0);
        assert(w.calls.every((x) => ['tasks.suggestions', 'tasks.quickChoice'].includes(x.action)));
        assert.equal(w.calls.length === 0, mode === 'closed');
      } else {
        assert.equal(page.data.suggestions.find((x) => x.id === ids[0]).state, 'selected');
        assert.equal(w.rows('task_history').length, 1);
        assert.equal(f.navigations[0], '/pages/campus/index?fromTask=1');
      }
      page.onUnload();
    });
  });
}
for (const action of ['complete', 'replace', 'skip']) {
  test(`W6-QC enabled select -> ${action}: matching server state, history and terminal controls`, async () => {
    await withLocalWorld(async (w) => {
      const f = await fixture(w),
        p = f.load('tasks');
      await f.settled(() => p.data.taskListLoaded);
      await p.onTaskAction(event({ taskId: ids[0], action: 'select' }));
      await p.onTaskAction(event({ taskId: ids[0], action }));
      const expected = { complete: 'completed', replace: 'replaced', skip: 'skipped' }[action];
      const row = p.data.suggestions.find((x) => x.id === ids[0]);
      assert.equal(row.state, expected);
      assert.equal(row.canSelect || row.canComplete || row.canReplace || row.canSkip, false);
      const sent = w.calls.filter((x) => x.action === 'tasks.transition').length;
      await p.onTaskAction(event({ taskId: ids[0], action: 'complete' }));
      assert.equal(w.calls.filter((x) => x.action === 'tasks.transition').length, sent);
      await p.onView(event({ view: 'history' }));
      assert(p.data.history.some((x) => x.taskId === ids[0] && x.state === expected));
      p.onUnload();
    });
  });
}

test('W6-QC double select waits for acknowledgement; failed and retried original input never fabricates completion', async () => {
  await withLocalWorld(async (w) => {
    const f = await fixture(w),
      p = f.load('tasks');
    await f.settled(() => p.data.taskListLoaded);
    let release;
    w.hold = {
      action: 'tasks.transition',
      wait: new Promise((r) => {
        release = r;
      }),
    };
    w.fault = { action: 'tasks.transition', kind: 'after' };
    const e = event({ taskId: ids[0], action: 'select' }),
      first = p.onTaskAction(e);
    await p.onTaskAction(e);
    assert.equal(w.calls.filter((x) => x.action === 'tasks.transition').length, 1);
    assert.equal(f.navigations.length, 0);
    assert.equal(p.data.suggestions[0].state, 'available');
    release();
    await first;
    w.hold = null;
    assert.equal(p.data.retryPending, true);
    assert.equal(f.navigations.length, 0);
    assert.equal(w.rows('task_history').length, 1);
    const original = w.calls.find((x) => x.action === 'tasks.transition');
    p.onHide();
    p.onShow();
    await f.settled(() => p.data.retryPending);
    assert.equal(w.calls.filter((x) => x.action === 'tasks.transition').length, 1);
    await p.onRetry();
    const writes = w.calls.filter((x) => x.action === 'tasks.transition');
    assert.deepEqual(writes[1], original);
    assert.equal(w.rows('task_history').length, 1);
    assert.equal(p.data.suggestions[0].state, 'selected');
    assert.equal(
      f.navigations.length,
      0,
      'A recovered request stays in place for an explicit activity tap',
    );
    p.onOpenActivity(e);
    assert.equal(f.navigations.length, 1);
    p.onUnload();
  });
});

for (const destination of ['campus', 'journal']) {
  test(`W6-QC ${destination} round trip keeps the task selected until an explicit complete`, async () => {
    await withLocalWorld(async (w) => {
      const f = await fixture(w),
        parent = f.load('tasks');
      await f.settled(() => parent.data.taskListLoaded);
      const id = destination === 'campus' ? ids[0] : ids[2];
      await parent.onTaskAction(event({ taskId: id, action: 'select' }));
      parent.onHide();
      if (destination === 'journal') {
        const child = f.load('record', { fromTask: '1' });
        await f.settled(() => child.data.loaded);
        child.onWeather(event({ code: 'SUNNY' }));
        assert.equal(await child.onSave(), true);
        assert.equal(f.pages.at(-1), parent);
        child.onUnload();
        const saved = await w.call(w.request('journal.get', { date: '2026-11-18' }));
        assert.equal(saved.data.entry.weather, 'SUNNY');
      } else {
        const child = f.load('campus', { fromTask: '1' });
        await f.settled(() => !child.data.checkinLoading);
        child.onChooseTaskPlace(event({ placeId: PLACES[0].placeId }));
        await child.onCheckinTap(event({ placeId: PLACES[0].placeId }));
        assert.match(child.data.checkinError, /暂停/);
        assert.equal(
          w.rows('place_checkins').length,
          0,
          'New checkins remain paused in this fixture',
        );
        child.onHide();
        child.onUnload();
        f.pages.pop();
      }
      parent.onShow();
      await f.settled(() => parent.data.taskListLoaded);
      assert.equal(parent.data.suggestions.find((x) => x.id === id).state, 'selected');
      await parent.onTaskAction(event({ taskId: id, action: 'complete' }));
      assert.equal(parent.data.suggestions.find((x) => x.id === id).state, 'completed');
      parent.onUnload();
    });
  });
}

test('W6-QC server readOnly and failed reads remain distinguishable from confirmed empty history', async () => {
  await withLocalWorld(async (w) => {
    w.taskWrites = false;
    const f = await fixture(w),
      p = f.load('tasks');
    await f.settled(() => p.data.taskListLoaded);
    assert.equal(p.data.tasksReadOnly, true);
    await p.onTaskAction(event({ taskId: ids[0], action: 'select' }));
    assert.equal(w.rows('task_history').length, 0);
    w.fault = { action: 'tasks.mine', kind: 'before' };
    await p.onRetry();
    assert.equal(p.data.taskListLoaded, false);
    assert.match(p.data.notice, /读取失败/);
    p.onUnload();
  });
});

test('W6-QC a selection confirmed after leaving and returning does not reopen an old activity', async () => {
  await withLocalWorld(async (w) => {
    const f = await fixture(w),
      p = f.load('tasks');
    await f.settled(() => p.data.taskListLoaded);
    let release;
    w.hold = {
      action: 'tasks.transition',
      wait: new Promise((r) => {
        release = r;
      }),
    };
    const pending = p.onTaskAction(event({ taskId: ids[0], action: 'select' }));
    p.onHide();
    p.onShow();
    await f.settled(() => p.data.busy);
    release();
    await pending;
    assert.equal(p.data.suggestions.find((x) => x.id === ids[0]).state, 'selected');
    assert.equal(
      f.navigations.length,
      0,
      'The earlier visit must not redirect the new visible visit',
    );
    p.onOpenActivity(event({ taskId: ids[0] }));
    assert.equal(
      f.navigations.length,
      1,
      'The current visit can explicitly open the confirmed task',
    );
    p.onUnload();
  });
});
