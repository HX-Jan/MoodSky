const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCandidateRequest,
  buildReviewPreview,
} = require('../tools/week1-contracts/reference');
const h04 = require('../docs/week1/xiang-hong/w1-h04-examples.json');
const h02 = require('../docs/week1/xiang-hong/w1-h02-examples.json');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { readEntry } = require('../miniprogram/modules/journal/controller');
const { businessDate } = require('../miniprogram/shared/date');
const request = (action, payload) => ({
  apiVersion: '1',
  requestId: 'req_w1_contract_001',
  action,
  payload,
});
const fixture = () => ({
  synthetic: true,
  actorId: 'synthetic_h04_a',
  today: businessDate(new Date(h04.serverClock)),
  sourceRevision: h04.sourceRevision,
  records: h04.sourceRecords,
});
const rejects = (fn, code = 'INVALID_INPUT') => assert.throws(fn, (error) => error.code === code);

test('H04 historical examples retain their values with zero-count bins for the two newly supported categories', () => {
  for (const example of [...h04.examples, ...h04.emptyExamples]) {
    validateCandidateRequest(example.request);
    const f = fixture();
    if (example.fixture === 'separate-empty-account') {
      f.actorId = 'synthetic_empty';
    }
    if (example.fixture === 'separate-two-record-account') {
      f.records = f.records.filter((row) => row.date >= '2026-10-12');
    }
    if (['replace', 'reset'].includes(example.request.payload.operation)) {
      rejects(() => buildReviewPreview(example.request, f), 'NOT_IMPLEMENTED');
    } else {
      const expected = globalThis.structuredClone(example.expected.data);
      if (example.request.action === 'review.distribution') {
        expected.bins.push({ weather: 'TYPHOON', count: 0 }, { weather: 'CUSTOM', count: 0 });
      }
      assert.deepEqual(buildReviewPreview(example.request, f), expected, example.name);
    }
  }
});

test('H04 month inputs reject impossible months and unagreed fields', () => {
  for (const month of ['2026-00', '2026-13', '2026-2', '26-02', null, [], 202610]) {
    rejects(() => validateCandidateRequest(request('review.calendar', { month })));
  }
  for (const extra of [{ now: '2026-10-15' }, { startDate: '2026-10-01' }, { uid: 'other' }]) {
    rejects(() =>
      validateCandidateRequest(request('review.monthArchive', { month: '2026-10', ...extra })),
    );
  }
});

test('H04 accepts only numeric supported windows and rejects client-controlled bounds', () => {
  for (const windowDays of ['7', 0, 8, null, [], true]) {
    rejects(() => validateCandidateRequest(request('review.timeline', { windowDays })));
  }
  rejects(() =>
    validateCandidateRequest(
      request('review.distribution', { windowDays: 7, endDate: '2026-10-30' }),
    ),
  );
  rejects(
    () =>
      validateCandidateRequest(request('review.calendar', { month: '2026-10', ownerId: 'other' })),
    'INVALID_REQUEST',
  );
});

test('H04 7/30/90 windows include their exact boundaries across leap February', () => {
  const f = {
    ...fixture(),
    today: '2028-03-01',
    records: [
      {
        id: 'synthetic_before',
        ownerId: 'synthetic_h04_a',
        date: '2027-12-02',
        weather: 'CLOUDY',
        state: 'active',
      },
      {
        id: 'synthetic_90',
        ownerId: 'synthetic_h04_a',
        date: '2027-12-03',
        weather: 'STORMY',
        state: 'active',
      },
      {
        id: 'synthetic_30',
        ownerId: 'synthetic_h04_a',
        date: '2028-02-01',
        weather: 'PARTLY_CLOUDY',
        state: 'active',
      },
      {
        id: 'synthetic_7',
        ownerId: 'synthetic_h04_a',
        date: '2028-02-24',
        weather: 'SUNNY',
        state: 'active',
      },
      {
        id: 'synthetic_leap',
        ownerId: 'synthetic_h04_a',
        date: '2028-02-29',
        weather: 'RAINY',
        state: 'active',
      },
      {
        id: 'synthetic_today',
        ownerId: 'synthetic_h04_a',
        date: '2028-03-01',
        weather: 'SUNNY',
        state: 'active',
      },
      {
        id: 'synthetic_future',
        ownerId: 'synthetic_h04_a',
        date: '2028-03-02',
        weather: 'STORMY',
        state: 'active',
      },
    ],
  };
  for (const [windowDays, startDate, count] of [
    [7, '2028-02-24', 3],
    [30, '2028-02-01', 4],
    [90, '2027-12-03', 5],
  ]) {
    const result = buildReviewPreview(request('review.timeline', { windowDays }), f);
    assert.equal(result.startDate, startDate);
    assert.equal(result.endDate, '2028-03-01');
    assert.equal(result.recordCount, count);
    assert.equal(result.items.at(-1).date, startDate);
  }
  const february = buildReviewPreview(request('review.calendar', { month: '2028-02' }), f);
  assert.equal(february.entries.at(-1).date, '2028-02-29');
  assert.equal(
    buildReviewPreview(request('review.calendar', { month: '2028-04' }), f).recordCount,
    0,
  );
});

