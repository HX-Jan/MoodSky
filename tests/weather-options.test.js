const test = require('node:test');
const assert = require('node:assert/strict');
const { WEATHER_TYPES } = require('../miniprogram/shared/constants');
const { validateJournalInput } = require('../miniprogram/shared/validation');
const { weatherView } = require('../miniprogram/modules/review/presentation');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const {
  createCloudJournalRepository,
  LAYOUT,
  dayId,
} = require('../tools/journal-storage/cloudbase-candidate');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { formatExport } = require('../tools/export-candidate/formatter');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { inspectJournalSnapshot } = require('../tools/week2-integration/journal-preflight');
const { createReviewReader } = require('../miniprogram/modules/review/reader');
const now = () => new Date('2026-10-21T01:00:00.000Z');
const owner = 'synthetic_weather_owner';
const date = '2026-10-21';
const input = (weather, extra = {}) => ({ date, weather, expectedVersion: 0, ...extra });
const account = () => ({
  _id: owner,
  openid: 'synthetic_weather_openid',
  status: 'active',
  journalLayout: LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
});
function client(db) {
  const router = createWeek2Backend({ db, receiptPolicy: createSyntheticReceiptPolicy(), now });
  let serial = 0;
  return (action, payload, requestId = 'req_weather_' + ++serial) =>
    router({ apiVersion: '1', action, payload, requestId }, { OPENID: 'synthetic_weather_openid' });
}

test('weather contract accepts seven canonical choices, validates custom names by code point and rejects duplicate storm codes', () => {
  assert.equal(WEATHER_TYPES.length, 7);
  assert.equal(new Set(WEATHER_TYPES.map((item) => item.code)).size, 7);
  for (const { code } of WEATHER_TYPES) {
    const extra = code === 'CUSTOM' ? { weatherName: '  合成彩虹😀  ' } : {};
    const result = validateJournalInput(input(code, extra));
    assert.equal(result.weather, code);
    assert.equal(result.weatherName, code === 'CUSTOM' ? '合成彩虹😀' : undefined);
    assert.ok(weatherView(code, result.weatherName).icon);
    assert.ok(weatherView(code, result.weatherName).label);
  }
  assert.equal(
    validateJournalInput(input('CUSTOM', { weatherName: '😀'.repeat(20) })).weatherName.length,
    40,
  );
  for (const weatherName of [undefined, '', '  ', 123, '😀'.repeat(21), '雨\n晴', '风\u0000雨']) {
    assert.throws(() => validateJournalInput(input('CUSTOM', { weatherName })), {
      code: 'INVALID_INPUT',
    });
  }
  for (const payload of [
    input('HEAVY_RAIN'),
    input('UNKNOWN'),
    input('SUNNY', { weatherName: '残留名称' }),
  ]) {
    assert.throws(() => validateJournalInput(payload), { code: 'INVALID_INPUT' });
  }
  assert.equal(weatherView('STORMY').label, '雷雨');
});

test('assembled journal, deterministic storage and review keep typhoon/custom metadata through editing and deletion', async () => {
  const f = databaseFixture({ ['accounts:' + owner]: account() });
  const call = client(f.db);
  assert.equal((await call('journal.upsert', input('TYPHOON', { date: '2026-10-20' }))).ok, true);
  const saved = await call(
    'journal.upsert',
    input('CUSTOM', { weatherName: '合成彩虹😀', text: 'SIMULATED private body' }),
  );
  assert.equal(saved.ok, true);
  assert.equal(saved.data.entry.weatherName, '合成彩虹😀');
  for (const [action, payload, key] of [
    ['review.calendar', { month: '2026-10' }, 'entries'],
    ['review.monthArchive', { month: '2026-10' }, 'cards'],
    ['review.timeline', { windowDays: 7 }, 'items'],
  ]) {
    const result = await call(action, payload);
    assert.equal(result.ok, true);
    assert.equal(result.data[key].find((row) => row.date === date).weatherName, '合成彩虹😀');
    assert.doesNotMatch(JSON.stringify(result), /private body|ownerId|openid/);
  }
  const distribution = (await call('review.distribution', { windowDays: 7 })).data;
  assert.equal(distribution.bins.length, 7);
  assert.equal(distribution.bins.find((bin) => bin.weather === 'CUSTOM').count, 1);
  assert.equal(distribution.bins.find((bin) => bin.weather === 'TYPHOON').count, 1);
  const edited = await call('journal.upsert', input('STORMY', { expectedVersion: 1 }));
  assert.equal(edited.ok, true);
  assert.equal(Object.hasOwn(edited.data.entry, 'weatherName'), false);
  const rowKey = 'journals:' + dayId(owner, date);
  assert.equal(Object.hasOwn(f.inspect()[rowKey], 'weatherName'), false);
  assert.equal((await call('journal.delete', { date, expectedVersion: 2 })).ok, true);
  const stored = f.inspect();
  assert.equal(stored[rowKey].state, 'deleted');
  assert.equal(Object.hasOwn(stored[rowKey], 'weatherName'), false);
  const metadata = Object.fromEntries(
    Object.entries(stored).filter(([key]) => !key.startsWith('journals:')),
  );
  assert.doesNotMatch(JSON.stringify(metadata), /合成彩虹|private body/);
});

