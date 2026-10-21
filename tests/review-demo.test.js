// 回顾演示服务核对测试（W1 Z02—Z05 交付验证）：
// 统计口径（分母=实际记录数）、缺失日期留白、不足3条不输出趋势结论、卡片不携带正文、
// 空月/跨月样例、装饰版本与降级。全部使用合成夹具与固定时钟，不调用云端。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');
const {
  SEED_ENTRIES,
  INSIGHT_FIXTURES,
  INSIGHT_FIXTURE_NOW,
} = require('../miniprogram/modules/review/demo-data');

const fixedNow = () => new Date(INSIGHT_FIXTURE_NOW);

function fixtureService(sampleId) {
  const fixture = INSIGHT_FIXTURES[sampleId];
  const store = createLocalStore(JSON.parse(JSON.stringify(fixture.entries)), 7);
  return { service: createReviewDemoService({ now: fixedNow, store }), store };
}

test('calendar renders seeded months only, ascending, without text or tags', async () => {
  const { service } = fixtureService('three');
  const october = (await service.calendar('2026-10')).data;
  assert.equal(october.month, '2026-10');
  assert.equal(october.recordCount, 3);
  assert.deepEqual(
    october.entries.map((entry) => entry.date),
    ['2026-10-09', '2026-10-12', '2026-10-15'],
  );
  for (const entry of october.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['date', 'id', 'weather']);
  }
  const emptyMonth = (await service.calendar('2026-08')).data;
  assert.deepEqual(emptyMonth.entries, []);
  assert.equal(emptyMonth.recordCount, 0);
  await assert.rejects(service.calendar('2026-13'), { code: 'INVALID_INPUT' });
  await assert.rejects(service.calendar('2026-02-30'), { code: 'INVALID_INPUT' });
});

test('empty dates never become weather marks: an unrecorded day has no entry at all', async () => {
  const { service } = fixtureService('three');
  const october = (await service.calendar('2026-10')).data;
  const dates = new Set(october.entries.map((entry) => entry.date));
  assert.equal(dates.has('2026-10-10'), false, '无记录日期不得出现任何天气标识');
  const cloudyDays = october.entries.filter((entry) => entry.weather === 'CLOUDY');
  assert.equal(cloudyDays.length, 0, '该样例没有阴天记录，月历不得出现阴天');
});

