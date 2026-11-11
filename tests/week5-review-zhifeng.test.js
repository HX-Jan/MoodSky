const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { weatherView } = require('../miniprogram/modules/review/presentation');
const { createReviewReader, reviewErrorMessage } = require('../miniprogram/modules/review/reader');
const { backendClient } = require('./helpers/backend-client');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (rounds = 3) => {
  for (let index = 0; index < rounds; index += 1) {
    await settle();
  }
};
const scope = (letter) => 'scope_' + letter.repeat(64);

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
        return { reviewReader: reader, reviewErrorMessage, createReviewReader };
      }
      if (id.endsWith('/review/demo-store')) {
        return {
          reviewStore: {
            subscribe() {
              demoReads++;
              throw new Error('SYNTHETIC demo store must not be used in cloud mode');
            },
            listAll() {
              demoReads++;
              throw new Error('SYNTHETIC demo store must not be used in cloud mode');
            },
          },
          createLocalStore: () => {
            demoReads++;
            throw new Error('SYNTHETIC demo store must not be used in cloud mode');
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

// Page modules run in a separate VM realm; copy arrays back before strict comparison.
const list = (value) => Array.from(value || []);
const recordedCells = (page) =>
  list(page.data.weeks)
    .flatMap((week) => list(week))
    .filter((cell) => cell.recorded);

async function openFourPages(f, state, { month = '2026-10', date, id, days = 7 } = {}) {
  const universe = loadCloudPage('universe', {
    reader: f.reader,
    sessionState: state,
    query: { month },
  }).page;
  const monthPage = loadCloudPage('review/month', {
    reader: f.reader,
    sessionState: state,
    query: { month },
  }).page;
  const insights = loadCloudPage('review/insights', {
    reader: f.reader,
    sessionState: state,
    query: days === 7 ? {} : { days: String(days) },
  }).page;
  const detail = date
    ? loadCloudPage('review/detail', {
        reader: f.reader,
        sessionState: state,
        query: { month, date, id },
      }).page
    : null;
  await flush();
  return { universe, monthPage, insights, detail };
}

async function reloadFourPages(pages) {
  await pages.universe.onRetry();
  await pages.monthPage.onRetry();
  await pages.insights.onRetry();
  if (pages.detail) {
    await pages.detail.onRetry();
  }
  await flush();
}

function closeFourPages(pages) {
  for (const page of [pages.universe, pages.monthPage, pages.insights, pages.detail]) {
    if (page) {
      page.onUnload();
    }
  }
}

// W5-R02 Z01: one record set renders identically on calendar, archive, detail and 7-day review.
test('W5-R02 Z01 the same record set stays identical across calendar, archive, detail and review', async () => {
  const f = backendClient();
  const state = createSessionState();
  state.accept(scope('a'));
  const first = await f.save({
    weather: 'CUSTOM',
    weatherName: '合成周五月',
    text: 'SYNTHETIC W5 body one',
  });
  const id = first.data.entry.id;

  const pages = await openFourPages(f, state, { date: '2026-10-18', id, days: 7 });
  assert.equal(pages.universe.data.monthRecordCount, 1);
  assert.equal(recordedCells(pages.universe).length, 1);
  assert.equal(recordedCells(pages.universe)[0].id, id);
  assert.equal(recordedCells(pages.universe)[0].date, '2026-10-18');
  assert.equal(recordedCells(pages.universe)[0].label, '合成周五月');

  assert.equal(pages.monthPage.data.recordCount, 1);
  assert.deepEqual(
    list(pages.monthPage.data.cards).map((card) => [card.id, card.date, card.label]),
    [[id, '2026-10-18', '合成周五月']],
  );
  assert.equal(pages.monthPage.data.cardTextPreview, false);
  assert.equal(Object.hasOwn(pages.monthPage.data.cards[0], 'text'), false);

  assert.deepEqual(
    list(pages.insights.data.timelineItems).map((item) => [item.key, item.date, item.label]),
    [[id, '2026-10-18', '合成周五月']],
  );
  const customRow = list(pages.insights.data.distRows).find((row) => row.key === 'CUSTOM');
  assert.equal(customRow.count, 1);
  assert.equal(customRow.ratioText, '1/1 条');

  assert.equal(pages.detail.data.phase, 'ready');
  assert.equal(pages.detail.data.text, 'SYNTHETIC W5 body one');
  assert.equal(pages.detail.data.weatherLabel, '合成周五月');
  assert.equal(pages.detail.data.versionText, 'v1');

  // Card surfaces never expose the body; only the owner detail page does.
  for (const page of [pages.universe, pages.monthPage, pages.insights]) {
    assert.doesNotMatch(JSON.stringify(page.data), /SYNTHETIC W5 body one/);
  }
  assert.equal(Object.hasOwn(recordedCells(pages.universe)[0], 'text'), false);
  assert.equal(Object.hasOwn(list(pages.insights.data.timelineItems)[0], 'text'), false);

  // Edit: weather and body changes must land on all four surfaces after refresh.
  const second = await f.save({
    date: '2026-10-18',
    weather: 'RAINY',
    text: 'SYNTHETIC W5 body two',
    expectedVersion: 1,
  });
  assert.equal(second.data.entry.id, id);
  await reloadFourPages(pages);
  assert.equal(recordedCells(pages.universe)[0].label, '雨天');
  assert.equal(recordedCells(pages.universe)[0].weather, 'RAINY');
  assert.equal(pages.monthPage.data.cards[0].label, '雨天');
  assert.equal(pages.monthPage.data.cards[0].weather, 'RAINY');
  assert.equal(pages.insights.data.timelineItems[0].key, id);
  assert.equal(pages.insights.data.timelineItems[0].label, '雨天');
  assert.equal(list(pages.insights.data.distRows).find((row) => row.key === 'RAINY').count, 1);
  assert.equal(list(pages.insights.data.distRows).find((row) => row.key === 'CUSTOM').count, 0);
  assert.equal(pages.detail.data.text, 'SYNTHETIC W5 body two');
  assert.equal(pages.detail.data.weatherLabel, '雨天');
  assert.equal(pages.detail.data.versionText, 'v2');

  // Delete: every surface drops the record, and no demo seed/backfill returns.
  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 2 });
  await reloadFourPages(pages);
  assert.equal(pages.universe.data.monthRecordCount, 0);
  assert.equal(pages.universe.data.monthSummary, '本月暂无记录');
  assert.deepEqual(recordedCells(pages.universe), []);
  assert.equal(pages.monthPage.data.cards.length, 0);
  assert.equal(pages.monthPage.data.recordCount, 0);
  assert.equal(pages.insights.data.timelineItems.length, 0);
  assert.equal(pages.insights.data.distributionEmpty, true);
  assert.equal(pages.detail.data.phase, 'missing');
  assert.equal(pages.detail.data.text, '');
  for (const page of [pages.universe, pages.monthPage, pages.insights, pages.detail]) {
    assert.doesNotMatch(JSON.stringify(page.data), /合成周五月|SYNTHETIC W5 body two|合成演示/);
  }

  // Recreate: the new entry id must replace the old id on every read surface.
  const rebuilt = await f.save({
    date: '2026-10-18',
    weather: 'CLOUDY',
    text: 'SYNTHETIC W5 body rebuilt',
    expectedVersion: 0,
  });
  const rebuiltId = rebuilt.data.entry.id;
  assert.notEqual(rebuiltId, id);

  const oldDetail = loadCloudPage('review/detail', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10', date: '2026-10-18', id },
  }).page;
  const newUniverse = loadCloudPage('universe', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10' },
  }).page;
  const newMonth = loadCloudPage('review/month', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10' },
  }).page;
  const newInsights = loadCloudPage('review/insights', {
    reader: f.reader,
    sessionState: state,
  }).page;
  const newDetail = loadCloudPage('review/detail', {
    reader: f.reader,
    sessionState: state,
    query: { month: '2026-10', date: '2026-10-18', id: rebuiltId },
  }).page;
  await flush();
  assert.equal(recordedCells(newUniverse)[0].id, rebuiltId);
  assert.equal(recordedCells(newUniverse)[0].label, '阴天');
  assert.equal(newMonth.data.cards[0].id, rebuiltId);
  assert.equal(newInsights.data.timelineItems[0].key, rebuiltId);
  assert.equal(newDetail.data.phase, 'ready');
  assert.equal(newDetail.data.text, 'SYNTHETIC W5 body rebuilt');
  assert.equal(oldDetail.data.phase, 'stale');
  assert.equal(oldDetail.data.text, '');
  assert.doesNotMatch(JSON.stringify(oldDetail.data), /W5 body|合成周五月/);

  closeFourPages(pages);
  for (const page of [oldDetail, newUniverse, newMonth, newInsights, newDetail]) {
    page.onUnload();
  }
});

