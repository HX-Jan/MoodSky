const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const session = require('../miniprogram/modules/journal/demo-session');
const api = require('../miniprogram/services/api');
const today = '2026-10-15';
const now = () => new Date(today + 'T04:00:00Z');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture({
  config = { journalDemo: true, cloudEnabled: false },
  service,
  leaveApi = {},
} = {}) {
  const memory = service || createMemoryJournalService({ now });
  const pages = [];
  const urls = [];
  const needsMenus = [];
  let demoReads = 0;
  function load(name, query = {}) {
    const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
    const localRequire = createRequire(filename);
    let definition;
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      Page: (value) => {
        definition = value;
      },
      getCurrentPages: () => pages,
      wx: {
        navigateTo: ({ url }) => urls.push(url),
        switchTab: ({ url }) => urls.push(url),
        showActionSheet: (options) => needsMenus.push(options),
        navigateBack: () => pages.pop(),
        showToast() {},
        ...leaveApi,
      },
      require(id) {
        if (id === '../../config/environment.local') {
          return config;
        }
        if (id === '../../modules/journal/service') {
          return memory;
        }
        if (id === '../../modules/journal/demo-session') {
          return {
            getSharedDemoService() {
              demoReads++;
              return memory;
            },
            clearSharedDemoService: () => memory.clear(),
          };
        }
        if (id === '../../modules/journal/controller') {
          return {
            createJournalController: (options) => createJournalController({ ...options, now }),
          };
        }
        return localRequire(id);
      },
    });
    const page = {
      ...definition,
      data: { ...definition.data },
      setData(data) {
        Object.assign(this.data, data);
      },
    };
    pages.push(page);
    page.onLoad(query);
    page.onShow();
    return page;
  }
  return { load, pages, urls, needsMenus, memory, demoReads: () => demoReads };
}

test('six need choices reach existing pages without saving or changing a journal draft', async () => {
  const targets = [
    '/pages/record/index?date=' + today + '&weather=RAINY',
    '/pages/campus/index',
    '/pages/record/index?date=' + today + '&weather=RAINY',
    '/pages/tasks/index',
    '/pages/universe/index',
    null,
  ];
  for (const [tapIndex, target] of targets.entries()) {
    const f = fixture();
    const page = f.load('today');
    await settle();
    page.onWeather({ currentTarget: { dataset: { code: 'RAINY' } } });
    const before = JSON.stringify(page._journal.getState());
    page.onNeeds();
    assert.equal(f.needsMenus[0].itemList.length, 6);
    f.needsMenus[0].success({ tapIndex });
    assert.deepEqual(f.urls, target ? [target] : []);
    assert.equal(JSON.stringify(page._journal.getState()), before);
    assert.equal((await f.memory.get(today)).data.entry, null);
    page.onUnload();
  }
});

test('cancelling or receiving an old need menu callback cannot navigate or save', async () => {
  const f = fixture();
  const page = f.load('today');
  page.onNeeds();
  assert.equal(f.needsMenus.length, 0, 'loading keeps navigation locked');
  await settle();
  page.onWeather({ currentTarget: { dataset: { code: 'SUNNY' } } });
  const before = JSON.stringify(page._journal.getState());
  page.onNeeds();
  // Dismissing a native sheet never invokes success.
  assert.deepEqual(f.urls, []);
  assert.equal(JSON.stringify(page._journal.getState()), before);
  page.onUnload();
  f.needsMenus[0].success({ tapIndex: 3 });
  assert.deepEqual(f.urls, []);
  assert.equal((await f.memory.get(today)).data.entry, null);
});

test('shared memory clear retains the adapter held by existing journal pages', async () => {
  // '2026-10-14' is not part of the seeded demo entries, so expectedVersion 0
  // keeps creating a fresh record regardless of the shared seed (W1 Z05).
  session.clearSharedDemoService();
  const original = session.getSharedDemoService();
  await original.submit(
    api.createRequest('journal.upsert', {
      date: '2026-10-14',
      weather: 'SUNNY',
      expectedVersion: 0,
    }),
  );
  session.clearSharedDemoService();
  assert.equal(session.getSharedDemoService(), original);
  assert.equal((await original.get('2026-10-14')).data.entry, null);
});