test('monthArchive cards are descending and never carry text or tags', async () => {
  const { service } = fixtureService('three');
  const data = (await service.monthArchive('2026-10')).data;
  assert.deepEqual(
    data.cards.map((card) => card.date),
    ['2026-10-15', '2026-10-12', '2026-10-09'],
  );
  for (const card of data.cards) {
    assert.equal(Object.prototype.hasOwnProperty.call(card, 'text'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(card, 'tags'), false);
  }
  assert.equal(data.cardTextPreview, false);
  const calendar = (await service.calendar('2026-10')).data;
  assert.deepEqual(
    data.cards.map((card) => card.id).sort(),
    calendar.entries.map((entry) => entry.id).sort(),
    '月历与卡片必须来自同一记录 ID',
  );
  const emptyArchive = (await service.monthArchive('2026-08')).data;
  assert.deepEqual(emptyArchive.cards, []);
  assert.equal(emptyArchive.recordCount, 0);
  assert.equal(emptyArchive.cardTextPreview, false);
});

test('distribution uses actual record count as the denominator, not window days', async () => {
  const { service } = fixtureService('two');
  const week = (await service.distribution(7)).data;
  assert.equal(week.startDate, '2026-10-09');
  assert.equal(week.endDate, '2026-10-15');
  assert.equal(week.windowDays, 7);
  assert.equal(week.recordCount, 1, '七天窗口只包含 10-12 的记录');
  const sum = week.bins.reduce((total, bin) => total + bin.count, 0);
  assert.equal(sum, week.recordCount, '分类计数之和必须等于实际记录数');
  assert.equal(week.bins.find((bin) => bin.weather === 'RAINY').count, 1);
  const month = (await service.distribution(30)).data;
  assert.equal(month.recordCount, 2, '30 天窗口跨月包含 9-20 与 10-12');
  assert.equal(month.bins.find((bin) => bin.weather === 'SUNNY').count, 1);
  assert.equal(month.bins.length, 5, '五类天气即使计数为 0 也必须保留');
  await assert.rejects(service.distribution(8), { code: 'INVALID_INPUT' });
  await assert.rejects(service.distribution('7'), { code: 'INVALID_INPUT' });
});

test('empty window shows neutral zero state without dividing by zero', async () => {
  const { service } = fixtureService('empty');
  const week = (await service.distribution(7)).data;
  assert.equal(week.recordCount, 0);
  for (const bin of week.bins) {
    assert.equal(bin.count, 0);
  }
  const line = (await service.timeline(7)).data;
  assert.deepEqual(line.items, []);
  assert.equal(line.trendEligible, false);
});

test('timeline sorts descending and trend conclusion requires at least 3 records', async () => {
  const two = fixtureService('two');
  const twoLine = (await two.service.timeline(90)).data;
  assert.equal(twoLine.recordCount, 2);
  assert.equal(twoLine.trendEligible, false, '不足 3 条不输出趋势结论');
  assert.deepEqual(
    twoLine.items.map((item) => item.date),
    ['2026-10-12', '2026-09-20'],
  );
  const three = fixtureService('three');
  const threeLine = (await three.service.timeline(7)).data;
  assert.equal(threeLine.trendEligible, true, '达到 3 条仅代表数量门槛，不是趋势结论本身');
  for (const item of threeLine.items) {
    assert.deepEqual(Object.keys(item).sort(), ['date', 'id', 'weather']);
  }
});

test('review invalidation events update calendar, archive and statistics views', async () => {
  const store = createLocalStore([], 0);
  const service = createReviewDemoService({ now: fixedNow, store });
  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified += 1;
  });
  const saved = await service.calendar('2026-10');
  assert.equal(saved.data.recordCount, 0);
  store.applyChange({
    date: '2026-10-10',
    kind: 'saved',
    entry: {
      id: 'new_entry',
      date: '2026-10-10',
      weather: 'SUNNY',
      text: '合成正文',
      tags: [],
      version: 1,
      createdAt: INSIGHT_FIXTURE_NOW,
      updatedAt: INSIGHT_FIXTURE_NOW,
    },
  });
  assert.ok(notified >= 1, '数据源变化必须发布失效事件');
  const updated = (await service.calendar('2026-10')).data;
  assert.equal(updated.recordCount, 1);
  assert.equal(updated.sourceRevision, store.revision());
  assert.equal((await service.monthArchive('2026-10')).data.recordCount, 1);
  const distribution = (await service.distribution(7)).data;
  assert.equal(distribution.recordCount, 1, '固定时钟下 2026-10-10 在 7 天窗口内');
  assert.equal(distribution.bins.find((bin) => bin.weather === 'SUNNY').count, 1);
  store.applyChange({ date: '2026-10-10', kind: 'deleted' });
  assert.equal((await service.calendar('2026-10')).data.recordCount, 0);
  unsubscribe();
  assert.equal(
    store.applyChange({ date: '2026-10-11', kind: 'saved', entry: { date: '2026-10-11' } }),
    false,
  );
  assert.equal(notified, 2, '取消订阅后不再收到通知');
});

test('detail lookup refuses invalid dates and returns full entry for the owner view', async () => {
  const { service } = fixtureService('three');
  await assert.rejects(service.getEntry('2026-02-30'), { code: 'INVALID_INPUT' });
  const result = (await service.getEntry('2026-10-12')).data;
  assert.equal(result.entry.id, 'fixture_20261012');
  assert.equal(typeof result.entry.text, 'string', '本人详情允许读取全文');
  assert.equal((await service.getEntry('2026-10-10')).data.entry, null);
});

test('decorations follow get/replace/reset with version control and safe rejection', async () => {
  const { service } = fixtureService('three');
  const initial = (await service.decorations({ operation: 'get', month: '2026-10' })).data;
  assert.deepEqual(initial, { month: '2026-10', version: 0, stickers: [], backgroundId: null });
  const replaced = (
    await service.decorations({
      operation: 'replace',
      month: '2026-10',
      expectedVersion: 0,
      stickers: [{ stickerId: 'STICKER_STAR', targetEntryId: 'fixture_20261012' }],
      backgroundId: null,
    })
  ).data;
  assert.equal(replaced.version, 1);
  await assert.rejects(
    service.decorations({
      operation: 'replace',
      month: '2026-10',
      expectedVersion: 0,
      stickers: [],
      backgroundId: null,
    }),
    { code: 'CONFLICT' },
  );
  await assert.rejects(
    service.decorations({
      operation: 'replace',
      month: '2026-10',
      expectedVersion: 1,
      stickers: [{ stickerId: 'UNKNOWN_STICKER' }],
      backgroundId: null,
    }),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    service.decorations({
      operation: 'replace',
      month: '2026-10',
      expectedVersion: 1,
      stickers: [{ stickerId: 'STICKER_STAR', targetEntryId: 'someone_else_entry' }],
      backgroundId: null,
    }),
    { code: 'INVALID_INPUT' },
  );
  const reset = (
    await service.decorations({ operation: 'reset', month: '2026-10', expectedVersion: 1 })
  ).data;
  assert.equal(reset.version, 2);
  assert.deepEqual(reset.stickers, []);
  const untouched = (await service.decorations({ operation: 'get', month: '2026-09' })).data;
  assert.equal(untouched.version, 0, '未配置月份的读取不创建文档');
});