// W5-R02 Z02: month boundaries never leak records into the wrong calendar or archive month.
test('W5-R02 Z02 cross-month records stay isolated per month and inside 30/90-day review', async () => {
  const f = backendClient();
  const september = await f.save({
    date: '2026-09-30',
    weather: 'STORMY',
    text: 'SYNTHETIC September body',
  });
  const october = await f.save({
    date: '2026-10-01',
    weather: 'SUNNY',
    text: 'SYNTHETIC October body',
  });
  assert.notEqual(september.data.entry.id, october.data.entry.id);

  const sepUniverse = loadCloudPage('universe', {
    reader: f.reader,
    query: { month: '2026-09' },
  }).page;
  const octUniverse = loadCloudPage('universe', {
    reader: f.reader,
    query: { month: '2026-10' },
  }).page;
  const sepMonth = loadCloudPage('review/month', {
    reader: f.reader,
    query: { month: '2026-09' },
  }).page;
  const octMonth = loadCloudPage('review/month', {
    reader: f.reader,
    query: { month: '2026-10' },
  }).page;
  const thirty = loadCloudPage('review/insights', {
    reader: f.reader,
    query: { days: '30' },
  }).page;
  const ninety = loadCloudPage('review/insights', {
    reader: f.reader,
    query: { days: '90' },
  }).page;
  const seven = loadCloudPage('review/insights', {
    reader: f.reader,
    query: { days: '7' },
  }).page;
  await flush();

  assert.deepEqual(
    recordedCells(sepUniverse).map((cell) => cell.date),
    ['2026-09-30'],
  );
  assert.equal(sepUniverse.data.monthRecordCount, 1);
  assert.deepEqual(
    recordedCells(octUniverse).map((cell) => cell.date),
    ['2026-10-01'],
  );
  assert.equal(octUniverse.data.monthRecordCount, 1);
  assert.deepEqual(
    list(sepMonth.data.cards).map((card) => card.date),
    ['2026-09-30'],
  );
  assert.deepEqual(
    list(octMonth.data.cards).map((card) => card.date),
    ['2026-10-01'],
  );
  assert.deepEqual(
    list(thirty.data.timelineItems).map((item) => item.date),
    ['2026-10-01', '2026-09-30'],
  );
  assert.match(thirty.data.metaText, /2026-09-19 至 2026-10-18/);
  assert.deepEqual(
    list(ninety.data.timelineItems).map((item) => item.date),
    ['2026-10-01', '2026-09-30'],
  );
  assert.match(ninety.data.metaText, /2026-07-21 至 2026-10-18/);
  assert.equal(ninety.data.timelineItems.length, 2);
  assert.equal(seven.data.timelineItems.length, 0);
  assert.equal(seven.data.distributionEmpty, true);

  const detail = loadCloudPage('review/detail', {
    reader: f.reader,
    query: { month: '2026-09', date: '2026-09-30', id: september.data.entry.id },
  }).page;
  await flush();
  assert.equal(detail.data.phase, 'ready');
  assert.equal(detail.data.text, 'SYNTHETIC September body');

  // Deleting the October entry must not disturb the September month or the shared 30-day window.
  await f.call('journal.delete', { date: '2026-10-01', expectedVersion: 1 });
  await octUniverse.onRetry();
  await sepUniverse.onRetry();
  await sepMonth.onRetry();
  await thirty.onRetry();
  await ninety.onRetry();
  await flush();
  assert.deepEqual(recordedCells(octUniverse), []);
  assert.equal(octUniverse.data.monthRecordCount, 0);
  assert.deepEqual(
    recordedCells(sepUniverse).map((cell) => cell.date),
    ['2026-09-30'],
  );
  assert.deepEqual(
    list(sepMonth.data.cards).map((card) => card.date),
    ['2026-09-30'],
  );
  assert.deepEqual(
    list(thirty.data.timelineItems).map((item) => item.date),
    ['2026-09-30'],
  );
  assert.deepEqual(
    list(ninety.data.timelineItems).map((item) => item.date),
    ['2026-09-30'],
  );

  for (const page of [
    sepUniverse,
    octUniverse,
    sepMonth,
    octMonth,
    thirty,
    ninety,
    seven,
    detail,
  ]) {
    page.onUnload();
  }
});

