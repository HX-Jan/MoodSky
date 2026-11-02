const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');
const { SEED_ENTRIES } = require('../miniprogram/modules/review/demo-data');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  const store = createLocalStore(SEED_ENTRIES);
  return {
    store,
    service: createReviewDemoService({ store, now: () => new Date('2026-10-16T04:00:00Z') }),
  };
}
function load(name, { service, store, demo = true, query = {} }) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: { navigateBack() {}, switchTab() {}, navigateTo() {} },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { journalDemo: demo, cloudEnabled: !demo };
      }
      if (id.endsWith('/review/demo-store')) {
        return { createLocalStore, reviewStore: store };
      }
      if (id.endsWith('/review/demo-service')) {
        return { createReviewDemoService, reviewDemoService: service };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    updates: 0,
    setData(values) {
      Object.assign(this.data, values);
      this.updates++;
    },
  };
  page.onLoad(query);
  return page;
}

test('Monday-first calendar keeps a Sunday start in the correct final column', async () => {
  const f = fixture();
  const page = load('universe', f);
  await settle();
  page.onMonthPick({ detail: { value: '2026-02' } });
  await settle();
  assert.equal(Array.from(page.data.weekdays).join(''), '一二三四五六日');
  assert.equal(
    page.data.weeks[0].slice(0, 6).every((cell) => cell.blank),
    true,
  );
  assert.equal(page.data.weeks[0][6].date, '2026-02-01');
  assert.equal(page.data.weeks.flat().filter((cell) => !cell.blank).length, 28);
  page.onUnload();
});

test('review month and detail pages complete their first load and remove deleted content', async () => {
  const f = fixture();
  const month = load('review/month', { ...f, query: { month: '2026-10' } });
  const detail = load('review/detail', {
    ...f,
    query: { date: '2026-10-16', id: 'demo_20261016' },
  });
  await settle();
  assert.equal(month.data.loading, false);
  assert.equal(month.data.cards.length, 5);
  assert.equal(detail.data.phase, 'ready');
  assert.match(detail.data.text, /合成演示/);
  f.store.applyChange({ date: '2026-10-16', kind: 'deleted' });
  await settle();
  assert.equal(detail.data.phase, 'missing');
  assert.equal(detail.data.text, '');
  assert.equal(month.data.cards.length, 4);
  const recreated = {
    ...SEED_ENTRIES.at(-1),
    id: 'synthetic_recreated',
    text: 'synthetic replacement',
  };
  f.store.applyChange({ date: recreated.date, kind: 'saved', entry: recreated });
  await settle();
  assert.equal(detail.data.phase, 'stale');
  assert.equal(detail.data.text, '');
  month.onUnload();
  detail.onUnload();
});

test('offline private detail hides writing and late responses, then rereads the latest entry on return', async () => {
  for (const pendingFirstRead of [false, true]) {
    const f = fixture();
    const selected = SEED_ENTRIES.find((entry) => entry.date === '2026-10-16');
    const original = await f.service.getEntry(selected.date);
    const wait = deferred();
    let reads = 0;
    const service = {
      ...f.service,
      getEntry: (date) =>
        ++reads === 1 && pendingFirstRead ? wait.promise : f.service.getEntry(date),
    };
    const page = load('review/detail', {
      ...f,
      service,
      query: { date: selected.date, id: selected.id },
    });
    if (!pendingFirstRead) {
      await settle();
      assert.equal(page.data.text, selected.text);
    }
    page.onHide();
    const updates = page.updates;
    if (pendingFirstRead) {
      wait.resolve(original);
      await settle();
      assert.equal(page.updates, updates);
    }
    f.store.applyChange({
      date: selected.date,
      kind: 'saved',
      entry: { ...selected, version: selected.version + 1, text: 'SYNTHETIC newer hidden detail' },
    });
    await settle();
    assert.equal(page.data.text, '');
    assert.equal(page.data.tags.length, 0);
    assert.equal(page.data.phase, 'loading');
    page.onShow();
    await settle();
    assert.equal(page.data.text, 'SYNTHETIC newer hidden detail');
    assert.equal(page.data.phase, 'ready');
    assert.ok(reads >= 2);
    page.onUnload();
  }
});

