const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');
const { createReviewReader, reviewErrorMessage } = require('../miniprogram/modules/review/reader');
const { ICONS, weatherView } = require('../miniprogram/modules/review/presentation');
const { WEATHER_TYPES, LIMITS } = require('../miniprogram/shared/constants');
const { createSessionState } = require('../miniprogram/services/session-state');
const { backendClient } = require('./helpers/backend-client');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (rounds = 3) => {
  for (let index = 0; index < rounds; index += 1) {
    await settle();
  }
};
const entry = (changes = {}) => ({
  id: 'w4_entry_' + (changes.date || '2026-10-18').replaceAll('-', ''),
  date: '2026-10-18',
  weather: 'SUNNY',
  tags: [],
  text: 'SYNTHETIC weekly review body',
  version: 1,
  createdAt: '2026-10-18T01:00:00.000Z',
  updatedAt: '2026-10-18T01:00:00.000Z',
  ...changes,
});

function demoFixture(entries = [entry()], now = '2026-10-18T04:00:00.000Z') {
  const store = createLocalStore(entries);
  const service = createReviewDemoService({ store, now: () => new Date(now) });
  return { store, service };
}

function loadDemoPage(name, { service, store, query = {} }) {
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
        return { journalDemo: true, cloudEnabled: false };
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

function loadCloudPage(name, { reader, query = {}, sessionState, enabled = true }) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  let demoReads = 0;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: { navigateBack() {}, switchTab() {}, navigateTo() {} },
    require(id) {
      if (id.endsWith('/review/session-boundary') && sessionState) {
        const boundary = localRequire(id);
        return {
          ...boundary,
          subscribeReviewSession: (listener) =>
            boundary.subscribeReviewSession(listener, sessionState),
        };
      }
      if (id.endsWith('/config/environment.local')) {
        return { journalDemo: true, cloudEnabled: enabled };
      }
      if (id.endsWith('/review/reader')) {
        return { reviewReader: reader, reviewErrorMessage };
      }
      if (id.endsWith('/review/demo-store')) {
        return {
          reviewStore: {
            subscribe() {
              demoReads++;
              throw new Error('SYNTHETIC demo store must not be used in cloud mode');
            },
          },
        };
      }
      if (id.endsWith('/review/demo-service')) {
        const forbidden = () => {
          demoReads++;
          throw new Error('SYNTHETIC demo service must not be used in cloud mode');
        };
        return {
          reviewDemoService: {
            calendar: forbidden,
            monthArchive: forbidden,
            getEntry: forbidden,
            distribution: forbidden,
            timeline: forbidden,
            decorations: forbidden,
            weatherView,
          },
          createReviewDemoService: forbidden,
        };
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
  return { page, demoReads: () => demoReads };
}

// W4 Z01: empty month, cross-month, ordering, legacy id, read failure, hidden card body.
test('W4 Z01 month archive covers empty, cross-month, ordering and hidden card bodies', async () => {
  const seeds = [
    entry({ id: 'z01_sep_27', date: '2026-09-27', weather: 'SUNNY', text: 'SYNTHETIC sept body' }),
    entry({ id: 'z01_sep_30', date: '2026-09-30', weather: 'RAINY', text: 'SYNTHETIC sept body' }),
    entry({ id: 'z01_oct_01', date: '2026-10-01', weather: 'PARTLY_CLOUDY' }),
    entry({ id: 'z01_oct_12', date: '2026-10-12', weather: 'CLOUDY' }),
    entry({ id: 'z01_oct_16', date: '2026-10-16', weather: 'CUSTOM', weatherName: '合成晚霞' }),
    entry({ id: 'z01_oct_18', date: '2026-10-18', weather: 'TYPHOON' }),
  ];
  const f = demoFixture(seeds);

  const empty = loadDemoPage('review/month', { ...f, query: { month: '2026-08' } });
  const september = loadDemoPage('review/month', { ...f, query: { month: '2026-09' } });
  const october = loadDemoPage('review/month', { ...f, query: { month: '2026-10' } });
  await flush();
  assert.equal(empty.data.recordCount, 0);
  assert.deepEqual(empty.data.cards, []);
  assert.equal(empty.data.error, '');

  assert.equal(september.data.recordCount, 2);
  assert.equal(
    september.data.cards.every((card) => card.date.startsWith('2026-09')),
    true,
  );
  assert.equal(october.data.recordCount, 4);
  assert.equal(
    october.data.cards.every((card) => card.date.startsWith('2026-10')),
    true,
  );
  assert.deepEqual(
    october.data.cards.map((card) => card.date),
    ['2026-10-18', '2026-10-16', '2026-10-12', '2026-10-01'],
  );
  assert.equal(october.data.cardTextPreview, false);
  for (const card of october.data.cards) {
    assert.equal(Object.hasOwn(card, 'text'), false);
  }
  assert.doesNotMatch(JSON.stringify(october.data), /SYNTHETIC|合成晚霞正文/);

  const legacy = loadDemoPage('review/detail', {
    ...f,
    query: { date: '2026-10-16', id: 'z01_oct_16' },
  });
  await flush();
  assert.equal(legacy.data.phase, 'ready');
  assert.equal(legacy.data.weatherLabel, '合成晚霞');
  f.store.applyChange({
    date: '2026-10-16',
    kind: 'saved',
    entry: entry({
      id: 'z01_oct_16_rebuilt',
      date: '2026-10-16',
      weather: 'CUSTOM',
      weatherName: '合成新晚霞',
      text: 'SYNTHETIC rebuilt body',
      version: 2,
      createdAt: '2026-10-17T01:00:00.000Z',
      updatedAt: '2026-10-17T01:00:00.000Z',
    }),
  });
  await flush();
  assert.equal(legacy.data.phase, 'stale');
  assert.equal(legacy.data.text, '');
  assert.doesNotMatch(JSON.stringify(legacy.data), /合成晚霞|rebuilt body/);
  for (const page of [empty, september, october, legacy]) {
    page.onUnload();
  }
});

test('W4 Z01 real read failure shows an error instead of demo content', async () => {
  const reader = {
    monthArchive: async () => {
      const error = new Error('SYNTHETIC upstream failure');
      error.code = 'NETWORK_ERROR';
      throw error;
    },
    weatherView,
  };
  const { page, demoReads } = loadCloudPage('review/month', {
    reader,
    query: { month: '2026-10' },
  });
  await flush();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '连接失败，请重新读取。');
  assert.equal(page.data.recordCount, 0);
  assert.equal(page.data.cards.length, 0);
  assert.doesNotMatch(JSON.stringify(page.data), /合成演示|SYNTHETIC/);
  assert.equal(demoReads(), 0);
  page.onUnload();
});

// W4 Z02: hand-checkable 7/30/90 windows from one bounded timeline snapshot.
test('W4 Z02 statistics derive 7/30/90 windows from one bounded snapshot without health scoring', async () => {
  const customName = '一二三四五六七八九十一二三四五六七八九十';
  assert.equal(Array.from(customName).length, LIMITS.weatherNameCodePoints);
  const seeds = [
    entry({ id: 'z02_0718', date: '2026-07-18', weather: 'SUNNY' }),
    entry({ id: 'z02_0720', date: '2026-07-20', weather: 'SUNNY' }),
    entry({ id: 'z02_0721', date: '2026-07-21', weather: 'STORMY' }),
    entry({ id: 'z02_0908', date: '2026-09-08', weather: 'PARTLY_CLOUDY' }),
    entry({ id: 'z02_0920', date: '2026-09-20', weather: 'SUNNY' }),
    entry({ id: 'z02_1001', date: '2026-10-01', weather: 'STORMY' }),
    entry({ id: 'z02_1010', date: '2026-10-10', weather: 'PARTLY_CLOUDY' }),
    entry({ id: 'z02_1012', date: '2026-10-12', weather: 'CLOUDY' }),
    entry({ id: 'z02_1015', date: '2026-10-15', weather: 'TYPHOON' }),
    entry({ id: 'z02_1016', date: '2026-10-16', weather: 'RAINY' }),
    entry({ id: 'z02_1017', date: '2026-10-17', weather: 'SUNNY' }),
    entry({
      id: 'z02_1018',
      date: '2026-10-18',
      weather: 'CUSTOM',
      weatherName: customName,
    }),
  ];
  const f = demoFixture(seeds);
  let timelineCalls = 0;
  const counting = {
    ...f.service,
    timeline: (...args) => {
      timelineCalls++;
      return f.service.timeline(...args);
    },
  };
  const reader = createReviewReader({ review: counting });
  const expected = {
    7: {
      startDate: '2026-10-12',
      endDate: '2026-10-18',
      recordCount: 5,
      counts: { SUNNY: 1, PARTLY_CLOUDY: 0, CLOUDY: 1, RAINY: 1, STORMY: 0, TYPHOON: 1, CUSTOM: 1 },
    },
    30: {
      startDate: '2026-09-19',
      endDate: '2026-10-18',
      recordCount: 8,
      counts: { SUNNY: 2, PARTLY_CLOUDY: 1, CLOUDY: 1, RAINY: 1, STORMY: 1, TYPHOON: 1, CUSTOM: 1 },
    },
    90: {
      startDate: '2026-07-21',
      endDate: '2026-10-18',
      recordCount: 10,
      counts: { SUNNY: 2, PARTLY_CLOUDY: 2, CLOUDY: 1, RAINY: 1, STORMY: 2, TYPHOON: 1, CUSTOM: 1 },
    },
  };
  for (const windowDays of [7, 30, 90]) {
    const before = timelineCalls;
    const { distribution, timeline } = await reader.insights(windowDays);
    assert.equal(timelineCalls - before, 1);
    assert.equal(distribution.data.startDate, expected[windowDays].startDate);
    assert.equal(distribution.data.endDate, expected[windowDays].endDate);
    assert.equal(distribution.data.recordCount, expected[windowDays].recordCount);
    assert.equal(timeline.data.recordCount, expected[windowDays].recordCount);
    assert.equal(distribution.data.sourceRevision, timeline.data.sourceRevision);
    assert.equal(distribution.data.bins.length, WEATHER_TYPES.length);
    assert.equal(
      distribution.data.bins.reduce((sum, bin) => sum + bin.count, 0),
      expected[windowDays].recordCount,
    );
    for (const bin of distribution.data.bins) {
      assert.equal(bin.count, expected[windowDays].counts[bin.weather]);
    }
    assert.equal(
      distribution.data.bins.map((bin) => bin.weather).join(','),
      'SUNNY,PARTLY_CLOUDY,CLOUDY,RAINY,STORMY,TYPHOON,CUSTOM',
    );
    const line = timeline.data;
    assert.deepEqual(
      line.items.map((item) => item.date),
      [...line.items.map((item) => item.date)].sort().reverse(),
    );
    assert.equal(line.trendEligible, line.recordCount >= LIMITS.minimumTrendEntries);
    const custom = line.items.find((item) => item.weather === 'CUSTOM');
    assert.equal(custom.weatherName, customName);
    assert.deepEqual(weatherView('CUSTOM', custom.weatherName), {
      icon: '🌈',
      label: customName,
    });
    assert.equal(
      line.items.some((item) => item.date === '2026-07-20'),
      false,
    );
    assert.doesNotMatch(JSON.stringify({ distribution, timeline }), /health|score/);
  }
  assert.equal(
    (await reader.timeline(90)).data.items.some((item) => item.date === '2026-07-21'),
    true,
  );
  assert.equal(
    (await reader.timeline(90)).data.items.some((item) => item.date === '2026-07-20'),
    false,
  );
  assert.equal(
    (await reader.timeline(30)).data.items.some((item) => item.date === '2026-09-08'),
    false,
  );
});

// W4 Z03: modify, delete, rebuild, account switch, disable and out-of-order responses.
test('W4 Z03 refresh clears deleted bodies and custom names across month, detail and timeline', async () => {
  const f = backendClient();
  const saved = await f.save({
    weather: 'CUSTOM',
    weatherName: '合成私有彩虹',
    text: 'SYNTHETIC private body A',
  });
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  const month = loadCloudPage('review/month', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10' },
  }).page;
  const detail = loadCloudPage('review/detail', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10', date: '2026-10-18', id: saved.data.entry.id },
  }).page;
  const insights = loadCloudPage('review/insights', {
    reader: f.reader,
    sessionState: state,
  }).page;
  await flush();
  assert.match(JSON.stringify(month.data), /合成私有彩虹/);
  assert.doesNotMatch(JSON.stringify(month.data), /private body A/);
  assert.equal(detail.data.phase, 'ready');
  assert.equal(detail.data.text, 'SYNTHETIC private body A');
  assert.match(JSON.stringify(insights.data), /合成私有彩虹/);

  detail.onHide();
  assert.equal(detail.data.text, '');
  assert.doesNotMatch(JSON.stringify(detail.data), /合成私有彩虹|private body A/);
  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 1 });
  await month.onRetry();
  await insights.onRetry();
  detail.onShow();
  await flush();
  assert.equal(detail.data.phase, 'missing');
  assert.equal(detail.data.text, '');
  assert.deepEqual(month.data.cards, []);
  assert.deepEqual(insights.data.timelineItems, []);
  for (const page of [month, detail, insights]) {
    assert.doesNotMatch(
      JSON.stringify(page.data),
      /合成私有彩虹|private body A|合成演示/,
      page === month ? 'month' : page === detail ? 'detail' : 'insights',
    );
    page.onUnload();
  }

  const rebuilt = await f.save({
    weather: 'CUSTOM',
    weatherName: '合成重建名称',
    text: 'SYNTHETIC rebuilt body',
  });
  const oldDetail = loadCloudPage('review/detail', {
    reader: f.reader,
    query: { date: '2026-10-18', id: saved.data.entry.id },
  }).page;
  const newMonth = loadCloudPage('review/month', {
    reader: f.reader,
    query: { month: '2026-10' },
  }).page;
  await flush();
  assert.equal(oldDetail.data.phase, 'stale');
  assert.equal(oldDetail.data.text, '');
  assert.equal(newMonth.data.cards[0].id, rebuilt.data.entry.id);
  assert.match(JSON.stringify(newMonth.data), /合成重建名称/);
  assert.doesNotMatch(JSON.stringify(newMonth.data), /合成私有彩虹|private body A/);
  oldDetail.onUnload();
  newMonth.onUnload();
});