// W5-R02 Z03: empty states are explicit and no demo month/seed is used as a backfill.
test('W5-R02 Z03 empty month and missing detail never fall back to demo backfill data', async () => {
  const f = backendClient();
  const universe = loadCloudPage('universe', {
    reader: f.reader,
    query: { month: '2026-08' },
  }).page;
  const month = loadCloudPage('review/month', {
    reader: f.reader,
    query: { month: '2026-08' },
  }).page;
  const insights = loadCloudPage('review/insights', {
    reader: f.reader,
    query: { days: '7' },
  }).page;
  const detail = loadCloudPage('review/detail', {
    reader: f.reader,
    query: { month: '2026-08', date: '2026-08-15', id: 'w5_missing_id' },
  }).page;
  const archive = loadCloudPage('review/archive', {
    reader: f.reader,
    query: { month: '2026-08' },
  });
  await flush();

  assert.equal(universe.data.monthRecordCount, 0);
  assert.equal(universe.data.monthSummary, '本月暂无记录');
  assert.deepEqual(recordedCells(universe), []);
  assert.equal(universe.data.calendarError, '');

  assert.equal(month.data.recordCount, 0);
  assert.equal(month.data.cards.length, 0);
  assert.equal(month.data.error, '');

  assert.equal(insights.data.timelineItems.length, 0);
  assert.equal(insights.data.distributionEmpty, true);
  assert.match(insights.data.metaText, /共 0 条/);

  assert.equal(detail.data.phase, 'missing');
  assert.equal(detail.data.text, '');

  // Cloud archive keeps the selected month but must not invent the demo empty month catalog.
  assert.equal(archive.page.data.isDemo, false);
  assert.equal(archive.page.data.cloudEnabled, true);
  assert.equal(archive.page.data.selectedMonth, '2026-08');
  assert.equal(archive.page.data.months.length, 0);

  for (const page of [universe, month, insights, detail, archive.page]) {
    assert.doesNotMatch(JSON.stringify(page.data), /合成演示|2026-08.*recordCount.*0.*empty/);
  }
  assert.equal(archive.demoReads(), 0);
  for (const page of [universe, month, insights, detail, archive.page]) {
    page.onUnload();
  }
});