test('review insights loads and switching to an empty fixture completes without NaN request tokens', async () => {
  const f = fixture();
  const page = load('review/insights', f);
  await settle();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.timelineItems.length, 3);
  page.onSampleTap({ currentTarget: { dataset: { id: 'empty' } } });
  await settle();
  assert.equal(page.data.distributionEmpty, true);
  assert.equal(page.data.timelineItems.length, 0);
  assert.match(page.data.trendText, /不足 3 条/);
  page.onUnload();
});

test('offline insights share one timeline across midnight so distribution and timeline counts cannot diverge', async () => {
  const seed = SEED_ENTRIES.find((entry) => entry.date === '2026-10-16');
  const store = createLocalStore([
    { ...seed, id: 'synthetic_old_boundary', date: '2026-10-12', weather: 'SUNNY' },
    { ...seed, id: 'synthetic_current_boundary', date: '2026-10-18', weather: 'RAINY' },
  ]);
  let clockReads = 0;
  let sourceReads = 0;
  const service = createReviewDemoService({
    store: {
      ...store,
      listAll: () => {
        sourceReads++;
        return store.listAll();
      },
    },
    now: () =>
      new Date(++clockReads === 1 ? '2026-10-18T15:59:59.999Z' : '2026-10-18T16:00:00.000Z'),
  });
  const page = load('review/insights', { service, store });
  await settle();
  assert.equal(
    page.data.distRows.reduce((sum, row) => sum + row.count, 0),
    page.data.timelineItems.length,
    JSON.stringify({ clockReads, sourceReads, meta: page.data.metaText }),
  );
  assert.equal(clockReads, 1);
  assert.equal(sourceReads, 1);
  assert.equal(page.data.error, '');
  assert.match(page.data.metaText, /2026-10-12 至 2026-10-18/);
  assert.equal(page.data.timelineItems.length, 2);
  assert.equal(
    page.data.distRows.reduce((sum, row) => sum + row.count, 0),
    2,
  );
  assert.match(page.data.metaText, /实际记录 2 条/);
  assert.doesNotMatch(JSON.stringify(page.data), /合成演示正文/);
  page.onUnload();
});

test('review pages cannot subscribe to or load demo data while cloud mode is selected', async () => {
  for (const name of ['review/month', 'review/detail', 'review/insights']) {
    let subscriptions = 0;
    let reads = 0;
    const unavailable = () => {
      reads++;
      throw new Error('demo must remain closed');
    };
    const store = {
      subscribe() {
        subscriptions++;
        return () => {};
      },
    };
    const service = {
      monthArchive: unavailable,
      getEntry: unavailable,
      distribution: unavailable,
      timeline: unavailable,
    };
    const page = load(name, {
      service,
      store,
      demo: false,
      query: { month: '2026-10', date: '2026-10-16' },
    });
    await page._reload();
    await settle();
    assert.equal(subscriptions, 0, name);
    assert.equal(reads, 0, name);
    page.onUnload();
  }
});

test('unloaded review pages discard pending responses', async () => {
  for (const [name, method] of [
    ['review/month', 'monthArchive'],
    ['review/detail', 'getEntry'],
    ['review/insights', 'timeline'],
  ]) {
    const f = fixture();
    const pending = deferred();
    const actual = f.service[method].bind(f.service);
    const value = await actual(
      method === 'monthArchive' ? '2026-10' : method === 'getEntry' ? '2026-10-16' : 7,
    );
    f.service[method] = () => pending.promise;
    const page = load(name, { ...f, query: { month: '2026-10', date: '2026-10-16' } });
    page.onUnload();
    const updates = page.updates;
    pending.resolve(value);
    await settle();
    assert.equal(page.updates, updates, name);
  }
});

