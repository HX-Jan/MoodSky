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
  return { load, pages, urls, memory, demoReads: () => demoReads };
}

test('shared memory clear retains the adapter held by existing journal pages', async () => {
  session.clearSharedDemoService();
  const original = session.getSharedDemoService();
  await original.submit(
    api.createRequest('journal.upsert', {
      date: require('../miniprogram/shared/date').businessDate(),
      weather: 'SUNNY',
      expectedVersion: 0,
    }),
  );
  session.clearSharedDemoService();
  assert.equal(session.getSharedDemoService(), original);
  assert.equal(
    (await original.get(require('../miniprogram/shared/date').businessDate())).data.entry,
    null,
  );
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
  assert.equal(parent.data.entry.text, 'synthetic private text');
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