// W5-R02 Z04: A/B account switch clears every view and never restores the other account's record.
test('W5-R02 Z04 account switch clears all review surfaces without old-account backfill', async () => {
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
  // B keeps a record on the same date, which must never be shown through A's old entry link.
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

  const pages = await openFourPages(f, state, {
    date: '2026-10-17',
    id: aEntry.data.entry.id,
  });
  assert.match(JSON.stringify(pages.universe.data), /A合成私有/);
  assert.match(JSON.stringify(pages.monthPage.data), /A合成私有/);
  assert.match(JSON.stringify(pages.insights.data), /A合成私有/);
  assert.equal(pages.detail.data.text, 'SYNTHETIC A private body');
  assert.doesNotMatch(JSON.stringify(pages.universe.data), /B private body/);

  f.setActor('b');
  state.accept(scope('b'));
  for (const page of [pages.universe, pages.monthPage, pages.insights, pages.detail]) {
    assert.doesNotMatch(
      JSON.stringify(page.data),
      /A合成私有|A private body/,
      'switch must clear old-account content',
    );
  }
  assert.match(pages.monthPage.data.error, /登录状态已变化/);
  assert.match(pages.insights.data.error, /登录状态已变化/);
  assert.match(pages.detail.data.errorMessage, /登录状态已变化/);
  assert.match(pages.universe.data.calendarError, /登录状态已变化/);

  await reloadFourPages(pages);
  assert.equal(pages.universe.data.monthRecordCount, 1);
  assert.deepEqual(
    recordedCells(pages.universe).map((cell) => [cell.date, cell.id]),
    [['2026-10-17', bEntry.data.entry.id]],
  );
  assert.deepEqual(
    list(pages.monthPage.data.cards).map((card) => card.date),
    ['2026-10-17'],
  );
  assert.deepEqual(
    list(pages.insights.data.timelineItems).map((item) => item.date),
    ['2026-10-17'],
  );
  // B has a same-date record, but A's entry id must block it as a stale link.
  assert.equal(pages.detail.data.phase, 'stale');
  assert.equal(pages.detail.data.text, '');
  assert.doesNotMatch(JSON.stringify(pages.detail.data), /B private body/);
  for (const page of [pages.universe, pages.monthPage, pages.insights, pages.detail]) {
    assert.doesNotMatch(
      JSON.stringify(page.data),
      /A合成私有|A private body|B private body/,
      'B views only expose B markers',
    );
  }

  f.setActor('a');
  state.accept(scope('a'));
  await reloadFourPages(pages);
  assert.equal(pages.universe.data.monthRecordCount, 1);
  assert.deepEqual(
    recordedCells(pages.universe).map((cell) => [cell.date, cell.id]),
    [['2026-10-17', aEntry.data.entry.id]],
  );
  assert.deepEqual(
    list(pages.monthPage.data.cards).map((card) => card.date),
    ['2026-10-17'],
  );
  assert.deepEqual(
    list(pages.insights.data.timelineItems).map((item) => item.date),
    ['2026-10-17'],
  );
  assert.equal(pages.detail.data.phase, 'ready');
  assert.equal(pages.detail.data.text, 'SYNTHETIC A private body');
  assert.doesNotMatch(
    JSON.stringify([
      pages.universe.data,
      pages.monthPage.data,
      pages.insights.data,
      pages.detail.data,
    ]),
    /B private body/,
  );

  closeFourPages(pages);
});

