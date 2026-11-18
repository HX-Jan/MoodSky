const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { AppError } = require('../miniprogram/shared/result');
const { businessDate } = require('../miniprogram/shared/date');
const { weatherLabel } = require('../miniprogram/shared/weather');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');
const { createReviewReader } = require('../miniprogram/modules/review/reader');
const { SEED_ENTRIES, EMPTY_DEMO_MONTH } = require('../miniprogram/modules/review/demo-data');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { backendClient } = require('./helpers/backend-client');

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (rounds = 4) => {
  for (let index = 0; index < rounds; index += 1) {
    await settle();
  }
};
const scope = (letter) => 'scope_' + letter.repeat(64);
const list = (value) => Array.from(value || []);
const shiftDate = (date, offset) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

// Synthetic inventory used by this week's run: the same seed Yifan keeps for the
// demo journaller, pinned here so a data drift fails loudly instead of silently
// changing the expectation table in docs/week6/zhifeng-dai.
const INVENTORY = Object.freeze({
  '2026-09': Object.freeze([
    Object.freeze({ date: '2026-09-27', id: 'demo_20260927', weather: 'SUNNY', label: '晴天' }),
    Object.freeze({ date: '2026-09-30', id: 'demo_20260930', weather: 'RAINY', label: '雨天' }),
  ]),
  '2026-10': Object.freeze([
    Object.freeze({
      date: '2026-10-01',
      id: 'demo_20261001',
      weather: 'PARTLY_CLOUDY',
      label: '多云',
    }),
    Object.freeze({ date: '2026-10-09', id: 'demo_20261009', weather: 'SUNNY', label: '晴天' }),
    Object.freeze({ date: '2026-10-12', id: 'demo_20261012', weather: 'CLOUDY', label: '阴天' }),
    Object.freeze({ date: '2026-10-15', id: 'demo_20261015', weather: 'STORMY', label: '雷雨' }),
    Object.freeze({ date: '2026-10-16', id: 'demo_20261016', weather: 'RAINY', label: '雨天' }),
  ]),
  [EMPTY_DEMO_MONTH]: Object.freeze([]),
});

function demoStore() {
  return createLocalStore(clone(SEED_ENTRIES));
}

function demoPage(name, { store, service, query = {}, wx: wxExtra = {} } = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  const demoService = require('../miniprogram/modules/review/demo-service');
  const demoStoreModule = require('../miniprogram/modules/review/demo-store');
  const wx = {
    _pullStops: 0,
    _navigations: [],
    stopPullDownRefresh() {
      this._pullStops += 1;
    },
    navigateTo(options = {}) {
      this._navigations.push({ method: 'navigateTo', url: options.url || '' });
    },
    switchTab(options = {}) {
      this._navigations.push({ method: 'switchTab', url: options.url || '' });
    },
    redirectTo(options = {}) {
      this._navigations.push({ method: 'redirectTo', url: options.url || '' });
    },
    reLaunch(options = {}) {
      this._navigations.push({ method: 'reLaunch', url: options.url || '' });
    },
    navigateBack() {
      this._navigations.push({ method: 'navigateBack', url: '' });
    },
    showToast() {},
    showModal() {},
    showShareMenu() {},
    ...wxExtra,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { journalDemo: true, cloudEnabled: false };
      }
      if (id.endsWith('/review/demo-store')) {
        return { reviewStore: store, createLocalStore: demoStoreModule.createLocalStore };
      }
      if (id.endsWith('/review/demo-service')) {
        return {
          reviewDemoService: service,
          createReviewDemoService: demoService.createReviewDemoService,
        };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: clone(definition.data),
    updates: 0,
    setData(values) {
      Object.assign(this.data, values);
      this.updates += 1;
    },
  };
  page.onLoad(query);
  return { page, wx };
}

