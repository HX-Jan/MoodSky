const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { inspectRun, idFor, persistRunReport, sanitizeReport } = require('../tools/h03-probe/suite');
const config = require('../tools/h03-probe/config');

const runId = 'h03_report_local_checks_001';
const caseIds = [
  'V01-commit',
  'V06-afterJournal',
  'V06-afterReceipt',
  'V02-journals',
  'V02-receipts',
  'V03-create',
  'V03-edit',
  'V03-edit-delete',
  'V04-same-input',
  'V04-response-loss',
  'V05-different-input',
  'V05-rejection-replay',
  'V07-boundary',
  'V07-old-edit',
  'V07-midnight',
  'V08-delete-recreate',
  'V08-empty-delete',
];
const clone = (value) => JSON.parse(JSON.stringify(value));
function caseResults(failed = false) {
  return caseIds.map((id, i) => ({
    id,
    passed: !(failed && i === 0),
    transactionCallbacks: 1,
    ...(failed && i === 0 ? { code: '-502005' } : {}),
    ...(['V02-journals', 'V02-receipts'].includes(id)
      ? { observedSdkCode: '-502001', errorMappingConfirmed: false }
      : {}),
  }));
}
function fixture(options = {}) {
  let manifest = options.absent
    ? null
    : {
        probeTag: config.probeTag,
        runId,
        status: options.status || 'running',
        ...(options.report !== undefined ? { report: options.report } : {}),
      };
  const updates = [];
  const db = {
    collection(name) {
      assert(Object.values(config.collections).includes(name));
      return {
        doc(id) {
          assert.equal(name, config.collections.accounts);
          assert.equal(id, idFor(runId, 'manifest'));
          return {
            async get() {
              return { data: clone(manifest) };
            },
            async update(value) {
              updates.push(clone(value));
              if (options.updateFailure) {
                throw new Error('synthetic-private-storage-failure');
              }
              manifest = { ...manifest, ...clone(value.data) };
            },
          };
        },
        where(filter) {
          assert.deepEqual(filter, { probeTag: config.probeTag, runId });
          return {
            async count() {
              return { total: options.count || 0 };
            },
          };
        },
      };
    },
  };
  return {
    db,
    ref: db.collection(config.collections.accounts).doc(idFor(runId, 'manifest')),
    updates,
    manifest: () => manifest,
  };
}

test('final success report and status are saved by one update and recovered without a direct run response', async () => {
  const f = fixture();
  const results = caseResults();
  results[0].text = 'synthetic-private-body';
  const report = await persistRunReport(f.ref, results, 17);
  assert.equal(f.updates.length, 1);
  assert.deepEqual(Object.keys(f.updates[0].data).sort(), ['report', 'status']);
  assert.equal(f.updates[0].data.status, 'completed');
  assert.equal(report.allAssertionsPassed, true);
  assert(!JSON.stringify(f.updates).includes('synthetic-private'));
  const recovered = await inspectRun(f.db, runId);
  assert.equal(recovered.reportAvailable, true);
  assert.equal(recovered.reportValidation, 'available');
  assert.deepEqual(recovered.report, report);
  assert.equal(f.updates.length, 1);
});

test('failed report preserves the failure and safe error evidence in the same final update', async () => {
  const f = fixture();
  const report = await persistRunReport(f.ref, caseResults(true), 17);
  assert.equal(f.updates.length, 1);
  assert.equal(f.manifest().status, 'failed');
  assert.equal(report.allAssertionsPassed, false);
  assert.equal(report.results[0].passed, false);
  assert.equal(report.results[0].code, '-502005');
  assert.equal(report.results[3].errorMappingConfirmed, false);
  assert.equal(report.productionJournalImplemented, false);
  assert.equal(report.technicalValidationComplete, false);
  assert.deepEqual((await inspectRun(f.db, runId)).report, report);
});

test('legacy, absent and interrupted batches have no invented report or read-side writes', async () => {
  for (const options of [
    { absent: true },
    { status: 'failed' },
    { status: 'completed' },
    { status: 'running' },
  ]) {
    const f = fixture(options);
    const result = await inspectRun(f.db, runId);
    assert.equal(result.reportAvailable, false);
    assert.equal(result.reportValidation, 'missing');
    assert.equal(result.report, null);
    assert.equal(f.updates.length, 0);
  }
});

test('report reads project only safe fields and cannot mutate the stored evidence', async () => {
  const saved = fixture();
  const report = await persistRunReport(saved.ref, caseResults(), 17);
  report.text = 'synthetic-private-body';
  report.operatorFingerprint = 'synthetic-private-identity';
  report.results[0].OPENID = 'synthetic-private-identity';
  const f = fixture({ status: 'completed', report });
  const result = await inspectRun(f.db, runId);
  assert.equal(result.reportAvailable, true);
  assert(!JSON.stringify(result).includes('synthetic-private'));
  result.report.results[0].passed = false;
  result.report.deferred[0] = 'changed';
  assert.equal(f.manifest().report.results[0].passed, true);
  assert.equal(f.manifest().report.deferred[0], 'V09');
  assert.equal(f.updates.length, 0);
});