test('invalid sticker targets never become standalone decorations or advance the version', async () => {
  const { service } = fixtureService('three');
  const replacement = {
    operation: 'replace',
    month: '2026-10',
    expectedVersion: 0,
    stickers: [{ stickerId: 'STICKER_STAR' }],
    backgroundId: null,
  };
  for (const targetEntryId of ['', ' ', 'fixture/20261012', null, 0, 'a'.repeat(129)]) {
    await assert.rejects(
      service.decorations({
        ...replacement,
        stickers: [{ stickerId: 'STICKER_STAR', targetEntryId }],
      }),
      { code: 'INVALID_INPUT' },
    );
    assert.deepEqual((await service.decorations({ operation: 'get', month: '2026-10' })).data, {
      month: '2026-10',
      version: 0,
      stickers: [],
      backgroundId: null,
    });
  }
  const standalone = (await service.decorations(replacement)).data;
  assert.deepEqual(standalone.stickers, [{ stickerId: 'STICKER_STAR' }]);
  const linked = (
    await service.decorations({
      ...replacement,
      expectedVersion: 1,
      stickers: [{ stickerId: 'STICKER_STAR', targetEntryId: 'fixture_20261012' }],
    })
  ).data;
  assert.equal(linked.version, 2);
  assert.equal(linked.stickers[0].targetEntryId, 'fixture_20261012');
});

test('stickers bound to deleted entries are filtered out; standalone stickers remain', async () => {
  const store = createLocalStore(
    JSON.parse(
      JSON.stringify([
        {
          id: 'entry_a',
          date: '2026-10-10',
          weather: 'SUNNY',
          tags: [],
          text: '合成',
          version: 1,
          createdAt: INSIGHT_FIXTURE_NOW,
          updatedAt: INSIGHT_FIXTURE_NOW,
        },
      ]),
    ),
    3,
  );
  const service = createReviewDemoService({ now: fixedNow, store });
  await service.decorations({
    operation: 'replace',
    month: '2026-10',
    expectedVersion: 0,
    stickers: [
      { stickerId: 'STICKER_STAR', targetEntryId: 'entry_a' },
      { stickerId: 'STICKER_MOON' },
    ],
    backgroundId: 'BACKGROUND_SKY_DAY',
  });
  let view = (await service.decorations({ operation: 'get', month: '2026-10' })).data;
  assert.equal(view.stickers.length, 2);
  store.applyChange({ date: '2026-10-10', kind: 'deleted' });
  view = (await service.decorations({ operation: 'get', month: '2026-10' })).data;
  assert.deepEqual(
    view.stickers.map((sticker) => sticker.stickerId),
    ['STICKER_MOON'],
    '关联已删记录的贴纸立即过滤，独立月份装饰保留',
  );
});

test('demo seeds cover the required cross-month, cloudy and empty-month scenarios', () => {
  const dates = SEED_ENTRIES.map((entry) => entry.date).sort();
  assert.ok(
    dates.some((date) => date.startsWith('2026-09')),
    '跨月样例需要 9 月记录',
  );
  assert.ok(
    dates.some((date) => date.startsWith('2026-10')),
    '跨月样例需要 10 月记录',
  );
  assert.ok(
    SEED_ENTRIES.some((entry) => entry.weather === 'CLOUDY'),
    '需要一条真实阴天记录，用于区分阴天与空白日期',
  );
  assert.equal(
    SEED_ENTRIES.some((entry) => entry.date.startsWith('2026-08')),
    false,
    '全空月份样例不得包含记录',
  );
  for (const entry of SEED_ENTRIES) {
    assert.equal(typeof entry.text, 'string', '每条种子记录都需要配套文字');
    assert.ok(entry.text.length > 0);
  }
  assert.equal(INSIGHT_FIXTURES.empty.entries.length, 0);
  assert.equal(INSIGHT_FIXTURES.two.entries.length, 2);
  assert.equal(INSIGHT_FIXTURES.three.entries.length, 3);
});