test('W4 Z03 account switch, disabled account and late month responses never restore old views', async () => {
  const f = backendClient();
  await f.save({
    weather: 'CUSTOM',
    weatherName: '合成切号名称',
    text: 'SYNTHETIC switch body',
  });
  const state = createSessionState();
  const scopeA = 'scope_' + 'a'.repeat(64);
  state.accept(scopeA);
  const { page } = loadCloudPage('universe', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10' },
  });
  page.onMonthPick({ detail: { value: '2026-10' } });
  await flush();
  assert.equal(page.data.monthRecordCount, 1);
  assert.match(JSON.stringify(page.data), /合成切号名称/);

  f.setActor('b');
  state.accept('scope_' + 'b'.repeat(64));
  assert.doesNotMatch(JSON.stringify(page.data), /合成切号名称|switch body/);
  assert.match(page.data.calendarError, /登录状态已变化/);
  await page.onRetry();
  assert.equal(page.data.monthRecordCount, 0);
  assert.doesNotMatch(JSON.stringify(page.data), /合成切号名称|switch body|合成演示/);

  f.setActor('disabled');
  await page.onRetry();
  assert.equal(page.data.weeks.length, 0);
  assert.match(page.data.calendarError, /停用/);
  assert.doesNotMatch(JSON.stringify(page.data), /合成切号名称|switch body/);

  f.setActor('a');
  state.accept(scopeA);
  await page.onRetry();
  assert.equal(page.data.monthRecordCount, 1);
  assert.match(JSON.stringify(page.data), /合成切号名称/);
  page.onUnload();

  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let reads = 0;
  const lateReader = {
    ...f.reader,
    calendar: (month) => {
      reads++;
      if (reads === 1) {
        return first;
      }
      return f.reader.calendar(month);
    },
    weatherView,
  };
  const late = loadCloudPage('universe', { reader: lateReader }).page;
  await settle();
  await late._loadMonth('2026-10');
  releaseFirst({
    ok: true,
    data: { month: '2026-11', sourceRevision: 1, recordCount: 0, entries: [] },
  });
  await flush();
  assert.equal(late.data.month, '2026-10');
  assert.equal(late.data.monthRecordCount, 1);
  assert.equal(late.data.calendarError, '');
  assert.equal(late.data.weeks.flat().filter((cell) => cell.recorded).length, 1);
  late.onUnload();
});

