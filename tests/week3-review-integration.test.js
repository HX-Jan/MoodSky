const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { createReviewReader } = require('../miniprogram/modules/review/reader');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { LAYOUT } = require('../tools/journal-storage/cloudbase-candidate');
const account = (id) => ({
  _id: id,
  openid: 'openid_' + id,
  status: 'active',
  journalLayout: LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
});
const seed = () => ({
  'accounts:synthetic_w3_a': account('synthetic_w3_a'),
  'accounts:synthetic_w3_b': account('synthetic_w3_b'),
});
function fixture(nativeDb) {
  let instant = '2026-10-26T04:00:00.000Z';
  let serial = 0;
  const router = createWeek2Backend({
    nativeDb,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now: () => new Date(instant),
  });
  const call = async (action, payload, requestId = 'req_w3_' + ++serial, actor = 'a') => {
    const response = await router(
      { apiVersion: '1', requestId, action, payload },
      { OPENID: 'openid_synthetic_w3_' + actor },
    );
    return response;
  };
  const unwrap = async (action, payload) => {
    const result = await call(action, payload);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const reader = createReviewReader({
    review: Object.fromEntries(
      ['calendar', 'monthArchive', 'timeline', 'distribution'].map((action) => [
        action,
        (input) =>
          unwrap(
            'review.' + action,
            ['calendar', 'monthArchive'].includes(action)
              ? { month: input }
              : { windowDays: input },
          ),
      ]),
    ),
    journal: { get: (date) => unwrap('journal.get', { date }) },
  });
  return {
    call,
    reader,
    setDate(date) {
      instant = date + 'T04:00:00.000Z';
    },
  };
}

test('W3 H04 native offline snapshots agree across month and 7/30/90 boundaries without public private-name projection', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, calls }) => {
      const f = fixture(nativeDb);
      const samples = [
        ['2026-07-28', 'SUNNY'],
        ['2026-07-29', 'PARTLY_CLOUDY'],
        ['2026-09-26', 'CLOUDY'],
        ['2026-09-27', 'RAINY'],
        ['2026-10-19', 'STORMY'],
        ['2026-10-20', 'TYPHOON'],
        ['2026-10-25', 'SUNNY'],
        ['2026-10-26', 'CUSTOM'],
        ['2026-10-27', 'SUNNY'],
      ];
      for (const [date, weather] of samples) {
        f.setDate(date);
        const saved = await f.call('journal.upsert', {
          date,
          weather,
          expectedVersion: 0,
          ...(weather === 'CUSTOM' ? { weatherName: '合成私人名称😀' } : {}),
          text: 'SYNTHETIC private writing',
          tags: ['REST'],
        });
        assert.equal(saved.ok, true, JSON.stringify(saved));
      }
      f.setDate('2026-10-26');
      for (const [days, start, expectedDates] of [
        [7, '2026-10-20', ['2026-10-26', '2026-10-25', '2026-10-20']],
        [30, '2026-09-27', ['2026-10-26', '2026-10-25', '2026-10-20', '2026-10-19', '2026-09-27']],
        [
          90,
          '2026-07-29',
          [
            '2026-10-26',
            '2026-10-25',
            '2026-10-20',
            '2026-10-19',
            '2026-09-27',
            '2026-09-26',
            '2026-07-29',
          ],
        ],
      ]) {
        const { timeline, distribution } = await f.reader.insights(days);
        const serverBins = (await f.reader.distribution(days)).data;
        assert.deepEqual(
          timeline.data.items.map((item) => item.date),
          expectedDates,
        );
        assert.equal(timeline.data.startDate, start);
        assert.equal(timeline.data.endDate, '2026-10-26');
        assert.equal(timeline.data.sourceRevision, samples.length);
        assert.deepEqual(distribution.data.bins, serverBins.bins);
        assert.equal(distribution.data.recordCount, expectedDates.length);
        assert.doesNotMatch(
          JSON.stringify(distribution),
          /合成私人名称|weatherName|private writing|REST|ownerId|openid/,
        );
        assert.doesNotMatch(JSON.stringify(timeline), /private writing|REST|ownerId|openid/);
        assert.equal(timeline.data.items[0].weatherName, '合成私人名称😀');
      }
      for (const [month, dates] of [
        ['2026-08', []],
        ['2026-09', ['2026-09-26', '2026-09-27']],
        ['2026-10', ['2026-10-19', '2026-10-20', '2026-10-25', '2026-10-26', '2026-10-27']],
      ]) {
        const calendar = (await f.reader.calendar(month)).data;
        const archive = (await f.reader.monthArchive(month)).data;
        assert.deepEqual(
          calendar.entries.map((item) => item.date),
          dates,
        );
        assert.deepEqual(archive.cards, [...calendar.entries].reverse());
        assert.equal(archive.sourceRevision, calendar.sourceRevision);
        assert.equal(archive.cardTextPreview, false);
      }
      const other = await f.call('review.timeline', { windowDays: 90 }, undefined, 'b');
      assert.equal(other.data.recordCount, 0);
      assert.equal(other.data.sourceRevision, 0);
      assert.doesNotMatch(JSON.stringify(other), /合成私人名称|private writing/);
      // Read-only snapshot: <= 90 days plus account read; this is not a real latency measurement.
      const transactions = new Map();
      for (const item of calls.filter(
        (item) => item.action === 'database.getDocument' && item.params.transactionId,
      )) {
        const key = item.params.transactionId;
        transactions.set(key, (transactions.get(key) || 0) + 1);
      }
      assert.ok([...transactions.values()].every((count) => count <= 91));
    },
    { nativeDatabase: true },
  );
});