test('a late month response cannot replace a newer archive selection', async () => {
  const f = fixture();
  const pending = deferred();
  const actual = f.service.monthArchive.bind(f.service);
  f.service.monthArchive = (month) => (month === '2026-10' ? pending.promise : actual(month));
  const page = load('review/month', { ...f, query: { month: '2026-10' } });
  page._month = '2026-09';
  await page._reload();
  pending.resolve(await actual('2026-10'));
  await settle();
  assert.equal(page.data.month, '2026-09');
  assert.equal(page.data.cards.length, 2);
  page.onUnload();
});

test('clearing review memory invalidates an outstanding journal synchronization', async () => {
  const store = createLocalStore([]);
  const pending = deferred();
  const sync = store.syncFromJournal(
    { get: () => pending.promise },
    { date: '2026-10-16', kind: 'saved' },
  );
  store.clearAll();
  pending.resolve({ ok: true, data: { entry: SEED_ENTRIES.at(-1) } });
  assert.equal(await sync, false);
  assert.equal(store.listAll().length, 0);
});

test('journal synchronizations discard older responses and retain a recreated entry after a deletion notice', async () => {
  const store = createLocalStore([]);
  const pending = deferred();
  const change = { date: '2026-10-16', kind: 'saved' };
  const first = store.syncFromJournal({ get: () => pending.promise }, change);
  const latest = { ...SEED_ENTRIES.at(-1), id: 'synthetic_latest', version: 3 };
  const service = { get: async () => ({ ok: true, data: { entry: latest } }) };
  assert.equal(await store.syncFromJournal(service, change), true);
  pending.resolve({ ok: true, data: { entry: SEED_ENTRIES.at(-1) } });
  assert.equal(await first, false);
  assert.equal(store.getEntry(change.date).id, latest.id);
  assert.equal(await store.syncFromJournal(service, { ...change, kind: 'deleted' }), true);
  assert.equal(store.getEntry(change.date).id, latest.id);
  await assert.rejects(store.syncFromJournal({ get: async () => ({ ok: false }) }, change), {
    code: 'INVALID_RESPONSE',
  });
  assert.equal(store.getEntry(change.date).id, latest.id);
});

test('a decoration update for a previous month cannot replace the current month view', async () => {
  const f = fixture();
  const page = load('universe', f);
  page._reloadAll('2026-10');
  await settle();
  const pending = deferred();
  const actual = f.service.decorations.bind(f.service);
  f.service.decorations = (input) =>
    input.operation === 'replace' ? pending.promise : actual(input);
  const update = page.onAddSticker();
  page._reloadAll('2026-09');
  await settle();
  pending.resolve({
    data: {
      month: '2026-10',
      version: 8,
      stickers: [{ stickerId: 'SYNTHETIC_STICKER' }],
      backgroundId: null,
    },
  });
  await update;
  assert.equal(page._currentMonth, '2026-09');
  assert.equal(page.data.decorationVersion, 0);
  assert.equal(page.data.decorationStickers.length, 0);
  page.onUnload();
});

