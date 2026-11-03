const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/today/index.js');
  const local = createRequire(file);
  let definition;
  const stops = [];
  const toasts = [];
  const platform = {
    stopPullDownRefresh: () => stops.push('stop'),
    showToast: (input) => toasts.push(input.title),
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => (definition = value),
    wx: platform,
    require: (id) => (id.endsWith('/config/environment.local') ? {} : local(id)),
  });
  const page = {
    ...definition,
    _disposed: false,
    _hidden: false,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const now = () => new Date('2026-11-04T04:00:00.000Z');
  const memory = createMemoryJournalService({ now });
  const reads = [];
  const sent = [];
  const service = {
    ...memory,
    get(date) {
      reads.push(date);
      return memory.get(date);
    },
    submit(request) {
      sent.push(request);
      return memory.submit(request);
    },
  };
  page._journal = createJournalController({
    service,
    now,
    isDemo: true,
    onChange: (state) => page.setData(page._mapState(state)),
  });
  await page._journal.loadDate();
  reads.length = 0;
  return { page, platform, memory, service, reads, sent, stops, toasts };
}

test('native Today refresh reads once, joins duplicate gestures and stops only after the read finishes', async () => {
  const config = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/today/index.json'), 'utf8'),
  );
  assert.equal(config.enablePullDownRefresh, true);
  const f = await fixture();
  const wait = deferred();
  f.service.get = (date) => {
    f.reads.push(date);
    return wait.promise.then(() => f.memory.get(date));
  };
  const first = f.page.onPullDownRefresh();
  const second = f.page.onPullDownRefresh();
  assert.equal(first, second);
  assert.equal(f.reads.length, 1);
  assert.equal(f.stops.length, 0);
  assert.equal(f.page.data.phase, 'loading');
  wait.resolve();
  assert.equal(await first, true);
  assert.equal(f.stops.length, 1);
  assert.equal(f.page.data.phase, 'idle');
  assert.equal(f.sent.length, 0);
  f.page.onUnload();
});

test('pulling Today preserves the actual draft without reading, writing or asking to discard it', async () => {
  const f = await fixture();
  f.page._journal.chooseWeather('SUNNY');
  f.page._journal.setText('合成私人草稿');
  assert.equal(await f.page.onPullDownRefresh(), false);
  const state = f.page._journal.getState();
  assert.equal(state.weather, 'SUNNY');
  assert.equal(state.text, '合成私人草稿');
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.confirm, '');
  assert.equal(f.reads.length, 0);
  assert.equal(f.sent.length, 0);
  assert.match(f.toasts.at(-1), /未保存.*保留/);
  assert.doesNotMatch(JSON.stringify(f.page.data), /合成私人草稿/);
  assert.equal(f.stops.length, 1);
  f.page.onUnload();
});

test('a native pull never replays an unknown save, and explicit retry still uses the original receipt', async () => {
  const f = await fixture();
  f.page._journal.chooseWeather('SUNNY');
  f.memory.failNext('after-save');
  assert.equal(await f.page.onSave(), false);
  assert.equal(f.page.data.pendingRetry, true);
  const original = f.sent[0];
  const readsBefore = f.reads.length;
  assert.equal(await f.page.onPullDownRefresh(), false);
  assert.equal(f.sent.length, 1);
  assert.equal(f.reads.length, readsBefore);
  assert.equal(f.page.data.confirm, '');
  assert.match(f.toasts.at(-1), /重试原操作/);
  assert.equal(await f.page.onRetry(), true);
  assert.equal(f.sent[1], original);
  assert.equal((await f.memory.get('2026-11-04')).data.entry.version, 1);
  f.page.onUnload();
});

test('guest and uninitialized pulls stop locally while static previews and redirected pages touch no native API', async () => {
  for (const boundary of ['guest', 'timeline', 'redirected', 'uninitialized']) {
    const f = await fixture();
    if (boundary === 'guest') {
      f.page.data.isGuest = true;
    } else if (boundary === 'timeline') {
      f.page.data.shareSinglePage = true;
    } else if (boundary === 'redirected') {
      f.page._shareLoginRedirected = true;
    } else {
      f.page._journal.dispose();
      f.page._journal = null;
    }
    assert.equal(await f.page.onPullDownRefresh(), false);
    assert.equal(f.reads.length, 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.stops.length, ['timeline', 'redirected'].includes(boundary) ? 0 : 1);
    f.page.onUnload();
  }
});

test('late pull events on hidden or unloaded pages cannot stop another page indicator', async () => {
  for (const boundary of ['onHide', 'onUnload']) {
    const f = await fixture();
    f.page[boundary]();
    assert.equal(await f.page.onPullDownRefresh(), false);
    assert.equal(f.reads.length, 0);
    assert.equal(f.stops.length, 0);
    f.page.onUnload();
  }
});

for (const boundary of ['onHide', 'onUnload']) {
  test(`${boundary} stops its active pull once and a late read cannot stop the next page`, async () => {
    const f = await fixture();
    const wait = deferred();
    f.service.get = (date) => wait.promise.then(() => f.memory.get(date));
    const refreshing = f.page.onPullDownRefresh();
    f.page[boundary]();
    assert.equal(f.stops.length, 1);
    wait.resolve();
    await refreshing;
    assert.equal(f.stops.length, 1);
    assert.equal(f.sent.length, 0);
    f.page.onUnload();
  });
}

test('an unexpected refresh error still ends the native indicator and gives a Chinese retry message', async () => {
  const f = await fixture();
  f.page._journal.refreshIfClean = () => {
    throw new Error('SYNTHETIC bridge failure');
  };
  assert.equal(await f.page.onPullDownRefresh(), false);
  assert.equal(f.stops.length, 1);
  assert.match(f.toasts.at(-1), /暂时无法刷新/);
  assert.equal(f.sent.length, 0);
  f.page.onUnload();
});

test('missing or failing native stop support does not prevent the next clean refresh', async () => {
  const f = await fixture();
  delete f.platform.stopPullDownRefresh;
  assert.equal(await f.page.onPullDownRefresh(), true);
  f.platform.stopPullDownRefresh = () => {
    throw new Error('SYNTHETIC unsupported stop');
  };
  assert.equal(await f.page.onPullDownRefresh(), true);
  assert.equal(f.reads.length, 2);
  assert.equal(f.sent.length, 0);
  f.page.onUnload();
});