// W4 Z04: static decoration candidate rules and core review independence.
test('W4 Z04 decoration supports valid combinations, withdrawal, reset and conflict handling', async () => {
  const f = demoFixture([
    entry({ id: 'z04_oct_16', date: '2026-10-16', weather: 'SUNNY' }),
    entry({ id: 'z04_oct_18', date: '2026-10-18', weather: 'RAINY' }),
  ]);
  const get = () => f.service.decorations({ operation: 'get', month: '2026-10' });
  const replace = (input) =>
    f.service.decorations({
      operation: 'replace',
      month: '2026-10',
      expectedVersion: input.expectedVersion,
      stickers: input.stickers,
      backgroundId: input.backgroundId,
    });
  const added = await replace({
    expectedVersion: 0,
    stickers: [
      { stickerId: 'STICKER_STAR' },
      { stickerId: 'STICKER_MOON', targetEntryId: 'z04_oct_16' },
    ],
    backgroundId: 'BACKGROUND_SKY_NIGHT',
  });
  assert.equal(added.data.version, 1);
  assert.equal(added.data.stickers.length, 2);
  assert.equal(added.data.backgroundId, 'BACKGROUND_SKY_NIGHT');
  assert.deepEqual((await get()).data, added.data);

  await assert.rejects(
    replace({ expectedVersion: 0, stickers: [], backgroundId: null }),
    (error) => error.code === 'CONFLICT',
  );
  for (const input of [
    { expectedVersion: 1, stickers: [{ stickerId: 'STICKER_ALIEN' }], backgroundId: null },
    {
      expectedVersion: 1,
      stickers: [{ stickerId: 'STICKER_STAR' }, { stickerId: 'STICKER_STAR' }],
      backgroundId: null,
    },
    {
      expectedVersion: 1,
      stickers: [{ stickerId: 'STICKER_STAR', targetEntryId: 'other_month_entry' }],
      backgroundId: null,
    },
    { expectedVersion: 1, stickers: [], backgroundId: 'BACKGROUND_SPACE' },
  ]) {
    await assert.rejects(replace(input), (error) => error.code === 'INVALID_INPUT');
  }
  const tooMany = [];
  for (const stickerId of [
    'STICKER_STAR',
    'STICKER_MOON',
    'STICKER_LEAF',
    'STICKER_UMBRELLA',
    'STICKER_CAT',
    'STICKER_BALLOON',
  ]) {
    tooMany.push({ stickerId });
  }
  tooMany.push({ stickerId: 'STICKER_STAR', targetEntryId: 'z04_oct_18' });
  await assert.rejects(
    replace({ expectedVersion: 1, stickers: tooMany, backgroundId: null }),
    (error) => error.code === 'INVALID_INPUT',
  );

  f.store.applyChange({ date: '2026-10-16', kind: 'deleted' });
  const withdrawn = (await get()).data;
  assert.equal(withdrawn.stickers.length, 1);
  assert.equal(withdrawn.stickers[0].stickerId, 'STICKER_STAR');
  assert.equal(withdrawn.version, 1);

  const reset = await f.service.decorations({
    operation: 'reset',
    month: '2026-10',
    expectedVersion: withdrawn.version,
  });
  assert.equal(reset.data.version, 2);
  assert.deepEqual(reset.data.stickers, []);
  assert.equal(reset.data.backgroundId, null);
  const untouched = await f.service.decorations({
    operation: 'reset',
    month: '2026-09',
    expectedVersion: 0,
  });
  assert.equal(untouched.data.version, 0);
  assert.deepEqual(untouched.data.stickers, []);
});