test('cancelled record navigation preserves Today selection without a reload lock', async () => {
  const f = fixture();
  const parent = f.load('today');
  await settle();
  parent.onWeather({ currentTarget: { dataset: { code: 'RAINY' } } });
  parent.onWrite();
  assert.equal(f.urls[0], '/pages/record/index?date=' + today + '&weather=RAINY');
  const child = f.load('record', { date: today, weather: 'RAINY' });
  await settle();
  assert.equal(child.data.weather, 'RAINY');
  child.onUnload();
  f.pages.pop();
  parent.onShow();
  assert.equal(parent.data.weather, 'RAINY');
  assert.equal(parent.data.confirm, '');
  assert.equal(parent.data.canSave, true);
});

test('confirmed record save and deletion refresh Today and retain record versions', async () => {
  const f = fixture();
  const parent = f.load('today');
  await settle();
  const child = f.load('record', { date: today, weather: 'SUNNY' });
  await settle();
  child.onText({ detail: { value: 'synthetic private text' } });
  assert.equal(await child.onSave(), true);
  child.onUnload();
  f.pages.pop();
  await parent.onShow();
  assert.equal(parent.data.entry.text, undefined);
  assert.equal(parent.data.text, '');
  assert.equal(parent._journal.getState().entry.text, 'synthetic private text');
  assert.equal(parent.data.entry.version, 1);
  const edit = f.load('record', { date: today });
  await settle();
  edit.onDelete();
  assert.equal(edit.data.confirm, 'delete');
  await edit.onConfirmDelete();
  await parent.onShow();
  assert.equal(parent.data.entry, null);
});

test('Today date changes expose cancel and explicit discard confirmation', async () => {
  const f = fixture();
  const page = f.load('today');
  await settle();
  page.onWeather({ currentTarget: { dataset: { code: 'CLOUDY' } } });
  await page.onPreviousDate();
  assert.equal(page.data.confirm, 'reload');
  page.onCancel();
  assert.equal(page.data.weather, 'CLOUDY');
  await page.onPreviousDate();
  await page.onConfirmReload();
  assert.equal(page.data.date, '2026-10-14');
  assert.equal(page.data.confirm, '');
});

test('record conflicts preserve draft until the user explicitly confirms rereading', async () => {
  const f = fixture();
  const page = f.load('record', { date: today, weather: 'RAINY' });
  await settle();
  page.onText({ detail: { value: 'synthetic retained draft' } });
  await f.memory.submit(
    api.createRequest('journal.upsert', { date: today, weather: 'SUNNY', expectedVersion: 0 }),
  );
  assert.equal(await page.onSave(), false);
  assert.equal(page.data.requiresReload, true);
  assert.equal(page.data.pendingRetry, false);
  await page.onReload();
  assert.equal(page.data.confirm, 'reload');
  page.onCancel();
  assert.equal(page.data.text, 'synthetic retained draft');
  await page.onReload();
  await page.onConfirmReload();
  assert.equal(page.data.entry.weather, 'SUNNY');
  assert.equal(page.data.entry.version, 1);
});

test('both pages require explicit demo mode and disabled cloud', async () => {
  for (const config of [{ journalDemo: true, cloudEnabled: true }, { cloudEnabled: false }]) {
    const f = fixture({ config });
    f.load('today');
    f.load('record');
    await settle();
    assert.equal(f.demoReads(), 0);
  }
});