test('W3 H02/H04 native offline delete-recreate invalidates all review views and disabled account cannot replay', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, db, inspect }) => {
      const f = fixture(nativeDb);
      const payload = {
        date: '2026-10-26',
        weather: 'CUSTOM',
        weatherName: '合成已删名称',
        text: 'SYNTHETIC deleted body',
        tags: ['REST'],
        expectedVersion: 0,
      };
      const first = await f.call('journal.upsert', payload, 'req_w3_generation');
      const edited = await f.call('journal.upsert', {
        ...payload,
        weatherName: '合成编辑名称',
        expectedVersion: 1,
      });
      assert.equal(edited.data.entry.id, first.data.entry.id);
      assert.equal(edited.data.entry.version, 2);
      const deletion = await f.call('journal.delete', { date: payload.date, expectedVersion: 2 });
      assert.equal(deletion.data.deleted, true);
      assert.equal((await f.reader.getEntry(payload.date)).data.entry, null);
      assert.equal((await f.reader.calendar('2026-10')).data.recordCount, 0);
      assert.equal((await f.reader.monthArchive('2026-10')).data.recordCount, 0);
      for (const days of [7, 30, 90]) {
        const { timeline, distribution } = await f.reader.insights(days);
        assert.equal(timeline.data.recordCount, 0);
        assert.equal(timeline.data.sourceRevision, 3);
        assert.equal(timeline.data.trendEligible, false);
        assert.ok(distribution.data.bins.every((bin) => bin.count === 0));
      }
      const next = await f.call('journal.upsert', {
        date: payload.date,
        weather: 'SUNNY',
        expectedVersion: 0,
      });
      assert.notEqual(next.data.entry.id, first.data.entry.id);
      assert.equal(next.data.entry.version, 4);
      assert.equal(
        (await f.call('journal.upsert', payload, 'req_w3_generation')).error.code,
        'CONFLICT',
      );
      assert.equal((await f.reader.monthArchive('2026-10')).data.cards[0].id, next.data.entry.id);
      assert.doesNotMatch(
        JSON.stringify(await f.reader.insights(90)),
        /合成已删名称|合成编辑名称|deleted body/,
      );
      await db.runTransaction((tx) =>
        tx
          .collection('accounts')
          .doc('synthetic_w3_a')
          .update({ data: { status: 'disabled' } }),
      );
      const before = inspect();
      for (const [action, input] of [
        ['journal.get', { date: payload.date }],
        ['journal.upsert', payload],
        ['journal.delete', { date: payload.date, expectedVersion: 4 }],
        ['review.calendar', { month: '2026-10' }],
        ['review.monthArchive', { month: '2026-10' }],
        ['review.timeline', { windowDays: 90 }],
        ['review.distribution', { windowDays: 90 }],
      ]) {
        const result = await f.call(action, input, 'req_w3_generation');
        assert.equal(result.error.code, 'ACCOUNT_DISABLED', JSON.stringify(result));
        assert.doesNotMatch(JSON.stringify(result), /合成已删名称|deleted body|entryId|ownerId/);
      }
      assert.deepEqual(inspect(), before);
    },
    { nativeDatabase: true },
  );
});