test('H04 zero, two and three records preserve denominator and trend eligibility', () => {
  for (const count of [0, 2, 3]) {
    const f = fixture();
    f.records = f.records
      .filter(
        (row) => row.ownerId === f.actorId && row.state === 'active' && row.date >= '2026-10-09',
      )
      .slice(0, count);
    const distribution = buildReviewPreview(request('review.distribution', { windowDays: 7 }), f);
    const timeline = buildReviewPreview(request('review.timeline', { windowDays: 7 }), f);
    assert.equal(distribution.recordCount, count);
    assert.equal(distribution.bins.length, 7);
    assert.equal(
      distribution.bins.reduce((n, bin) => n + bin.count, 0),
      count,
    );
    assert.equal(timeline.trendEligible, count >= 3);
    assert.equal(Object.prototype.hasOwnProperty.call(timeline, 'trendConclusion'), false);
  }
});

test('H04 views exclude deleted/foreign rows and never project body or identity', () => {
  const f = fixture();
  const before = JSON.stringify(f);
  for (const [action, payload] of [
    ['review.calendar', { month: '2026-10' }],
    ['review.monthArchive', { month: '2026-10' }],
    ['review.distribution', { windowDays: 7 }],
    ['review.timeline', { windowDays: 7 }],
  ]) {
    const result = buildReviewPreview(request(action, payload), f);
    assert.equal(result.recordCount, 3);
    assert.doesNotMatch(
      JSON.stringify(result),
      /ownerId|openid|text|合成|synthetic_h04_other|synthetic_h04_deleted/,
    );
    for (const mark of result.entries || result.cards || result.items || []) {
      assert.deepEqual(Object.keys(mark).sort(), ['date', 'id', 'weather']);
    }
  }
  assert.equal(JSON.stringify(f), before);
});

test('H04 refuses duplicate active dates or identities instead of silently selecting a winner', () => {
  for (const duplicate of [{ id: 'synthetic_duplicate' }, { date: '2026-10-10' }]) {
    const f = fixture();
    f.records = [...f.records, { ...f.records[0], ...duplicate }];
    assert.throws(
      () => buildReviewPreview(request('review.calendar', { month: '2026-10' }), f),
      TypeError,
    );
  }
});

test('H04 cannot infer a clock, identity or revision for a missing fixture', () => {
  const r = request('review.calendar', { month: '2026-10' });
  for (const replacement of [
    { synthetic: false },
    { actorId: 'real_account' },
    { today: undefined },
    { sourceRevision: -1 },
    { sourceRevision: undefined },
    { sourceRevision: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => buildReviewPreview(r, { ...fixture(), ...replacement }), TypeError);
  }
});

test('H02 proposed read/delete controls reject identity fields, invalid dates and unsafe versions', () => {
  assert.deepEqual(validateCandidateRequest(request('journal.get', { date: '2025-01-01' })), {
    date: '2025-01-01',
  });
  for (const date of ['2026-02-29', '2026-10-32', null]) {
    rejects(() => validateCandidateRequest(request('journal.get', { date })));
  }
  for (const expectedVersion of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    rejects(() =>
      validateCandidateRequest(request('journal.delete', { date: '2026-10-16', expectedVersion })),
    );
  }
  rejects(
    () =>
      validateCandidateRequest(
        request('journal.get', { date: '2026-10-16', role: 'data_operator' }),
      ),
    'INVALID_REQUEST',
  );
  rejects(() =>
    validateCandidateRequest(request('journal.get', { date: '2026-10-16', uid: 'other' })),
  );
});

test('H04 decoration draft validates shapes but never performs a mutation', () => {
  const f = fixture();
  const before = JSON.stringify(f);
  const replace = {
    operation: 'replace',
    month: '2026-10',
    expectedVersion: 0,
    stickers: [{ stickerId: 'SYNTHETIC_STICKER_A' }],
    backgroundId: null,
  };
  assert.deepEqual(validateCandidateRequest(request('review.decorations', replace)), replace);
  rejects(() => buildReviewPreview(request('review.decorations', replace), f), 'NOT_IMPLEMENTED');
  for (const input of [
    { ...replace, stickers: [...replace.stickers, ...replace.stickers] },
    { ...replace, backgroundId: 'https://example.invalid/image' },
    { ...replace, stickers: [{ stickerId: 'SYNTHETIC_A', x: 2 }] },
    { ...replace, expectedVersion: -1 },
  ]) {
    rejects(() => validateCandidateRequest(request('review.decorations', input)));
  }
  assert.equal(JSON.stringify(f), before);
});

test('H02 six dated scenarios execute against the existing memory adapter and preserve requests', async () => {
  for (const sample of h02.cases) {
    const service = createMemoryJournalService({
      now: () => new Date(h02.serverClock),
      seedEntries: sample.seedEntries,
    });
    const before = JSON.stringify(sample.request);
    validateCandidateRequest(sample.request);
    if (sample.expected.errorCode) {
      await assert.rejects(
        service.submit(sample.request),
        (error) => error.code === sample.expected.errorCode,
        sample.id,
      );
    } else {
      const result = await service.submit(sample.request);
      const entry = readEntry(result, sample.request.payload.date);
      assert.equal(entry.version, sample.expected.entryVersion, sample.id);
      assert.equal(entry.weather, sample.request.payload.weather);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'ownerId'), false);
    }
    assert.equal(JSON.stringify(sample.request), before);
  }
});
