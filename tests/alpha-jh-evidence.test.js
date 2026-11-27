const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertCampusResult,
  assertLifecycle,
} = require('../tools/alpha-jh/build-c3-regression.cjs');

test('campus evidence rejects a successful guest request instead of labelling it PASS', () => {
  assert.throws(() => assertCampusResult('unauth-campus.checkIn', { ok: true, data: {} }));
  assert.throws(() =>
    assertCampusResult('retired-write', { ok: false, error: { code: 'INTERNAL' } }),
  );
});

test('campus evidence rejects cross-account history and incorrect final-page pagination', () => {
  assert.throws(() =>
    assertCampusResult('b-history-empty', { ok: true, data: { items: [{}], total: 1 } }),
  );
  assert.throws(() =>
    assertCampusResult('history-page2', {
      ok: true,
      data: { items: [{}], total: 2, page: 2, hasMore: true },
    }),
  );
});

test('lifecycle evidence requires a completed worker and a precise permission refusal', () => {
  const result = {
    aExportCheckins: 1,
    aExportFields: ['completedAt', 'date', 'placeId'],
    bDownloadCode: 'FORBIDDEN',
    cleanupState: 'completed',
    aCheckinsAfter: 0,
    bCheckinsAfter: 1,
    placesBefore: 1,
    placesAfter: 1,
  };
  assert.throws(() => assertLifecycle({ ...result, cleanupState: 'processing' }));
  assert.throws(() => assertLifecycle({ ...result, bDownloadCode: 'INTERNAL' }));
  assert.doesNotThrow(() => assertLifecycle(result));
});