test('W4 Z04 decoration read failure degrades without hiding calendar or records', async () => {
  const f = demoFixture();
  const failing = {
    ...f.service,
    decorations: async () => {
      const error = new Error('SYNTHETIC decoration failure');
      error.code = 'NETWORK_ERROR';
      throw error;
    },
  };
  const page = loadDemoPage('universe', { store: f.store, service: failing });
  page.onMonthPick({ detail: { value: '2026-10' } });
  await flush();
  assert.equal(page.data.monthRecordCount, 1);
  assert.equal(page.data.calendarError, '');
  assert.match(page.data.decorationNote, /读取失败|降级/);
  assert.equal(page.data.decorationStickers.length, 0);
  assert.equal(page.data.decorationBackground, '');
  page.onUnload();
});

test('W4 Z04 asset failure and decoration preference keep core review data readable', async () => {
  const f = demoFixture();
  const page = loadDemoPage('universe', f);
  page.onMonthPick({ detail: { value: '2026-10' } });
  await flush();
  const recorded = page.data.weeks.flat().filter((cell) => cell.recorded).length;
  assert.equal(page.data.monthRecordCount, 1);
  page.onAddSticker();
  await flush();
  assert.equal(page.data.decorationStickers.length, 1);
  page.onSimulateAssetFailure();
  await flush();
  assert.equal(page.data.decorationFailed, true);
  assert.equal(
    page.data.decorationStickers.every((sticker) => sticker.degraded),
    true,
  );
  assert.equal(
    page.data.decorationStickers.every((sticker) => sticker.title === '素材未加载'),
    true,
  );
  assert.equal(page.data.decorationBackground, '默认背景');
  assert.equal(page.data.monthRecordCount, 1);
  assert.equal(page.data.weeks.flat().filter((cell) => cell.recorded).length, recorded);
  assert.doesNotMatch(JSON.stringify(page.data.weeks), /素材未加载|默认背景/);

  page.onToggleDecoration();
  await flush();
  assert.equal(page.data.decorationEnabled, false);
  assert.match(page.data.decorationNote, /关闭/);
  assert.equal(f.service.getDecorationsPreference(), false);
  assert.equal(f.store.revision() > 0, true);
  page.onToggleDecoration();
  await flush();
  assert.equal(page.data.decorationEnabled, true);
  assert.match(page.data.decorationNote, /开启/);
  page.onUnload();
});