test('Today exposes supported new weather choices including HEAVY_RAIN, TYPHOON and CUSTOM', async () => {
  for (const code of ['TYPHOON', 'CUSTOM']) {
    const f = fixture();
    const page = f.load('today');
    await settle();
    assert.equal(page.data.weatherOptions.length, 8);
    assert.equal(
      page.data.weatherOptions.some((item) => item.code === 'HEAVY_RAIN'),
      true,
    );
    page.onWeather({ currentTarget: { dataset: { code: 'SUNNY' } } });
    assert.equal(page.data.weather, 'SUNNY');
    const option = page.data.weatherOptions.find((item) => item.code === code);
    assert.notEqual(option.unavailable, true);
    page.onWeather({ currentTarget: { dataset: { code } } });
    assert.equal(page.data.weather, code);
    if (code === 'CUSTOM') {
      assert.equal(page.data.canSave, false);
      page.onWeatherName({ detail: { value: '雨后彩虹😀' } });
    }
    await page.onSave();
    assert.equal(page.data.entry.weather, code);
    assert.equal((await f.memory.get(today)).data.entry.weather, code);
    page.onUnload();
  }
});


test('custom weather draft reaches the private editor in memory, returns after saving and clears on hide', async () => {
  const f = fixture();
  const parent = f.load('today');
  await settle();
  parent.onWeather({ currentTarget: { dataset: { code: 'CUSTOM' } } });
  parent.onWeatherName({ detail: { value: '合成彩虹😀' } });
  parent.onWrite();
  assert.equal(f.urls[0], '/pages/record/index?date=' + today + '&weather=CUSTOM');
  assert.doesNotMatch(f.urls[0], /合成|weatherName/);
  const child = f.load('record', { date: today, weather: 'CUSTOM' });
  await settle();
  assert.equal(child.data.weatherName, '合成彩虹😀');
  child.onWeatherName({ detail: { value: '云边日光😀' } });
  child.onHide();
  assert.equal(child.data.weatherName, '');
  assert.equal(child._journal.getState().weatherName, '云边日光😀');
  await child.onShow();
  assert.equal(child.data.weatherName, '云边日光😀');
  assert.equal(await child.onSave(), true);
  child.onUnload();
  f.pages.pop();
  await parent.onShow();
  assert.equal(parent.data.entryWeatherLabel, '云边日光😀');
  assert.equal(parent.data.entry.weatherName, '云边日光😀');
  assert.equal(parent.data.text, '');
  parent.onUnload();
});

test('both templates expose reload confirmations and Today summary hides text', () => {
  for (const name of ['today', 'record']) {
    const markup = fs.readFileSync(
      path.resolve(__dirname, '../miniprogram/pages', name, 'index.wxml'),
      'utf8',
    );
    assert.match(markup, /bindtap="onConfirmReload"/);
    assert.match(markup, /bindtap="onCancel"/);
    assert.match(markup, /bindtap="onReload"/);
    if (name === 'today') {
      assert.doesNotMatch(markup, /\{\{entry\.text\}\}/);
    }
  }
});

test('Today never sends private writing to its summary render data while record editing preserves it', async () => {
  const f = fixture();
  await f.memory.submit(
    api.createRequest('journal.upsert', {
      date: today,
      weather: 'SUNNY',
      text: 'SYNTHETIC render secret',
      expectedVersion: 0,
    }),
  );
  const parent = f.load('today');
  await settle();
  assert.doesNotMatch(JSON.stringify(parent.data), /SYNTHETIC render secret/);
  assert.equal(parent._journal.getState().text, 'SYNTHETIC render secret');
  const child = f.load('record', { date: today });
  await settle();
  assert.equal(child.data.text, 'SYNTHETIC render secret');
  assert.equal(child.data.entry.text, undefined);
  assert.equal(child._journal.getState().entry.text, 'SYNTHETIC render secret');
  child.onText({ detail: { value: 'SYNTHETIC retained draft' } });
  await child.onShow();
  assert.equal(child.data.text, 'SYNTHETIC retained draft');
  child.onUnload();
  parent.onUnload();
});

