const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createReviewService } = require('../cloudfunctions/moodsky/services/review');
const { fixture, error } = require('./helpers/backend-fixture');

test('backend review reads the journal source with correct order, counts and private projections', async () => {
  const f = fixture();
  await f.save({
    date: '2026-10-16',
    weather: 'RAINY',
    text: 'SYNTHETIC private 1',
    tags: ['REST'],
  });
  await f.save({ date: '2026-10-18', weather: 'SUNNY', text: 'SYNTHETIC private 2' });
  await f.save({ date: '2026-10-17', weather: 'SUNNY', text: 'SYNTHETIC private 3' });
  await f.save({ date: '2026-10-15', weather: 'CLOUDY' }, { actor: 'b' });
  const calendar = (await f.call('review.calendar', { month: '2026-10' })).data;
  const archive = (await f.call('review.monthArchive', { month: '2026-10' })).data;
  const timeline = (await f.call('review.timeline', { windowDays: 7 })).data;
  const distribution = (await f.call('review.distribution', { windowDays: 7 })).data;
  assert.deepEqual(
    calendar.entries.map((entry) => entry.date),
    ['2026-10-16', '2026-10-17', '2026-10-18'],
  );
  assert.deepEqual(archive.cards, [...calendar.entries].reverse());
  assert.deepEqual(timeline.items, archive.cards);
  assert.equal(timeline.startDate, '2026-10-12');
  assert.equal(timeline.endDate, '2026-10-18');
  assert.equal(timeline.trendEligible, true);
  assert.equal(archive.cardTextPreview, false);
  for (const view of [calendar, archive, timeline, distribution]) {
    assert.equal(view.recordCount, 3);
    assert.equal(view.sourceRevision, 3);
    assert.doesNotMatch(JSON.stringify(view), /SYNTHETIC private|ownerId|tags|text|synthetic_a/);
  }
  assert.equal(distribution.bins.length, 5);
  assert.equal(distribution.bins.find((bin) => bin.weather === 'SUNNY').count, 2);
  assert.equal(
    distribution.bins.reduce((sum, bin) => sum + bin.count, 0),
    3,
  );
  assert.equal(
    (await f.call('review.calendar', { month: '2026-10' }, { actor: 'b' })).data.recordCount,
    1,
  );
});

test('backend review reflects deletion and edits immediately without copying writing to a read model', async () => {
  const f = fixture();
  await f.save();
  const options = { id: 'req_backend_review_edit' };
  await f.save({ expectedVersion: 1, weather: 'STORMY', text: 'SYNTHETIC private' }, options);
  const edited = (await f.call('review.distribution', { windowDays: 7 })).data;
  assert.equal(edited.sourceRevision, 2);
  assert.equal(edited.bins.find((bin) => bin.weather === 'STORMY').count, 1);
  await f.save({ expectedVersion: 1, weather: 'STORMY', text: 'SYNTHETIC private' }, options);
  assert.equal((await f.call('review.timeline', { windowDays: 7 })).data.sourceRevision, 2);
  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 2 });
  for (const [action, payload] of [
    ['review.calendar', { month: '2026-10' }],
    ['review.monthArchive', { month: '2026-10' }],
    ['review.timeline', { windowDays: 7 }],
    ['review.distribution', { windowDays: 7 }],
  ]) {
    const result = await f.call(action, payload);
    assert.equal(result.data.recordCount, 0);
    assert.equal(result.data.sourceRevision, 3);
    assert.doesNotMatch(JSON.stringify(result), /STORMY.*count":1|SYNTHETIC private/);
  }
  assert.equal((await f.call('review.timeline', { windowDays: 7 })).data.trendEligible, false);
});

test('backend review empty and two-record windows do not produce trend conclusions', async () => {
  const f = fixture();
  const empty = (await f.call('review.distribution', { windowDays: 90 })).data;
  assert.equal(empty.recordCount, 0);
  assert.equal(empty.sourceRevision, 0);
  assert.ok(empty.bins.every((bin) => bin.count === 0));
  await f.save({ date: '2026-10-17' });
  await f.save();
  const timeline = (await f.call('review.timeline', { windowDays: 30 })).data;
  assert.equal(timeline.recordCount, 2);
  assert.equal(timeline.trendEligible, false);
  assert.doesNotMatch(JSON.stringify(timeline), /diagnosis|score|prediction|trendConclusion/);
});

