const test = require('node:test');
const assert = require('node:assert/strict');
const { formatExport } = require('../tools/export-candidate/formatter');
const { syntheticSnapshot } = require('../tools/export-candidate/fixture');
const ownerId = 'synthetic_export_owner';
const options = {
  accountId: ownerId,
  exportedAt: '2026-11-05T00:00:00.000Z',
  maxRecords: 100,
  maxBytes: 1048576,
  format: 'json',
};
const visit = (extra = {}) => ({
  ownerId,
  placeId: 'fzu-qishan-fuyou-pavilion',
  date: '2026-11-05',
  completedAt: '2026-11-04T16:00:00.000Z',
  ...extra,
});
const legacyVisit = (extra = {}) => visit({ placeName: '福友阁', selfReported: true, ...extra });
const document = (snapshot, extra = {}) =>
  JSON.parse(formatExport(snapshot, { ...options, ...extra }).content);

test('checkin export accepts Beijing midnight and retains existing minimal JSON shape', () => {
  const snapshot = syntheticSnapshot();
  snapshot.checkins = [visit()];
  assert.deepEqual(document(snapshot).data.checkins, [
    {
      placeId: 'fzu-qishan-fuyou-pavilion',
      date: '2026-11-05',
      completedAt: '2026-11-04T16:00:00.000Z',
    },
  ]);
});

test('checkin export rejects duplicate days, impossible dates and inconsistent completion times', () => {
  for (const rows of [
    [visit(), visit()],
    [visit({ date: '2026-02-30' })],
    [visit({ completedAt: '2026-11-04T15:59:59.999Z' })],
    [visit({ completedAt: 'not-a-time' })],
  ]) {
    const snapshot = syntheticSnapshot();
    snapshot.checkins = rows;
    assert.throws(() => document(snapshot), { code: 'INVALID_INPUT' });
  }
});

test('legacy checkin snapshot exports names and self-reported status without leaking internals', () => {
  const snapshot = syntheticSnapshot();
  snapshot.campusCheckins = [
    legacyVisit({ requestId: 'SYNTHETIC_SECRET', internalNote: 'SYNTHETIC_SECRET' }),
  ];
  const original = JSON.stringify(snapshot);
  const output = document(snapshot);
  assert.deepEqual(output.data.checkins, [
    {
      placeId: 'fzu-qishan-fuyou-pavilion',
      date: '2026-11-05',
      completedAt: '2026-11-04T16:00:00.000Z',
      placeName: '福友阁',
      selfReported: true,
    },
  ]);
  assert.equal(output.data.campusCheckins, undefined);
  assert.doesNotMatch(JSON.stringify(output), /ownerId|SYNTHETIC_SECRET|requests/);
  assert.equal(JSON.stringify(snapshot), original);
  const markdown = formatExport(snapshot, { ...options, format: 'markdown' }).content;
  assert.match(markdown, /地点打卡（1 条）/);
  assert.match(markdown, /福友阁/);
  assert.match(markdown, /用户自报完成/);
});

test('overlapping checkin sources retain one matching visit and preserve legacy metadata', () => {
  const snapshot = syntheticSnapshot();
  snapshot.checkins = [visit({ completedAt: '2026-11-04T16:00:00Z' })];
  snapshot.campusCheckins = [legacyVisit()];
  assert.deepEqual(
    document(snapshot).data.checkins,
    document({
      ...snapshot,
      checkins: undefined,
    }).data.checkins,
  );
});

test('different checkin sources cannot silently choose between contradictory completion times', () => {
  const snapshot = syntheticSnapshot();
  snapshot.checkins = [visit()];
  snapshot.campusCheckins = [legacyVisit({ completedAt: '2026-11-04T16:01:00Z' })];
  assert.throws(() => document(snapshot), { code: 'CONFLICT' });
});

test('legacy checkin rows retain owner, shape and date checks rather than treating bad data as empty', () => {
  for (const [rows, code] of [
    [[legacyVisit({ ownerId: 'synthetic_other' })], 'FORBIDDEN'],
    [[legacyVisit({ ownerId: undefined })], 'FORBIDDEN'],
    [[legacyVisit({ selfReported: false })], 'INVALID_INPUT'],
    [[legacyVisit({ placeName: undefined })], 'INVALID_INPUT'],
    [[legacyVisit({ completedAt: '2026-11-04T15:59:59Z' })], 'INVALID_INPUT'],
    [[legacyVisit(), legacyVisit()], 'INVALID_INPUT'],
    [null, 'INVALID_INPUT'],
    [{}, 'INVALID_INPUT'],
  ]) {
    const snapshot = syntheticSnapshot();
    snapshot.campusCheckins = rows;
    assert.throws(() => document(snapshot), { code });
  }
});

test('combined checkin export is ordered and bounded without truncating either source', () => {
  const snapshot = syntheticSnapshot();
  snapshot.checkins = [visit()];
  snapshot.campusCheckins = [
    legacyVisit({ placeId: 'fzu-qishan-wangshu-lake' }),
    legacyVisit({ date: '2026-11-04', completedAt: '2026-11-04T00:00:00Z' }),
  ];
  assert.deepEqual(
    document(snapshot).data.checkins.map((row) => [row.date, row.placeId]),
    [
      ['2026-11-04', 'fzu-qishan-fuyou-pavilion'],
      ['2026-11-05', 'fzu-qishan-fuyou-pavilion'],
      ['2026-11-05', 'fzu-qishan-wangshu-lake'],
    ],
  );
  // The fixture has three journals, so four unique visits exceed only the combined limit.
  snapshot.campusCheckins.push(legacyVisit({ placeId: 'fzu-qishan-guangcai-cafe' }));
  assert.throws(() => document(snapshot, { maxRecords: 3 }), { code: 'INVALID_INPUT' });
});

test('checkin export keeps absent and explicit empty sources distinct and escapes legacy names', () => {
  const snapshot = syntheticSnapshot();
  assert.equal(document(snapshot).data.checkins, undefined);
  snapshot.campusCheckins = [];
  assert.deepEqual(document(snapshot).data.checkins, []);
  snapshot.campusCheckins = [legacyVisit({ placeName: '<img src=x>\n# injected' })];
  const markdown = formatExport(snapshot, { ...options, format: 'markdown' }).content;
  assert.match(markdown, /&lt;img src=x&gt;/);
  assert.doesNotMatch(markdown, /<img|\n# injected/);
});