test('record hides private rendering while preserving the unsaved draft for return', async () => {
  const f = fixture();
  const page = f.load('record', { date: today, weather: 'RAINY' });
  await settle();
  page.onText({ detail: { value: 'SYNTHETIC hidden draft 😀' } });
  page.onTag({ currentTarget: { dataset: { id: 'STUDY' } } });
  const before = page._journal.getState();
  page.onHide();
  assert.doesNotMatch(JSON.stringify(page.data), /hidden draft|STUDY|RAINY/);
  assert.equal(page.data.inputLocked, true);
  assert.equal(page._journal.getState().text, before.text);
  await page.onShow();
  assert.equal(page.data.text, before.text);
  assert.deepEqual(page.data.tags, before.tags);
  assert.equal(page.data.weather, before.weather);
  assert.equal(page.data.confirm, '');
  assert.equal(page.data.canSave, true);
  page.onUnload();
});

test('record late reads do not repaint a hidden page and are refreshed on return', async () => {
  const memory = createMemoryJournalService({ now });
  const request = memory.createSaveRequest({
    date: today,
    weather: 'SUNNY',
    text: 'SYNTHETIC late hidden body',
    expectedVersion: 0,
  });
  await memory.submit(request);
  const response = await memory.get(today);
  let release;
  let reads = 0;
  const f = fixture({
    service: {
      ...memory,
      get: () =>
        ++reads === 1
          ? new Promise((resolve) => {
              release = resolve;
            })
          : memory.get(today),
    },
  });
  const page = f.load('record', { date: today });
  page.onHide();
  release(response);
  await settle();
  assert.doesNotMatch(JSON.stringify(page.data), /late hidden body/);
  assert.equal(page.data.loaded, false);
  await page.onShow();
  assert.equal(reads, 2);
  assert.equal(page.data.text, 'SYNTHETIC late hidden body');
  page.onUnload();
});

test('record hidden unknown saves retain the exact original request for a visible retry', async () => {
  const memory = createMemoryJournalService({ now });
  const submitted = [];
  let reject;
  const f = fixture({
    service: {
      ...memory,
      submit: (request) => {
        submitted.push(request);
        return submitted.length === 1
          ? new Promise((_resolve, fail) => {
              reject = fail;
            })
          : memory.submit(request);
      },
    },
  });
  const page = f.load('record', { date: today, weather: 'CLOUDY' });
  await settle();
  page.onText({ detail: { value: 'SYNTHETIC hidden retry draft' } });
  const pending = page.onSave();
  page.onHide();
  const error = new Error('SYNTHETIC transport failure');
  error.code = 'NETWORK_ERROR';
  reject(error);
  assert.equal(await pending, false);
  assert.doesNotMatch(JSON.stringify(page.data), /hidden retry draft/);
  await page.onShow();
  assert.equal(page.data.pendingRetry, true);
  assert.equal(page.data.text, 'SYNTHETIC hidden retry draft');
  assert.equal(page.data.inputLocked, true);
  assert.equal(await page.onRetry(), true);
  assert.equal(submitted[1], submitted[0]);
  assert.equal(page.data.entry.version, 1);
  page.onUnload();
});

test('record deletion completing after hide cannot navigate back from a different page', async () => {
  const memory = createMemoryJournalService({ now });
  await memory.submit(
    memory.createSaveRequest({ date: today, weather: 'SUNNY', expectedVersion: 0 }),
  );
  let release;
  const f = fixture({
    service: {
      ...memory,
      submit: (request) =>
        new Promise((resolve) => {
          release = async () => resolve(await memory.submit(request));
        }),
    },
  });
  const page = f.load('record', { date: today });
  await settle();
  page.onDelete();
  const pending = page.onConfirmDelete();
  page.onHide();
  await release();
  await pending;
  assert.equal(f.pages.length, 1, 'A delayed deletion must not pop a page while hidden');
  assert.equal((await memory.get(today)).data.entry, null);
  assert.equal(page.data.entry, null);
  await page.onShow();
  assert.equal(page.data.loaded, true);
  assert.equal(page.data.entry, null);
  page.onUnload();
});