// W5-R02 Z05: the data layer itself returns one identity/weather set for every read surface.
test('W5-R02 Z05 one bounded record set agrees across calendar, archive, detail and timeline', async () => {
  const f = backendClient();
  await f.save({ date: '2026-10-01', weather: 'SUNNY', text: 'SYNTHETIC body one' });
  await f.save({
    date: '2026-10-08',
    weather: 'CUSTOM',
    weatherName: '合成对照',
    text: 'SYNTHETIC body two',
  });
  await f.save({ date: '2026-10-18', weather: 'RAINY', text: 'SYNTHETIC body three' });

  const calendar = (await f.reader.calendar('2026-10')).data;
  const archive = (await f.reader.monthArchive('2026-10')).data;
  const { timeline } = await f.reader.insights(30);
  const line = timeline.data;

  const identity = (entry) => ({
    id: entry.id,
    date: entry.date,
    weather: entry.weather,
    weatherName: entry.weatherName,
  });
  const expected = [
    identity(calendar.entries[0]),
    identity(calendar.entries[1]),
    identity(calendar.entries[2]),
  ];
  assert.deepEqual(Array.from(calendar.entries).map(identity), expected);
  assert.deepEqual(Array.from(archive.cards).map(identity), [...expected].reverse());
  assert.deepEqual(Array.from(line.items).map(identity), [...expected].reverse());
  assert.equal(calendar.recordCount, 3);
  assert.equal(archive.recordCount, 3);
  assert.equal(line.recordCount, 3);
  assert.equal(calendar.sourceRevision, archive.sourceRevision);
  assert.equal(archive.sourceRevision, line.sourceRevision);

  for (const entry of expected) {
    const detail = (await f.reader.getEntry(entry.date)).data.entry;
    assert.deepEqual(identity(detail), entry);
    assert.match(detail.text, /^SYNTHETIC body/);
  }
  for (const payload of [calendar, archive, line]) {
    assert.doesNotMatch(JSON.stringify(payload), /SYNTHETIC body/);
    assert.equal(Object.hasOwn(payload, 'text'), false);
  }
  assert.equal(archive.cardTextPreview, false);
  assert.equal(
    Array.from(archive.cards).every((card) => Object.hasOwn(card, 'text') === false),
    true,
  );
});