// W4 Z05: seven weather icons, long CUSTOM names, empty states and local style evidence.
test('W4 Z05 seven weather icons and long custom names stay readable on review pages', async () => {
  const longName = '一二三四五六七八九十一二三四五六七八九十';
  const f = demoFixture([
    entry({ id: 'z05_oct_16', date: '2026-10-16', weather: 'CUSTOM', weatherName: longName }),
  ]);
  assert.equal(Array.from(longName).length, 20);
  assert.deepEqual(
    WEATHER_TYPES.map((item) => item.code),
    ['SUNNY', 'PARTLY_CLOUDY', 'CLOUDY', 'RAINY', 'STORMY', 'TYPHOON', 'CUSTOM'],
  );
  for (const { code } of WEATHER_TYPES) {
    assert.equal(typeof ICONS[code], 'string');
    assert.notEqual(ICONS[code], '');
  }
  const month = loadDemoPage('review/month', { ...f, query: { month: '2026-10' } });
  const detail = loadDemoPage('review/detail', {
    ...f,
    query: { date: '2026-10-16', id: 'z05_oct_16' },
  });
  const insights = loadDemoPage('review/insights', f);
  await flush();
  assert.equal(month.data.cards.length, 1);
  assert.equal(month.data.cards[0].label, longName);
  assert.equal(month.data.cards[0].icon, '🌈');
  assert.equal(detail.data.weatherLabel, longName);
  assert.equal(detail.data.icon, '🌈');
  const customRow = insights.data.timelineItems.find((item) => item.label === longName);
  assert.ok(customRow);
  assert.equal(customRow.icon, '🌈');
  assert.equal(insights.data.distRows.length, 7);
  assert.equal(insights.data.distRows.find((row) => row.key === 'CUSTOM').count, 1);
  for (const page of [month, detail, insights]) {
    page.onUnload();
  }
});