test('switching months cannot copy the previous month decorations while the new month read is pending', async () => {
  const f = fixture();
  for (const [month, stickerId] of [
    ['2026-10', 'STICKER_LEAF'],
    ['2026-09', 'STICKER_MOON'],
  ]) {
    await f.service.decorations({
      operation: 'replace',
      month,
      expectedVersion: 0,
      stickers: [{ stickerId }],
      backgroundId: null,
    });
  }
  const page = load('universe', f);
  page._reloadAll('2026-10');
  await settle();
  const actual = f.service.decorations.bind(f.service);
  const read = deferred();
  f.service.decorations = (input) =>
    input.operation === 'get' && input.month === '2026-09' ? read.promise : actual(input);
  page._reloadAll('2026-09');
  await settle();
  await page.onAddSticker();
  const unchanged = (await actual({ operation: 'get', month: '2026-09' })).data;
  assert.equal(
    unchanged.version,
    1,
    'An unread month must not be overwritten with the previous month raw stickers',
  );
  assert.deepEqual(unchanged.stickers, [{ stickerId: 'STICKER_MOON' }]);
  assert.equal(page.data.decorationLoading, true);
  assert.equal(page.data.decorationReady, false);
  assert.equal(page.data.decorationStickers.length, 0);
  read.resolve(await actual({ operation: 'get', month: '2026-09' }));
  await settle();
  assert.equal(page.data.decorationReady, true);
  await page.onAddSticker();
  const current = (await actual({ operation: 'get', month: '2026-09' })).data;
  assert.deepEqual(JSON.parse(JSON.stringify(current.stickers)), [
    { stickerId: 'STICKER_MOON' },
    { stickerId: 'STICKER_STAR' },
  ]);
  page.onUnload();
});

test('a failed decoration read cannot enable writes with unknown state and can explicitly retry', async () => {
  const f = fixture();
  const actual = f.service.decorations.bind(f.service);
  let failing = true;
  let mutations = 0;
  f.service.decorations = async (input) => {
    if (input.operation === 'get' && failing) {
      throw new Error('SYNTHETIC failed read');
    }
    if (input.operation !== 'get') {
      mutations++;
    }
    return actual(input);
  };
  const page = load('universe', f);
  await settle();
  await page.onAddSticker();
  await page.onResetDecoration();
  assert.equal(mutations, 0);
  assert.equal(page.data.decorationReady, false);
  assert.equal(page.data.decorationLoading, false);
  failing = false;
  await page.onRetryDecoration();
  assert.equal(page.data.decorationReady, true);
  await page.onAddSticker();
  assert.equal(mutations, 1);
  assert.equal(page.data.decorationVersion, 1);
  page.onUnload();
});

test('native decoration actions add six distinct allowed stickers, stop at the limit, and can reset', async () => {
  const f = fixture();
  const page = load('universe', f);
  page._reloadAll('2026-10');
  await settle();
  const original = JSON.stringify(f.store.listAll());
  const actual = f.service.decorations.bind(f.service);
  let mutations = 0;
  f.service.decorations = (input) => {
    if (input.operation !== 'get') {
      mutations++;
    }
    return actual(input);
  };
  for (let count = 1; count <= 6; count++) {
    await page.onAddSticker();
    assert.equal(page.data.decorationStickers.length, count);
    assert.equal(page.data.decorationVersion, count);
  }
  assert.equal(mutations, 6);
  assert.equal(new Set(page._rawStickers.map((s) => s.stickerId)).size, 6);
  assert.deepEqual(
    Array.from(page.data.decorationStickers, (sticker) => sticker.title),
    ['星星', '月亮', '叶子', '雨伞', '小猫', '气球'],
  );
  await page.onAddSticker();
  assert.equal(mutations, 6, 'At-limit action must not send a duplicate or oversized replacement');
  assert.equal(page.data.decorationVersion, 6);
  await page.onResetDecoration();
  assert.equal(page.data.decorationStickers.length, 0);
  await page.onAddSticker();
  assert.equal(page.data.decorationVersion, 8);
  assert.equal(page.data.decorationStickers[0].title, '星星');
  assert.equal(JSON.stringify(f.store.listAll()), original);
  page.onUnload();
});

test('the Universe page ignores month and decoration responses after unloading', async () => {
  const f = fixture();
  const calendar = deferred();
  const decorations = deferred();
  f.service.calendar = () => calendar.promise;
  f.service.decorations = () => decorations.promise;
  const page = load('universe', f);
  page.onUnload();
  const updates = page.updates;
  calendar.resolve({ data: { month: '2026-10', entries: [], recordCount: 0 } });
  decorations.resolve({ data: { month: '2026-10', version: 0, stickers: [], backgroundId: null } });
  await settle();
  assert.equal(page.updates, updates);
});