test('original request receipts bind the custom name and invalid names never write journal data', async () => {
  const f = databaseFixture({ ['accounts:' + owner]: account() });
  const call = client(f.db);
  const payload = input('CUSTOM', { weatherName: '合成晨雾' });
  const first = await call('journal.upsert', payload, 'req_custom_weather_replay');
  assert.equal(first.ok, true);
  assert.deepEqual(
    (await call('journal.upsert', payload, 'req_custom_weather_replay')).data,
    first.data,
  );
  const changed = await call(
    'journal.upsert',
    { ...payload, weatherName: '另一个名称' },
    'req_custom_weather_replay',
  );
  assert.equal(changed.error.code, 'CONFLICT');
  const before = f.inspect();
  const invalid = await call('journal.upsert', input('CUSTOM', { weatherName: '😀'.repeat(21) }));
  assert.equal(invalid.error.code, 'INVALID_INPUT');
  assert.deepEqual(f.inspect(), before);
});

test('custom save response mismatch preserves the draft and exact original request for confirmation', async () => {
  const memory = createMemoryJournalService({ now });
  const requests = [];
  const controller = createJournalController({
    now,
    service: {
      ...memory,
      async submit(request) {
        requests.push(request);
        const response = await memory.submit(request);
        if (requests.length === 1) {
          response.data.entry.weatherName = '合成错误名称';
        }
        return response;
      },
    },
  });
  await controller.loadDate(date);
  controller.chooseWeather('CUSTOM');
  assert.equal(controller.getState().canSave, false);
  controller.setWeatherName(' 合成雨后😀 ');
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().pendingRetry, true);
  assert.equal(controller.getState().weatherName, ' 合成雨后😀 ');
  assert.equal(controller.setWeatherName('不能换输入'), false);
  assert.equal(await controller.retry(), true);
  assert.equal(requests[0], requests[1]);
  assert.equal(controller.getState().entry.weatherName, '合成雨后😀');
  controller.chooseWeather('TYPHOON');
  assert.equal(await controller.save(), true);
  assert.equal(Object.hasOwn(requests.at(-1).payload, 'weatherName'), false);
  assert.equal(Object.hasOwn((await memory.get(date)).data.entry, 'weatherName'), false);
  controller.dispose();
});

test('installed SDK serialization preserves custom metadata and tombstones remove it without network access', async () => {
  await withOfflineWxDatabase({ ['accounts:' + owner]: account() }, async ({ db }) => {
    const call = client(db);
    const saved = await call('journal.upsert', input('CUSTOM', { weatherName: '合成远山😀' }));
    assert.equal(saved.ok, true);
    const repository = createCloudJournalRepository(db);
    assert.equal((await repository.readDay(owner, date)).entry.weatherName, '合成远山😀');
    assert.equal(
      (await repository.readSnapshot(owner, { startDate: date, endDate: date })).entries[0]
        .weatherName,
      '合成远山😀',
    );
    assert.equal((await call('journal.delete', { date, expectedVersion: 1 })).ok, true);
    const row = await db.runTransaction(
      async (tx) => (await tx.collection('journals').doc(dayId(owner, date)).get()).data,
    );
    assert.equal(row.state, 'deleted');
    assert.equal(Object.hasOwn(row, 'weatherName'), false);
  });
});