test('confirmed deletion stays open when its follow-up read fails and can recover a recreated record', async () => {
  for (const recreate of [false, true]) {
    const memory = createMemoryJournalService({ now });
    await memory.submit(
      memory.createSaveRequest({ date: today, weather: 'SUNNY', expectedVersion: 0 }),
    );
    let failRead = false;
    let deletes = 0;
    const f = fixture({
      service: {
        ...memory,
        get(date) {
          return failRead
            ? Promise.reject({ code: 'NETWORK_ERROR', message: 'SYNTHETIC private diagnostic' })
            : memory.get(date);
        },
        async submit(request) {
          const result = await memory.submit(request);
          if (request.action === 'journal.delete') {
            deletes++;
            failRead = true;
            if (recreate) {
              await memory.submit(
                memory.createSaveRequest({ date: today, weather: 'RAINY', expectedVersion: 0 }),
              );
            }
          }
          return result;
        },
      },
    });
    const page = f.load('record', { date: today });
    await settle();
    page.onDelete();
    await page.onConfirmDelete();
    assert.equal(f.pages.length, 1, 'Unknown current state must not trigger automatic return');
    assert.equal(page.data.loaded, false);
    assert.equal(page.data.pendingRetry, false, 'The deletion itself is already confirmed');
    assert.equal(page.data.canSave, false);
    assert.equal(page.data.canDelete, false);
    assert.equal(page.data.canReload, true);
    assert.match(page.data.notice, /删除操作已确认.*读取失败/);
    assert.doesNotMatch(page.data.notice, /private diagnostic/);
    assert.equal(deletes, 1);
    failRead = false;
    await page.onReload();
    assert.equal(page.data.loaded, true);
    assert.equal(page.data.entry?.weather || null, recreate ? 'RAINY' : null);
    assert.equal(deletes, 1, 'Rereading never resubmits the confirmed deletion');
    page.onUnload();
  }
});

test('record return protection follows dirty input and is removed after confirmed save or exact revert', async () => {
  const calls = [];
  const f = fixture({
    leaveApi: {
      enableAlertBeforeUnload: (options) =>
        calls.push({ kind: 'enable', message: options.message }),
      disableAlertBeforeUnload: () => calls.push({ kind: 'disable' }),
    },
  });
  const page = f.load('record', { date: today });
  await settle();
  assert.deepEqual(calls, []);
  page.onWeather({ currentTarget: { dataset: { code: 'RAINY' } } });
  page.onText({ detail: { value: 'SYNTHETIC draft protected on return' } });
  assert.equal(calls.length, 1, 'Typing does not repeatedly call the native bridge');
  assert.match(calls[0].message, /未保存/);
  assert.match(page.data.leaveWarning, /未保存/);
  assert.equal(page._journal.getState().hasUnsavedChanges, true);
  await page.onSave();
  assert.equal(calls.at(-1).kind, 'disable');
  assert.equal(page.data.leaveWarning, '');
  assert.equal(page._journal.getState().hasUnsavedChanges, false);
  page.onText({ detail: { value: 'SYNTHETIC changed again' } });
  assert.equal(calls.at(-1).kind, 'enable');
  page.onText({ detail: { value: 'SYNTHETIC draft protected on return' } });
  assert.equal(calls.at(-1).kind, 'disable');
  assert.equal(page.data.leaveWarning, '');
  page.onUnload();
});

test('record unknown write keeps the return warning until its original retry is confirmed', async () => {
  const calls = [];
  const f = fixture({
    leaveApi: {
      enableAlertBeforeUnload: (options) => calls.push(options.message),
      disableAlertBeforeUnload: () => calls.push('disabled'),
    },
  });
  const page = f.load('record', { date: today, weather: 'SUNNY' });
  await settle();
  f.memory.failNext('after-save');
  assert.equal(await page.onSave(), false);
  assert.match(calls.at(-1), /结果尚未确认/);
  assert.match(page.data.leaveWarning, /重试原操作/);
  assert.equal(page.data.pendingRetry, true);
  assert.equal(await page.onRetry(), true);
  assert.equal(calls.at(-1), 'disabled');
  assert.equal(page.data.leaveWarning, '');
  page.onUnload();
});