test('oversized, duplicate, unknown, mistyped and inconsistent reports are withheld without leaking values', async () => {
  const seed = fixture();
  const original = await persistRunReport(seed.ref, caseResults(), 17);
  const mutations = [
    (r) => r.results.push(clone(r.results[0])),
    (r) => {
      r.results[1].id = r.results[0].id;
    },
    (r) => {
      r.results[0].id = 'synthetic-private-unknown-case';
    },
    (r) => {
      r.results[0].passed = 'true';
    },
    (r) => {
      r.results[0].transactionCallbacks = -1;
    },
    (r) => {
      r.results[0].code = 'https://synthetic-private-error';
    },
    (r) => {
      r.results[0].code = 'X'.repeat(65);
    },
    (r) => {
      r.results[3].errorMappingConfirmed = true;
    },
    (r) => {
      r.allAssertionsPassed = false;
    },
    (r) => {
      r.productionJournalImplemented = true;
    },
    (r) => {
      r.technicalValidationComplete = true;
    },
    (r) => {
      r.deferred.push('synthetic-private-extra');
    },
    (r) => {
      r.transactionCallbacks = 16;
    },
  ];
  for (const mutate of mutations) {
    const report = clone(original);
    mutate(report);
    const f = fixture({ status: 'completed', report });
    const result = await inspectRun(f.db, runId);
    assert.equal(result.reportAvailable, false);
    assert.equal(result.reportValidation, 'invalid');
    assert.equal(result.report, null);
    assert(!JSON.stringify(result).includes('synthetic-private'));
    assert.equal(f.updates.length, 0);
  }
});

test('report terminal state must match its assertions while closed cleanup markers retain historical reports', async () => {
  const seed = fixture();
  const report = await persistRunReport(seed.ref, caseResults(), 17);
  for (const status of ['running', 'failed']) {
    const result = await inspectRun(fixture({ status, report }).db, runId);
    assert.equal(result.reportAvailable, false);
    assert.equal(result.reportValidation, 'invalid');
  }
  for (const status of ['cleaning', 'cleaned']) {
    const f = fixture({ status, report });
    assert.equal((await inspectRun(f.db, runId)).reportAvailable, true);
    assert.equal(f.updates.length, 0);
  }
});

test('a failed final report save propagates without claiming completion or retrying writes', async () => {
  const f = fixture({ updateFailure: true });
  await assert.rejects(persistRunReport(f.ref, caseResults(), 17));
  assert.equal(f.updates.length, 1);
  assert.equal(f.manifest().status, 'running');
  assert.equal(f.manifest().report, undefined);
});

test('invalid generated reports are rejected before storage and unassigned callbacks are preserved', async () => {
  const f = fixture();
  await assert.rejects(persistRunReport(f.ref, caseResults().slice(1), 16));
  assert.equal(f.updates.length, 0);
  const report = await persistRunReport(f.ref, caseResults(), 18);
  assert.equal(report.transactionCallbacks, 18);
  assert.equal(
    report.results.reduce((sum, item) => sum + item.transactionCallbacks, 0),
    17,
  );
  assert(sanitizeReport(report));
});

test('locked wx SDK forwards the nested final report with status in one update and supports readback', async () => {
  const cloudRequire = createRequire(
    path.resolve(__dirname, '../cloudfunctions/moodsky/package.json'),
  );
  const cloud = cloudRequire('wx-server-sdk');
  cloud.init({ env: 'synthetic-report-sdk-boundary' });
  const db = cloud.database({ throwOnNotFound: false });
  let stored = { probeTag: config.probeTag, runId, status: 'running' };
  const updates = [];
  db._db.collection = (name) => {
    assert(Object.values(config.collections).includes(name));
    return {
      doc(id) {
        assert.equal(name, config.collections.accounts);
        assert.equal(id, idFor(runId, 'manifest'));
        return {
          async update(data) {
            assert.equal(data.data, undefined);
            assert.equal(typeof data.report, 'object');
            assert(Array.isArray(data.report.results));
            updates.push(clone(data));
            stored = { ...stored, ...clone(data) };
            return { updated: 1 };
          },
          async get() {
            return { data: [clone(stored)] };
          },
        };
      },
      where(filter) {
        assert.deepEqual(filter, { probeTag: config.probeTag, runId });
        return {
          async count() {
            return { total: 0 };
          },
        };
      },
    };
  };
  const report = await persistRunReport(
    db.collection(config.collections.accounts).doc(idFor(runId, 'manifest')),
    caseResults(true),
    17,
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'failed');
  assert.deepEqual(updates[0].report, report);
  assert.deepEqual((await inspectRun(db, runId)).report, report);
});