test('W4 Z05 empty windows and empty months show neutral states without synthetic weather', async () => {
  const f = demoFixture([]);
  const month = loadDemoPage('review/month', { ...f, query: { month: '2026-08' } });
  const insights = loadDemoPage('review/insights', f);
  await flush();
  assert.equal(month.data.recordCount, 0);
  assert.deepEqual(month.data.cards, []);
  assert.equal(month.data.error, '');
  assert.equal(insights.data.distributionEmpty, true);
  assert.deepEqual(insights.data.timelineItems, []);
  assert.equal(insights.data.distRows.length, 7);
  assert.equal(
    insights.data.distRows.every((row) => row.count === 0),
    true,
  );
  assert.equal(
    insights.data.distRows.every((row) => row.percent === 0),
    true,
  );
  assert.match(insights.data.blankText, /留白/);
  assert.match(insights.data.trendText, /不足 3 条/);
  assert.doesNotMatch(JSON.stringify(insights.data), /上升|下降|评分/);
  month.onUnload();
  insights.onUnload();
});

test('W4 Z05 review styles wrap long labels, use rpx text sizes and add no animation', () => {
  const files = [
    'miniprogram/pages/review/month/index.wxss',
    'miniprogram/pages/review/detail/index.wxss',
    'miniprogram/pages/review/insights/index.wxss',
    'miniprogram/pages/universe/index.wxss',
  ].map((relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8'));
  assert.match(files[0], /\.archive-card-label[\s\S]*word-break: break-all/);
  assert.match(files[1], /\.detail-label[\s\S]*word-break: break-all/);
  assert.match(files[2], /\.timeline-label[\s\S]*word-break: break-all/);
  for (const content of files) {
    assert.doesNotMatch(content, /font-size:\s*\d+px/);
    assert.doesNotMatch(content, /animation:|@keyframes|transition:/);
  }
});

test('W4 Z02 insights page keeps one snapshot and never invents a health score', async () => {
  const f = demoFixture([
    entry({ id: 'page_oct_16', date: '2026-10-16', weather: 'SUNNY' }),
    entry({ id: 'page_oct_17', date: '2026-10-17', weather: 'RAINY' }),
    entry({ id: 'page_oct_18', date: '2026-10-18', weather: 'CUSTOM', weatherName: '合成彩虹' }),
  ]);
  let timelineReads = 0;
  const counted = {
    ...f.service,
    timeline: (...args) => {
      timelineReads++;
      return f.service.timeline(...args);
    },
  };
  const page = loadDemoPage('review/insights', { store: f.store, service: counted });
  await flush();
  assert.equal(timelineReads, 1);
  assert.equal(page.data.distRows.length, 7);
  assert.equal(page.data.timelineItems.length, 3);
  assert.match(page.data.metaText, /实际记录 3 条/);
  assert.match(page.data.trendText, /至少 3 条/);
  assert.doesNotMatch(JSON.stringify(page.data), /health|score|评分/);
  page.onUnload();
});