function cloudPage(name, { reader, sessionState, query = {}, wx: wxExtra = {} }) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  const readerModule = require('../miniprogram/modules/review/reader');
  const boundary = require('../miniprogram/modules/review/session-boundary');
  const wx = {
    _pullStops: 0,
    _navigations: [],
    stopPullDownRefresh() {
      this._pullStops += 1;
    },
    navigateTo() {},
    switchTab() {},
    navigateBack() {},
    showToast() {},
    showModal() {},
    showShareMenu() {},
    ...wxExtra,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { journalDemo: false, cloudEnabled: true };
      }
      if (id.endsWith('/review/session-boundary') && sessionState) {
        return {
          ...boundary,
          subscribeReviewSession: (listener) =>
            boundary.subscribeReviewSession(listener, sessionState),
        };
      }
      if (id.endsWith('/review/reader')) {
        return {
          reviewReader: reader,
          reviewErrorMessage: readerModule.reviewErrorMessage,
          createReviewReader: readerModule.createReviewReader,
        };
      }
      if (id.endsWith('/review/demo-store')) {
        const forbidden = () => {
          throw new Error('SYNTHETIC demo store must not be used in cloud mode');
        };
        return {
          reviewStore: { subscribe: forbidden, listAll: forbidden },
          createLocalStore: forbidden,
        };
      }
      if (id.endsWith('/review/demo-service')) {
        const forbidden = () => {
          throw new Error('SYNTHETIC demo service must not be used in cloud mode');
        };
        return { reviewDemoService: {}, createReviewDemoService: forbidden };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: clone(definition.data),
    updates: 0,
    setData(values) {
      Object.assign(this.data, values);
      this.updates += 1;
    },
  };
  page.onLoad(query);
  return { page, wx };
}

const recordedCells = (page) =>
  list(page.data.weeks)
    .flatMap((week) => list(week))
    .filter((cell) => cell.recorded)
    .map((cell) => ({
      date: cell.date,
      id: cell.id,
      weather: cell.weather,
      label: cell.label,
      isToday: cell.isToday,
    }));

const cellsOf = (page) =>
  list(page.data.weeks)
    .flatMap((week) => list(week))
    .map((cell) => ({
      key: cell.key,
      date: cell.date || '',
      day: cell.day || 0,
      blank: cell.blank === true,
      recorded: cell.recorded === true,
    }));

const cardsOf = (page) =>
  list(page.data.cards).map((card) => ({
    id: card.id,
    date: card.date,
    weather: card.weather,
    label: card.label,
    hasText: Object.hasOwn(card, 'text') || Object.hasOwn(card, 'textPreview'),
  }));