test('backend review 7/30/90 windows include exact endpoints through leap February', async () => {
  const f = fixture();
  // Seed through ordinary writes on each synthetic business day, without bypassing validation.
  for (const date of [
    '2027-12-02',
    '2027-12-03',
    '2028-01-31',
    '2028-02-01',
    '2028-02-23',
    '2028-02-24',
    '2028-02-29',
    '2028-03-01',
    '2028-03-02',
  ]) {
    f.setClock(date + 'T00:00:00.000Z');
    assert.equal((await f.save({ date })).ok, true);
  }
  f.setClock('2028-03-01T01:00:00.000Z');
  const expected = { 7: ['2028-02-24', 3], 30: ['2028-02-01', 5], 90: ['2027-12-03', 7] };
  for (const windowDays of [7, 30, 90]) {
    const view = (await f.call('review.timeline', { windowDays })).data;
    assert.equal(view.startDate, expected[windowDays][0]);
    assert.equal(view.endDate, '2028-03-01');
    assert.equal(view.recordCount, expected[windowDays][1]);
    assert.equal(view.items[0].date, '2028-03-01');
    assert.equal(view.items.at(-1).date, expected[windowDays][0]);
  }
  const february = (await f.call('review.calendar', { month: '2028-02' })).data;
  assert.equal(february.entries.at(-1).date, '2028-02-29');
  assert.equal(february.recordCount, 4);
});

test('backend review validates all query fields, authentication and unimplemented decoration operations', async () => {
  const f = fixture();
  for (const month of ['2026-00', '2026-13', '2026-2', '2026-02-30', null, [], 202610]) {
    error(await f.call('review.calendar', { month }), 'INVALID_INPUT');
  }
  for (const windowDays of [0, '7', 8, 91, null, [], true]) {
    error(await f.call('review.timeline', { windowDays }), 'INVALID_INPUT');
  }
  error(await f.call('review.timeline', { windowDays: 7, endDate: '2026-11-01' }), 'INVALID_INPUT');
  error(await f.call('review.calendar', { month: '2026-10', now: '2026-11-01' }), 'INVALID_INPUT');
  error(await f.call('review.calendar', { month: '2026-10', ownerId: 'other' }), 'INVALID_REQUEST');
  error(
    await f.call('review.calendar', { month: '2026-10' }, { actor: 'disabled' }),
    'ACCOUNT_DISABLED',
  );
  error(
    await f.call('review.decorations', { operation: 'get', month: '2026-10' }),
    'NOT_IMPLEMENTED',
  );
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
});

test('backend review requires one bounded consistent snapshot and strips unexpected private fields', async () => {
  const calls = [];
  const service = createReviewService({
    now: () => new Date('2026-10-17T16:00:00.000Z'),
    repository: {
      async readSnapshot(ownerId, range) {
        calls.push({ ownerId, range });
        return {
          revision: 42,
          entries: [
            {
              id: 'synthetic_entry',
              date: '2026-10-18',
              weather: 'SUNNY',
              text: 'SYNTHETIC secret',
              ownerId,
              tags: ['REST'],
            },
          ],
        };
      },
    },
  });
  const result = await service({
    action: 'review.timeline',
    payload: { windowDays: 7 },
    actor: { accountId: 'synthetic_a' },
  });
  assert.deepEqual(calls, [
    { ownerId: 'synthetic_a', range: { startDate: '2026-10-12', endDate: '2026-10-18' } },
  ]);
  assert.equal(result.sourceRevision, 42);
  assert.deepEqual(result.items, [{ id: 'synthetic_entry', date: '2026-10-18', weather: 'SUNNY' }]);
});

test('backend review rejects corrupt, duplicate and out-of-range snapshots rather than misleading counts', async () => {
  const mark = { id: 'synthetic_entry', date: '2026-10-18', weather: 'SUNNY' };
  const snapshots = [
    null,
    { revision: -1, entries: [] },
    { revision: 0.5, entries: [] },
    { revision: 1, entries: null },
    { revision: 1, entries: [mark, { ...mark, id: 'another' }] },
    { revision: 1, entries: [mark, { ...mark, date: '2026-10-17' }] },
    ...[
      null,
      { ...mark, date: '2026-02-30' },
      { ...mark, date: '2026-11-01' },
      { ...mark, weather: 'TYPHOON' },
      { ...mark, id: '' },
      { ...mark, id: 'SYNTHETIC private text in an invalid ID' },
      { ...mark, id: 'x'.repeat(129) },
    ].map((entry) => ({ revision: 1, entries: [entry] })),
  ];
  for (const snapshot of snapshots) {
    const router = createRouter({
      journalRepository: { readSnapshot: async () => snapshot },
      resolveAccount: async () => ({ id: 'synthetic_a', status: 'active' }),
    });
    const result = await router(
      {
        apiVersion: '1',
        requestId: 'req_bad_snapshot',
        action: 'review.calendar',
        payload: { month: '2026-10' },
      },
      { OPENID: 'a' },
    );
    error(result, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(result), /synthetic_entry|Invalid journal snapshot/);
  }
});
