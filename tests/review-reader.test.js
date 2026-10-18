const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createReviewReader,
  validateReviewData,
  reviewErrorMessage,
} = require('../miniprogram/modules/review/reader');
const { backendClient } = require('./helpers/backend-client');
const invalid = (fn) => assert.throws(fn, { code: 'INVALID_RESPONSE' });
const mark = { id: 'synthetic_mark', date: '2026-10-18', weather: 'SUNNY' };
const meta = { sourceRevision: 1, recordCount: 1 };
const range = { startDate: '2026-10-12', endDate: '2026-10-18', windowDays: 7 };

test('review reader rejects malformed counts, identities, dates, order and preview defaults', () => {
  const valid = { month: '2026-10', ...meta, entries: [mark] };
  for (const change of [
    { sourceRevision: -1 },
    { sourceRevision: 1.2 },
    { recordCount: 0 },
    { recordCount: 32 },
    { month: '2026-09' },
    { entries: null },
    { entries: [{ ...mark, id: '' }] },
    { entries: [{ ...mark, date: '2026-11-01' }] },
    { entries: [{ ...mark, weather: 'TYPHOON' }] },
    { recordCount: 2, entries: [mark, { ...mark, date: '2026-10-19' }] },
    { recordCount: 2, entries: [mark, { ...mark, id: 'synthetic_2', date: '2026-10-17' }] },
  ]) {
    invalid(() => validateReviewData('calendar', '2026-10', { ...valid, ...change }));
  }
  for (const cardTextPreview of [true, undefined, 'false']) {
    invalid(() =>
      validateReviewData('monthArchive', '2026-10', {
        ...meta,
        month: '2026-10',
        cards: [mark],
        cardTextPreview,
      }),
    );
  }
});

test('review reader strips unexpected private fields before returning card/mark data', () => {
  const result = validateReviewData('monthArchive', '2026-10', {
    month: '2026-10',
    ...meta,
    cardTextPreview: false,
    text: 'SYNTHETIC top private',
    cards: [{ ...mark, ownerId: 'synthetic_owner', text: 'SYNTHETIC private', tags: ['REST'] }],
  });
  assert.deepEqual(result.cards, [mark]);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|ownerId|tags|REST/);
});

test('review reader enforces window span, bin totals and truthful trend eligibility', () => {
  const valid = { ...meta, ...range, items: [mark], trendEligible: false };
  for (const change of [
    { windowDays: 30 },
    { startDate: '2026-10-11' },
    { endDate: '2026-02-30' },
    { trendEligible: true },
    { recordCount: 8 },
  ]) {
    invalid(() => validateReviewData('timeline', 7, { ...valid, ...change }));
  }
  const bins = ['SUNNY', 'PARTLY_CLOUDY', 'CLOUDY', 'RAINY', 'STORMY'].map((weather) => ({
    weather,
    count: weather === 'SUNNY' ? 1 : 0,
  }));
  const dist = { ...meta, ...range, bins };
  for (const changedBins of [
    bins.slice(1),
    [...bins.slice(1), bins[1]],
    bins.map((bin) => ({ ...bin, count: 0 })),
    bins.map((bin) => ({ ...bin, count: -1 })),
  ]) {
    invalid(() => validateReviewData('distribution', 7, { ...dist, bins: changedBins }));
  }
});

test('review insights uses one validated timeline for both views without a second request', async () => {
  const f = backendClient();
  await f.save();
  const line = await f.review.timeline(7);
  let calls = 0;
  const reader = createReviewReader({
    review: {
      distribution: async () => {
        throw new Error('A second read would race the first snapshot');
      },
      timeline: async (days) => {
        calls++;
        assert.equal(days, 7);
        return line;
      },
    },
  });
  const result = await reader.insights(7);
  assert.equal(calls, 1);
  assert.equal(result.distribution.data.sourceRevision, result.timeline.data.sourceRevision);
  assert.deepEqual(
    result.distribution.data.bins.map((bin) => bin.count),
    [1, 0, 0, 0, 0],
  );
  assert.equal(result.distribution.data.recordCount, 1);
  assert.equal(Object.hasOwn(result.distribution.data, 'items'), false);
});

test('single-read insights handles empty data and rejects malformed timelines without fallback', async () => {
  for (const valid of [true, false]) {
    let reads = 0;
    const reader = createReviewReader({
      review: {
        timeline: async () => {
          reads++;
          return {
            ok: true,
            data: { ...range, sourceRevision: 7, recordCount: 0, items: [], trendEligible: !valid },
          };
        },
      },
    });
    if (valid) {
      const { distribution } = await reader.insights(7);
      assert.equal(distribution.data.bins.length, 5);
      assert.ok(distribution.data.bins.every((bin) => bin.count === 0));
    } else {
      await assert.rejects(reader.insights(7), { code: 'INVALID_RESPONSE' });
    }
    assert.equal(reads, 1);
  }
});

test('review reader never displays untrusted error text or unchecked journal body', async () => {
  assert.equal(
    reviewErrorMessage({ code: 'unknown', message: 'SYNTHETIC private platform error' }),
    '暂时无法读取，请稍后再试。',
  );
  assert.equal(
    reviewErrorMessage({ code: 'ACCOUNT_DISABLED', message: 'SYNTHETIC secret' }),
    '账号已停用，当前不展示私人记录。',
  );
  const reader = createReviewReader({
    journal: {
      get: async () => ({
        ok: true,
        data: { entry: { ...mark, text: 'SYNTHETIC invalid detail' } },
      }),
    },
  });
  await assert.rejects(reader.getEntry(mark.date), { code: 'INVALID_RESPONSE' });
});