// W6-Z01: list every recorded date in the reusable synthetic set and prove the
// calendar, month archive, detail page and review module agree on each date.
test('W6-Z01 synthetic inventory keeps the same marks on calendar, archive, detail and review', async () => {
  const store = demoStore();
  const service = createReviewDemoService({ store });

  for (const month of ['2026-10', '2026-09', EMPTY_DEMO_MONTH]) {
    const expected = INVENTORY[month];
    const universe = demoPage('universe', { store, service, query: { month } }).page;
    const monthPage = demoPage('review/month', { store, service, query: { month } }).page;
    await flush();
    assert.deepEqual(
      recordedCells(universe),
      expected.map((entry) => ({ ...entry, isToday: entry.date === businessDate() })),
      month + ' calendar marks must match the inventory',
    );
    assert.equal(universe.data.monthRecordCount, expected.length);
    assert.equal(
      universe.data.monthSummary,
      expected.length > 0 ? '本月 ' + expected.length + ' 条记录' : '本月暂无记录',
    );
    assert.equal(universe.data.calendarError, '');
    // Only recorded days carry a weather mark; blank days stay blank (never CLOUDY).
    assert.equal(cellsOf(universe).filter((cell) => cell.recorded).length, expected.length);
    assert.deepEqual(
      cardsOf(monthPage),
      [...expected].reverse().map((entry) => ({ ...entry, hasText: false })),
      month + ' archive cards must be the same set, newest first and text-free',
    );
    assert.equal(monthPage.data.recordCount, expected.length);
    assert.equal(monthPage.data.cardTextPreview, false);
    assert.equal(monthPage.data.error, '');
    universe.onUnload();
    monthPage.onUnload();
  }

  // Archive lists months newest first and keeps the empty-month entry for the demo.
  const archive = demoPage('review/archive', { store, service, query: {} }).page;
  assert.deepEqual(
    list(archive.data.months).map((item) => [item.month, item.recordCount, item.empty === true]),
    [
      ['2026-10', 5, false],
      ['2026-09', 2, false],
      [EMPTY_DEMO_MONTH, 0, true],
    ],
  );

  // Detail for the newest October record shows the full body only here.
  const detail = demoPage('review/detail', {
    store,
    service,
    query: { month: '2026-10', date: '2026-10-16', id: 'demo_20261016' },
  }).page;
  await flush();
  assert.equal(detail.data.phase, 'ready');
  assert.equal(detail.data.dateLabel, '2026-10-16');
  assert.equal(detail.data.weatherLabel, '雨天');
  assert.equal(detail.data.versionText, 'v1');
  assert.match(detail.data.text, /合成演示：今天的雨声/);
  assert.deepEqual(
    list(detail.data.tags).map((tag) => tag.label),
    ['平静', '休息'],
  );
  for (const page of [archive, detail]) {
    assert.doesNotMatch(JSON.stringify(page.data), /textPreview":true/);
  }

  // Review windows are derived from the runtime business day, so the expected
  // timeline is filtered with the same window instead of a frozen date.
  const today = businessDate();
  const ninetyStart = shiftDate(today, -89);
  const inNinety = SEED_ENTRIES.filter(
    (entry) => entry.date >= ninetyStart && entry.date <= today,
  ).sort((a, b) => (a.date > b.date ? -1 : 1));
  const insights = demoPage('review/insights', {
    store,
    service,
    query: { days: '90' },
  }).page;
  await flush();
  assert.deepEqual(
    list(insights.data.timelineItems).map((item) => [item.date, item.key, item.label]),
    inNinety.map((entry) => [entry.date, entry.id, weatherLabel(entry.weather, entry.weatherName)]),
  );
  assert.equal(insights.data.distributionEmpty, inNinety.length === 0);
  assert.match(insights.data.metaText, new RegExp('最近 90 天 · 共 ' + inNinety.length + ' 条'));
  const counts = new Map();
  for (const entry of inNinety) {
    counts.set(entry.weather, (counts.get(entry.weather) || 0) + 1);
  }
  for (const row of list(insights.data.distRows)) {
    assert.equal(row.count, counts.get(row.key) || 0, row.key + ' distribution must be exact');
    assert.equal(
      row.ratioText,
      inNinety.length > 0 ? row.count + '/' + inNinety.length + ' 条' : '—',
    );
  }
  // Seven days before today cannot contain the fixed 2026-09/10 records.
  const sevenStart = shiftDate(today, -6);
  const inSeven = SEED_ENTRIES.filter((entry) => entry.date >= sevenStart && entry.date <= today);
  const week = demoPage('review/insights', { store, service, query: { days: '7' } }).page;
  await flush();
  assert.deepEqual(
    list(week.data.timelineItems).map((item) => item.date),
    inSeven.map((entry) => entry.date).sort((a, b) => (a > b ? -1 : 1)),
  );
  assert.equal(week.data.distributionEmpty, inSeven.length === 0);

  for (const page of [archive, detail, insights, week]) {
    page.onUnload();
  }
});

// W6-Z02: editing then deleting a synthetic record through the Today-page path
// must leave calendar, archive, detail and the 90-day review in one state.
test('W6-Z02 edit and delete propagate one state to calendar, archive, detail and review', async () => {
  const store = demoStore();
  const service = createReviewDemoService({ store });
  const journal = createMemoryJournalService({ seedEntries: clone(SEED_ENTRIES) });
  const controller = createJournalController({
    service: journal,
    isDemo: true,
    onChanged: (change) => store.syncFromJournal(journal, change),
  });

  const universe = demoPage('universe', { store, service, query: { month: '2026-10' } }).page;
  const monthPage = demoPage('review/month', { store, service, query: { month: '2026-10' } }).page;
  const detail = demoPage('review/detail', {
    store,
    service,
    query: { month: '2026-10', date: '2026-10-16', id: 'demo_20261016' },
  }).page;
  const insights = demoPage('review/insights', { store, service, query: { days: '90' } }).page;
  await flush();
  assert.equal(universe.data.monthRecordCount, 5);
  assert.equal(list(monthPage.data.cards)[0].date, '2026-10-16');
  assert.equal(detail.data.versionText, 'v1');

  const loaded = await controller.loadDate('2026-10-16');
  assert.equal(loaded, true);
  controller.chooseWeather('STORMY');
  controller.setText('SYNTHETIC W6 edited body');
  assert.equal(await controller.save(), true);
  await flush();
  const editedCell = recordedCells(universe).find((cell) => cell.date === '2026-10-16');
  assert.deepEqual(editedCell, {
    date: '2026-10-16',
    id: 'demo_20261016',
    weather: 'STORMY',
    label: '雷雨',
    isToday: false,
  });
  assert.deepEqual(cardsOf(monthPage)[0], {
    id: 'demo_20261016',
    date: '2026-10-16',
    weather: 'STORMY',
    label: '雷雨',
    hasText: false,
  });
  assert.equal(universe.data.monthRecordCount, 5);
  assert.equal(detail.data.weatherLabel, '雷雨');
  assert.equal(detail.data.text, 'SYNTHETIC W6 edited body');
  assert.equal(detail.data.versionText, 'v2');
  const today = businessDate();
  const ninetyStart = shiftDate(today, -89);
  const hasOctober = '2026-10-16' >= ninetyStart;
  if (hasOctober) {
    assert.equal(
      list(insights.data.timelineItems).find((item) => item.date === '2026-10-16').label,
      '雷雨',
    );
    assert.equal(
      list(insights.data.distRows).find((row) => row.key === 'STORMY').count,
      SEED_ENTRIES.filter(
        (entry) =>
          entry.date >= ninetyStart &&
          entry.date <= today &&
          entry.weather === 'STORMY' &&
          entry.date !== '2026-10-16',
      ).length + 1,
    );
    assert.equal(
      list(insights.data.distRows).find((row) => row.key === 'RAINY').count,
      SEED_ENTRIES.filter(
        (entry) =>
          entry.date >= ninetyStart &&
          entry.date <= today &&
          entry.weather === 'RAINY' &&
          entry.date !== '2026-10-16',
      ).length,
    );
  }

  // Delete through the same controller confirmation path the Today page uses.
  assert.equal(controller.requestDelete(), true);
  assert.equal(await controller.confirmDelete(), true);
  await flush();
  assert.equal(universe.data.monthRecordCount, 4);
  assert.deepEqual(
    recordedCells(universe).map((cell) => cell.date),
    ['2026-10-01', '2026-10-09', '2026-10-12', '2026-10-15'],
  );
  assert.equal(cardsOf(monthPage).length, 4);
  assert.equal(cardsOf(monthPage)[0].date, '2026-10-15');
  assert.equal(detail.data.phase, 'missing');
  assert.equal(detail.data.text, '');
  assert.doesNotMatch(JSON.stringify(detail.data), /SYNTHETIC W6 edited body/);
  if (hasOctober) {
    assert.equal(
      list(insights.data.timelineItems).some((item) => item.date === '2026-10-16'),
      false,
    );
    assert.equal(
      list(insights.data.distRows).find((row) => row.key === 'RAINY').count,
      SEED_ENTRIES.filter(
        (entry) =>
          entry.date >= ninetyStart &&
          entry.date <= today &&
          entry.weather === 'RAINY' &&
          entry.date !== '2026-10-16',
      ).length,
    );
  }
  // September is untouched by an October edit/delete.
  const september = demoPage('universe', { store, service, query: { month: '2026-09' } }).page;
  await flush();
  assert.equal(september.data.monthRecordCount, 2);

  controller.dispose();
  for (const page of [universe, monthPage, detail, insights, september]) {
    page.onUnload();
  }
});

// W6-Z03: pull-to-refresh on a non-current month keeps that month and its rows,
// including an entirely empty month, and a second gesture reuses the same read.
test('W6-Z03 pull-to-refresh on a non-current month keeps the month and its rows', async () => {
  const store = demoStore();
  const service = createReviewDemoService({ store });
  const currentMonth = businessDate().slice(0, 7);
  assert.notEqual('2026-09', currentMonth);

  const { page, wx } = demoPage('universe', { store, service, query: { month: '2026-09' } });
  await flush();
  assert.equal(page.data.month, '2026-09');
  assert.equal(page.data.monthRecordCount, 2);
  const before = page.updates;

  const first = page.onPullDownRefresh();
  const second = page.onPullDownRefresh();
  assert.equal(first, second, 'a second gesture must reuse the in-flight refresh');
  assert.equal(await first, true);
  await flush(1);
  assert.equal(wx._pullStops, 1);
  assert.equal(page.data.month, '2026-09', 'refresh must not jump back to the current month');
  assert.equal(page.data.monthLabel, '2026年9月');
  assert.deepEqual(
    recordedCells(page).map((cell) => cell.date),
    ['2026-09-27', '2026-09-30'],
  );
  assert.ok(page.updates > before);

  // Empty month: refresh keeps the month, shows the empty state and stays error-free.
  const empty = demoPage('universe', { store, service, query: { month: EMPTY_DEMO_MONTH } }).page;
  await flush();
  assert.equal(await empty.onPullDownRefresh(), true);
  await flush(1);
  assert.equal(empty.data.month, EMPTY_DEMO_MONTH);
  assert.equal(empty.data.monthRecordCount, 0);
  assert.equal(empty.data.monthSummary, '本月暂无记录');
  assert.deepEqual(recordedCells(empty), []);
  assert.equal(empty.data.calendarError, '');
  const flat = cellsOf(empty);
  assert.equal(flat.length % 7, 0);
  assert.equal(flat.filter((cell) => cell.blank).length, flat.length - 31);
  assert.deepEqual(
    flat.filter((cell) => !cell.blank).map((cell) => cell.day),
    Array.from({ length: 31 }, (_, index) => index + 1),
  );

  // A hidden page must not start a new gesture.
  page.onHide();
  assert.equal(await page.onPullDownRefresh(), false);
  page.onShow();
  await flush();
  assert.equal(page.data.month, '2026-09');
  assert.equal(page.data.monthRecordCount, 2);

  page.onUnload();
  empty.onUnload();
});

// W6-Z04: a failed read keeps the month, then recovers automatically (page
// return) or explicitly (retry) without losing the selected month.
test('W6-Z04 a failed month read recovers on page return and explicit retry', async () => {
  const store = demoStore();
  const base = createReviewDemoService({ store });
  let calendarFailures = 1;
  let archiveFailures = 1;
  const service = {
    ...base,
    async calendar(month) {
      if (calendarFailures > 0) {
        calendarFailures -= 1;
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC calendar outage');
      }
      return base.calendar(month);
    },
    async monthArchive(month) {
      if (archiveFailures > 0) {
        archiveFailures -= 1;
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC archive outage');
      }
      return base.monthArchive(month);
    },
  };

  const { page } = demoPage('universe', { store, service, query: { month: '2026-09' } });
  await flush();
  assert.equal(page.data.calendarError, '连接失败，请重新读取。');
  assert.equal(page.data.month, '2026-09', 'the failed read must keep the chosen month');
  assert.equal(page.data.monthLabel, '2026年9月');
  assert.equal(page.data.calendarBusy, false);
  assert.deepEqual(recordedCells(page), []);
  assert.equal(page.data.monthRecordCount, 0);

  // Returning to the page re-reads the same month automatically, with no user tap.
  page.onShow();
  await flush();
  assert.equal(page.data.calendarError, '');
  assert.equal(page.data.month, '2026-09');
  assert.equal(page.data.monthRecordCount, 2);
  assert.deepEqual(
    recordedCells(page).map((cell) => cell.date),
    ['2026-09-27', '2026-09-30'],
  );

  // Explicit retry: one failure surfaces the message, the next one recovers.
  calendarFailures = 1;
  assert.equal(await page.onRetry(), false);
  assert.equal(page.data.calendarError, '连接失败，请重新读取。');
  assert.equal(page.data.month, '2026-09');
  assert.equal(await page.onRetry(), true);
  await flush(1);
  assert.equal(page.data.calendarError, '');
  assert.equal(page.data.monthRecordCount, 2);

  // Pull-to-refresh after a failure also clears the error instead of freezing it.
  calendarFailures = 1;
  assert.equal(await page.onPullDownRefresh(), false);
  assert.equal(page.data.calendarError, '连接失败，请重新读取。');
  assert.equal(await page.onPullDownRefresh(), true);
  await flush(1);
  assert.equal(page.data.calendarError, '');

  // The month archive page behaves the same way and keeps its month.
  const monthPage = demoPage('review/month', { store, service, query: { month: '2026-10' } }).page;
  await flush();
  assert.equal(monthPage.data.error, '连接失败，请重新读取。');
  assert.equal(monthPage.data.month, '', 'nothing is painted from a failed read');
  monthPage.onShow();
  await flush();
  assert.equal(monthPage.data.error, '');
  assert.equal(monthPage.data.month, '2026-10');
  assert.equal(monthPage.data.recordCount, 5);

  page.onUnload();
  monthPage.onUnload();
});

// W6-Z05: decoration read and sticker-asset failures degrade to text/defaults
// while the calendar, archive and detail entry stay fully usable.
test('W6-Z05 decoration and asset failures degrade without blocking review content', async () => {
  const store = demoStore();
  const base = createReviewDemoService({ store });
  let decorationFailures = 1;
  const service = {
    ...base,
    async decorations(input) {
      if (input && input.operation === 'get' && decorationFailures > 0) {
        decorationFailures -= 1;
        throw new AppError('INVALID_RESPONSE', 'SYNTHETIC asset outage');
      }
      return base.decorations(input);
    },
  };

  const { page, wx } = demoPage('universe', { store, service, query: { month: '2026-10' } });
  await flush();
  assert.equal(
    page.data.decorationNote,
    '装饰状态读取失败，已降级为默认背景；月历与记录不受影响。',
  );
  assert.equal(page.data.decorationReady, false);
  assert.equal(page.data.decorationLoading, false);
  // Core review content is unaffected by the decoration failure.
  assert.equal(page.data.monthRecordCount, 5);
  assert.equal(recordedCells(page).length, 5);
  assert.equal(page.data.calendarError, '');

  await page.onRetryDecoration();
  await flush(1);
  assert.equal(page.data.decorationReady, true);
  assert.equal(await page.onAddSticker(), undefined);
  await flush(1);
  assert.equal(page.data.decorationStickers.length, 1);

  // Simulated sticker/background asset failure: text + default background remain.
  page.onSimulateAssetFailure();
  await flush(1);
  assert.equal(page.data.decorationFailed, true);
  assert.equal(page.data.decorationBackground, '默认背景');
  assert.equal(page.data.decorationStickers[0].title, '素材未加载');
  assert.equal(page.data.decorationStickers[0].degraded, true);
  assert.match(page.data.decorationNote, /已模拟素材加载失败/);
  assert.equal(page.data.monthRecordCount, 5);
  assert.equal(recordedCells(page).length, 5);

  // Entry points still work while decorations are degraded. Returning from the
  // detail page releases the one-shot navigation lock before the next tap.
  const cell = recordedCells(page)[0];
  page.onDayTap({ currentTarget: { dataset: { date: cell.date, id: cell.id } } });
  assert.equal(
    wx._navigations[0].url,
    '/pages/review/detail/index?month=2026-10&date=' + cell.date + '&id=' + cell.id,
  );
  page.onShow();
  await flush();
  page.onOpenArchive();
  page.onShow();
  await flush();
  page.onOpenInsights();
  assert.equal(wx._navigations[1].url, '/pages/review/archive/index?month=2026-10');
  assert.equal(wx._navigations[2].url, '/pages/review/insights/index');

  // Empty days never open a detail page, even in the degraded state.
  const blank = cellsOf(page).find((entry) => entry.blank);
  page.onDayTap({ currentTarget: { dataset: { date: blank.date, id: undefined } } });
  assert.equal(wx._navigations.length, 3);

  const detail = demoPage('review/detail', {
    store,
    service,
    query: { month: '2026-10', date: cell.date, id: cell.id },
  }).page;
  await flush();
  assert.equal(detail.data.phase, 'ready');
  assert.ok(detail.data.text.length > 0);
  page.onSimulateAssetFailure();
  await flush(1);

  const monthPage = demoPage('review/month', { store, service, query: { month: '2026-10' } }).page;
  await flush();
  assert.equal(monthPage.data.recordCount, 5);
  assert.equal(monthPage.data.error, '');

  for (const item of [page, detail, monthPage]) {
    item.onUnload();
  }
});

// W6-Z06: a delayed older month read must never repaint the view after a month
// switch, a page leave/return, or a hop to another module.
test('W6-Z06 a late month response never overwrites the month after switch or return', async () => {
  const store = demoStore();
  const base = createReviewDemoService({ store });
  const control = { hold: null };
  const service = {
    ...base,
    calendar(month) {
      if (control.hold && control.hold.month === month) {
        const held = control.hold;
        control.hold = null;
        return held.promise;
      }
      return base.calendar(month);
    },
  };

  const { page } = demoPage('universe', { store, service, query: { month: '2026-09' } });
  await flush();
  assert.equal(page.data.monthRecordCount, 2);

  // (a) Switch month while the older October read is still pending.
  const monthGate = deferred();
  control.hold = { month: '2026-10', promise: monthGate.promise };
  page.onMonthPick({ detail: { value: '2026-10' } });
  assert.equal(page.data.calendarBusy, true);
  assert.equal(page.data.month, '2026-10');
  assert.deepEqual(recordedCells(page), []);
  page.onMonthPick({ detail: { value: '2026-09' } });
  await flush();
  assert.equal(page.data.month, '2026-09');
  assert.equal(page.data.monthRecordCount, 2);

  monthGate.resolve(await base.calendar('2026-10'));
  await flush();
  assert.equal(page.data.month, '2026-09', 'late October data must not switch the month back');
  assert.equal(page.data.monthRecordCount, 2);
  assert.deepEqual(
    recordedCells(page).map((cell) => cell.date),
    ['2026-09-27', '2026-09-30'],
  );
  assert.doesNotMatch(JSON.stringify(page.data), /2026-10-0[19]|2026-10-1[25]|2026-10-16/);

  // (b) Leave the page while a read is pending: the return read wins, and a
  // stale empty snapshot cannot blank the refreshed month afterwards.
  const leaveGate = deferred();
  control.hold = { month: '2026-10', promise: leaveGate.promise };
  page.onMonthPick({ detail: { value: '2026-10' } });
  assert.equal(page.data.calendarBusy, true);
  page.onHide();
  assert.equal(page._pageVisible, false);
  page.onShow();
  await flush();
  assert.equal(page.data.month, '2026-10');
  assert.equal(page.data.monthRecordCount, 5);
  leaveGate.resolve({
    ok: true,
    data: { month: '2026-10', entries: [], recordCount: 0, sourceRevision: 1 },
  });
  await flush();
  assert.equal(page.data.month, '2026-10');
  assert.equal(page.data.monthRecordCount, 5, 'the stale empty snapshot must be discarded');
  assert.equal(recordedCells(page).length, 5);

  // (c) Hop to another module while the read is pending. The other module keeps
  // its own state, and returning to the calendar shows the fresh month only.
  const moduleGate = deferred();
  control.hold = { month: '2026-09', promise: moduleGate.promise };
  page.onMonthPick({ detail: { value: '2026-09' } });
  assert.equal(page.data.calendarBusy, true);
  page.onHide();
  const archive = demoPage('review/archive', { store, service, query: {} }).page;
  await flush();
  assert.deepEqual(
    list(archive.data.months).map((item) => [item.month, item.recordCount]),
    [
      ['2026-10', 5],
      ['2026-09', 2],
      ['2026-08', 0],
    ],
  );
  moduleGate.resolve({
    ok: true,
    data: { month: '2026-09', entries: [], recordCount: 0, sourceRevision: 2 },
  });
  await flush();
  assert.equal(archive.data.months.length, 3, 'module B must not gain records from A');
  assert.doesNotMatch(JSON.stringify(archive.data), /2026-09-27|2026-09-30/);
  page.onShow();
  await flush();
  assert.equal(page.data.month, '2026-09');
  assert.equal(page.data.monthRecordCount, 2);
  assert.deepEqual(
    recordedCells(page).map((cell) => cell.date),
    ['2026-09-27', '2026-09-30'],
  );

  page.onUnload();
  archive.onUnload();
});

// W6-Z07: switching accounts while a review read is in flight must reject that
// response and never let the other account's records reach any view.
test('W6-Z07 account switch during an in-flight read rejects the late response', async () => {
  const f = backendClient();
  const state = createSessionState();
  state.accept(scope('a'));
  const aEntry = await f.save({
    date: '2026-10-17',
    weather: 'CUSTOM',
    weatherName: 'A合成私有',
    text: 'SYNTHETIC A private body',
  });
  f.setActor('b');
  const bEntry = await f.call(
    'journal.upsert',
    {
      date: '2026-10-17',
      weather: 'SUNNY',
      text: 'SYNTHETIC B private body',
      expectedVersion: 0,
    },
    { actor: 'b' },
  );
  f.setActor('a');

  const hold = deferred();
  let holdMonth = '2026-10';
  const delayedReview = {
    ...f.review,
    calendar(month) {
      if (month === holdMonth) {
        holdMonth = '';
        return hold.promise;
      }
      return f.review.calendar(month);
    },
  };
  const reader = createReviewReader({
    review: delayedReview,
    journal: f.journal,
    sessionState: state,
  });

  // Snapshot A's response before the switch so the late payload is real A data.
  const aSnapshot = await f.review.calendar('2026-10');
  const { page } = cloudPage('universe', {
    reader,
    sessionState: state,
    query: { month: '2026-10' },
  });
  await flush(1);
  assert.equal(page.data.calendarBusy, true);
  assert.deepEqual(recordedCells(page), []);

  f.setActor('b');
  state.accept(scope('b'));
  assert.match(page.data.calendarError, /登录状态已变化/);
  assert.doesNotMatch(JSON.stringify(page.data), /A合成私有|A private body/);

  hold.resolve(aSnapshot);
  await flush();
  assert.deepEqual(recordedCells(page), [], 'the late A response must be discarded');
  assert.equal(page.data.monthRecordCount, 0);
  assert.doesNotMatch(JSON.stringify(page.data), /A合成私有|A private body/);
  assert.match(page.data.calendarError, /登录状态已变化/);

  // Only B's own record may appear after an explicit retry.
  assert.equal(await page.onRetry(), true);
  await flush(1);
  assert.equal(page.data.calendarError, '');
  assert.deepEqual(
    recordedCells(page).map((cell) => [cell.date, cell.id, cell.label]),
    [['2026-10-17', bEntry.data.entry.id, '晴天']],
  );
  assert.doesNotMatch(JSON.stringify(page.data), /A合成私有/);

  // A's old detail link stays stale under B and never reveals B's body.
  const detail = cloudPage('review/detail', {
    reader,
    sessionState: state,
    query: { month: '2026-10', date: '2026-10-17', id: aEntry.data.entry.id },
  }).page;
  await flush();
  assert.equal(detail.data.phase, 'stale');
  assert.equal(detail.data.text, '');
  assert.doesNotMatch(JSON.stringify(detail.data), /B private body|A private body/);

  page.onUnload();
  detail.onUnload();
});

// W6-Z08: malformed or missing route parameters degrade to an explicit hint
// (or fall back to the current month) instead of crashing or showing stale data.
test('W6-Z08 malformed route parameters fall back or show a hint without stale content', async () => {
  const store = demoStore();
  const service = createReviewDemoService({ store });
  const currentMonth = businessDate().slice(0, 7);

  for (const month of ['2026-13', '2026-09-27', 'abc', '']) {
    const { page } = demoPage('universe', { store, service, query: { month } });
    await flush();
    assert.equal(page.data.month, currentMonth, 'invalid month must fall back to ' + currentMonth);
    assert.equal(page.data.calendarError, '');
    assert.equal(page.data.monthRecordCount, 0);
    assert.deepEqual(recordedCells(page), []);
    page.onUnload();
  }

  const missingMonth = demoPage('review/month', { store, service, query: {} }).page;
  await flush();
  assert.equal(missingMonth.data.month, '');
  assert.equal(missingMonth.data.recordCount, 0);
  assert.deepEqual(list(missingMonth.data.cards), []);
  assert.equal(missingMonth.data.error, '缺少月份参数，请从月份档案进入。');

  const invalidMonth = demoPage('review/month', {
    store,
    service,
    query: { month: '2026-13' },
  }).page;
  await flush();
  assert.equal(invalidMonth.data.month, '');
  assert.equal(invalidMonth.data.recordCount, 0);
  assert.deepEqual(list(invalidMonth.data.cards), []);
  assert.equal(invalidMonth.data.loading, false);
  assert.equal(invalidMonth.data.error, '回顾参数无效，请返回选择有效日期或月份。');

  const noDate = demoPage('review/detail', { store, service, query: { id: 'demo_20261016' } }).page;
  await flush();
  assert.equal(noDate.data.phase, 'error');
  assert.equal(noDate.data.errorMessage, '缺少有效的记录日期参数。');
  assert.equal(noDate.data.text, '');

  // A mismatched id on an existing date must never show that date's body.
  const staleId = demoPage('review/detail', {
    store,
    service,
    query: { month: '2026-10', date: '2026-10-16', id: 'demo_foreign' },
  }).page;
  await flush();
  assert.equal(staleId.data.phase, 'stale');
  assert.equal(staleId.data.text, '');
  assert.doesNotMatch(JSON.stringify(staleId.data), /今天的雨声/);

  for (const page of [missingMonth, invalidMonth, noDate, staleId]) {
    page.onUnload();
  }
});