test('export gathering and JSON/Markdown formatting retain custom names while escaping Markdown', async () => {
  const f = databaseFixture({ ['accounts:' + owner]: account() });
  const call = client(f.db);
  const name = '<合成>*😀';
  assert.equal((await call('journal.upsert', input('CUSTOM', { weatherName: name }))).ok, true);
  const service = createExportService({
    db: f.db,
    maxRecords: 100,
    readSourceState: async () => ({
      ownerId: owner,
      status: 'active',
      epoch: 1,
      revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
    }),
  });
  const snapshot = await service.gatherExportData(owner);
  assert.equal(snapshot.journals[0].weatherName, name);
  const options = { accountId: owner, exportedAt: now(), maxRecords: 100, maxBytes: 1048576 };
  const json = formatExport(snapshot, { ...options, format: 'json' });
  assert.equal(JSON.parse(json.content).data.journals[0].weatherName, name);
  const markdown = formatExport(snapshot, { ...options, format: 'markdown' });
  assert.ok(markdown.content.includes('&lt;合成&gt;\\*😀'));
  assert.doesNotMatch(json.content + markdown.content, /openid|ownerId|synthetic_weather_owner/);
});

test('snapshot preflight accepts valid custom names but rejects malformed names and deleted name residue', async () => {
  const sample = require('../tools/week2-integration/fixtures/journal-preflight.synthetic.json');
  for (const [change, expected] of [
    [{ weather: 'CUSTOM', weatherName: '合成晨光' }, 'eligible_for_review'],
    [{ weather: 'CUSTOM' }, 'blocked'],
    [{ weather: 'TYPHOON', weatherName: '无效残留' }, 'blocked'],
  ]) {
    const snapshot = globalThis.structuredClone(sample);
    Object.assign(snapshot.journals[0], change);
    assert.equal((await inspectJournalSnapshot(snapshot)).status, expected);
  }
  const snapshot = globalThis.structuredClone(sample);
  snapshot.journals[1].weatherName = '已删名称';
  assert.equal((await inspectJournalSnapshot(snapshot)).status, 'blocked');
});

test('actual review reader retains checked custom metadata and refuses malformed names without private error text', async () => {
  const f = databaseFixture({ ['accounts:' + owner]: account() });
  const call = client(f.db);
  await call('journal.upsert', input('CUSTOM', { weatherName: '合成薄雾😀' }));
  const reader = createReviewReader({
    review: {
      calendar: (month) => call('review.calendar', { month }),
      monthArchive: (month) => call('review.monthArchive', { month }),
      timeline: (windowDays) => call('review.timeline', { windowDays }),
    },
    journal: { get: (day) => call('journal.get', { date: day }) },
  });
  assert.equal((await reader.calendar('2026-10')).data.entries[0].weatherName, '合成薄雾😀');
  assert.equal((await reader.monthArchive('2026-10')).data.cards[0].weatherName, '合成薄雾😀');
  assert.equal((await reader.getEntry(date)).data.entry.weatherName, '合成薄雾😀');
  const insights = await reader.insights(7);
  assert.equal(insights.timeline.data.items[0].weatherName, '合成薄雾😀');
  assert.equal(insights.distribution.data.bins.find((bin) => bin.weather === 'CUSTOM').count, 1);
  const bad = createReviewReader({
    review: {
      calendar: async () => ({
        ok: true,
        data: {
          month: '2026-10',
          sourceRevision: 1,
          recordCount: 1,
          entries: [
            {
              id: 'synthetic_bad_custom',
              date,
              weather: 'CUSTOM',
              weatherName: 'SIMULATED_TOO_LONG_PRIVATE_WEATHER_NAME',
            },
          ],
        },
      }),
    },
  });
  await assert.rejects(
    bad.calendar('2026-10'),
    (error) => error.code === 'INVALID_RESPONSE' && !error.message.includes('PRIVATE'),
  );
});
