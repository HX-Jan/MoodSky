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

function fixture({ config = { journalDemo: true, cloudEnabled: false }, service } = {}) {
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

test('prototype extension tiles cannot change or save a journal weather', async () => {
  const f = fixture();
  const page = f.load('today');
  await settle();
  page.onWeather({ currentTarget: { dataset: { code: 'SUNNY' } } });
  for (const code of ['HEAVY_RAIN', 'TYPHOON', 'CUSTOM']) {
    const option = page.data.weatherOptions.find((item) => item.code === code);
    assert.equal(option.unavailable, true);
    page.onWeather({ currentTarget: { dataset: { code } } });
    assert.equal(page.data.weather, 'SUNNY');
  }
  await page.onSave();
  assert.equal(page.data.entry.weather, 'SUNNY');
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
  child.onText({ detail: { value: 'SYNTHETIC retained draft' } });
  await child.onShow();
  assert.equal(child.data.text, 'SYNTHETIC retained draft');
  child.onUnload();
  parent.onUnload();
});