test('record protection failure or unsupported APIs still leaves a visible warning and working form', async () => {
  for (const leaveApi of [
    {},
    {
      enableAlertBeforeUnload() {
        throw Error('SYNTHETIC unsupported native bridge');
      },
      disableAlertBeforeUnload() {},
    },
    {
      enableAlertBeforeUnload(options) {
        options.fail({ errMsg: 'SYNTHETIC private platform detail' });
      },
      disableAlertBeforeUnload(options) {
        options.fail({});
      },
    },
  ]) {
    const f = fixture({ leaveApi });
    const page = f.load('record', { date: today });
    await settle();
    page.onWeather({ currentTarget: { dataset: { code: 'SUNNY' } } });
    assert.match(page.data.leaveWarning, /未保存/);
    assert.doesNotMatch(page.data.leaveWarning, /SYNTHETIC|unsupported|errMsg/);
    assert.equal(await page.onSave(), true);
    assert.equal(page.data.leaveWarning, '');
    page.onUnload();
  }
});

test('record protection rearms on return and cleans up when the editor unloads', async () => {
  const calls = [];
  const f = fixture({
    leaveApi: {
      enableAlertBeforeUnload: () => calls.push('enable'),
      disableAlertBeforeUnload: () => calls.push('disable'),
    },
  });
  const page = f.load('record', { date: today, weather: 'SUNNY' });
  await settle();
  page.onHide();
  await page.onShow();
  assert.deepEqual(calls, ['enable', 'enable']);
  page.onUnload();
  assert.equal(calls.at(-1), 'disable');
});

test('record guard ignores late enable callbacks and retries a failed cleanup on unload', async () => {
  const late = [];
  let disables = 0;
  const f = fixture({
    leaveApi: {
      enableAlertBeforeUnload: (options) => late.push(options.success),
      disableAlertBeforeUnload(options) {
        disables++;
        if (disables === 1) {
          options.fail({});
        } else {
          options.success({});
        }
      },
    },
  });
  const page = f.load('record', { date: today, weather: 'SUNNY' });
  await settle();
  assert.equal(await page.onSave(), true);
  late.forEach((callback) => callback({}));
  assert.equal(page._leaveGuardReady, false);
  assert.equal(page._leaveGuardCleanupNeeded, true);
  assert.equal(page.data.leaveWarning, '');
  page.onUnload();
  assert.equal(disables, 2);
  assert.equal(page._leaveGuardCleanupNeeded, false);
});

test('a hidden record save notifies its original Today parent when another page is above it', async () => {
  const memory = createMemoryJournalService({ now });
  let release;
  const f = fixture({
    service: {
      ...memory,
      submit: (request) =>
        new Promise((resolve) => {
          release = async () => resolve(await memory.submit(request));
        }),
    },
  });
  const parent = f.load('today');
  await settle();
  parent.onWeather({ currentTarget: { dataset: { code: 'RAINY' } } });
  const child = f.load('record', { date: today, weather: 'RAINY' });
  await settle();
  child.onText({ detail: { value: 'SYNTHETIC delayed child save' } });
  const pending = child.onSave();
  child.onHide();
  f.pages.push({ route: 'synthetic-another-page' });
  await release();
  assert.equal(await pending, true);
  assert.equal(parent._recordChangedDate, today);
  f.pages.pop();
  await child.onShow();
  child.onUnload();
  f.pages.pop();
  await parent.onShow();
  assert.equal(parent.data.entry.version, 1);
  assert.equal(parent.data.entry.weather, 'RAINY');
  assert.equal(parent.data.confirm, '');
  assert.equal(parent._journal.getState().hasUnsavedChanges, false);
  assert.doesNotMatch(JSON.stringify(parent.data), /delayed child save/);
  parent.onUnload();
});
