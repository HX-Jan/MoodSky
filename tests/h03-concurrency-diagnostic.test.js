const test = require('node:test');
const assert = require('node:assert/strict');
const {
  settleOperations,
  createHarness,
  safeCode,
  sanitizeReport,
  persistRunReport,
  inspectRun,
} = require('../tools/h03-probe/suite');
const config = require('../tools/h03-probe/config');
const runId = 'h03_diag_local_checks_001';
const save = (requestId = 'req_diag_save_001') => ({
  apiVersion: '1',
  requestId,
  action: 'journal.upsert',
  payload: { date: '2026-10-14', weather: 'SUNNY', expectedVersion: 0 },
});
const removal = {
  apiVersion: '1',
  requestId: 'req_diag_delete_001',
  action: 'journal.delete',
  payload: { date: '2026-10-14', expectedVersion: 1 },
};
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('concurrency collector preserves successful input order', async () => {
  const a = deferred();
  const b = deferred();
  const result = settleOperations([a.promise, b.promise]);
  b.resolve('second');
  a.resolve('first');
  assert.deepEqual(await result, ['first', 'second']);
});
test('failed concurrent operation waits for its sibling before returning the original error', async () => {
  const a = deferred();
  const b = deferred();
  const failure = Object.freeze({ errCode: -501001, message: 'synthetic-private-error' });
  let finished = false;
  const result = settleOperations([a.promise, b.promise]).then(
    () => ({ unexpectedSuccess: true }),
    (error) => {
      finished = true;
      return { error };
    },
  );
  a.reject(failure);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finished, false);
  b.resolve('sibling-finished');
  assert.equal((await result).error, failure);
  assert.equal(finished, true);
});
test('collector waits for both rejections and keeps the first observed rejection', async () => {
  const a = deferred();
  const b = deferred();
  const first = Object.freeze({ errCode: -501001 });
  const second = Object.freeze({ code: 'SYNTHETIC_LATER_ERROR' });
  let finished = false;
  const result = settleOperations([a.promise, b.promise]).catch((error) => {
    finished = true;
    return { error };
  });
  b.reject(first);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finished, false);
  a.reject(second);
  assert.equal((await result).error, first);
});
test('null and undefined rejections remain failures after both branches settle', async () => {
  for (const reason of [null, undefined]) {
    let caught = false;
    try {
      await settleOperations([Promise.reject(reason), Promise.resolve('finished')]);
    } catch (error) {
      caught = true;
      assert.equal(error, reason);
    }
    assert.equal(caught, true);
  }
});

function fixture() {
  const tables = {};
  const writes = [];
  const state = {
    failAt: null,
    error: Object.freeze({ errCode: -501001, message: 'synthetic-private-error' }),
    transactions: 0,
  };
  const table = (name) => tables[name] || (tables[name] = new Map());
  const stop = (operation) => {
    if (state.failAt === operation) {
      throw state.error;
    }
  };
  const collection = (name) => {
    assert(Object.values(config.collections).includes(name));
    const role = Object.entries(config.collections).find(([, value]) => value === name)[0];
    return {
      async add({ data }) {
        table(name).set(data._id, { ...data });
        writes.push('actor-create');
        return { _id: data._id };
      },
      doc(id) {
        return {
          async get() {
            stop(
              role === 'accounts'
                ? 'account-read'
                : role === 'receipts'
                  ? 'receipt-read'
                  : 'journal-read',
            );
            return { data: table(name).get(id) || null };
          },
          async set({ data }) {
            const operation =
              role === 'journals'
                ? 'journal-write'
                : role === 'receipts'
                  ? 'receipt-write'
                  : 'deletion-marker-write';
            stop(operation);
            writes.push(operation);
            table(name).set(id, { ...data });
            return { stats: { updated: 1 } };
          },
          async update({ data }) {
            const operation =
              role === 'journals'
                ? 'journal-write'
                : Object.prototype.hasOwnProperty.call(data, 'operationFence')
                  ? 'account-fence'
                  : 'revision-write';
            stop(operation);
            writes.push(operation);
            const current = { ...table(name).get(id) };
            for (const [key, value] of Object.entries(data)) {
              if (value && value.operator === 'remove') {
                delete current[key];
              } else {
                current[key] = value;
              }
            }
            table(name).set(id, current);
            return { stats: { updated: 1 } };
          },
        };
      },
    };
  };
  const db = {
    collection,
    command: { remove: () => ({ operator: 'remove' }) },
    async runTransaction(callback, retries) {
      assert.equal(retries, 2);
      state.transactions++;
      stop('transaction-start');
      const result = await callback({ collection });
      stop('transaction-finish');
      return result;
    },
  };
  return { db, state, writes };
}
test('last-operation evidence identifies entered boundaries without mutating or remapping errors', async () => {
  for (const operation of [
    'account-read',
    'receipt-read',
    'journal-read',
    'account-fence',
    'journal-write',
    'revision-write',
    'receipt-write',
  ]) {
    const f = fixture();
    const harness = createHarness(f.db, runId);
    const actor = await harness.actor('phase-' + operation);
    f.state.failAt = operation;
    const originalKeys = Object.keys(f.state.error);
    await assert.rejects(harness.mutate(actor, save()), (error) => error === f.state.error);
    assert.equal(harness.lastOperationFor(f.state.error), operation);
    assert.equal(safeCode(f.state.error), '-501001');
    assert.deepEqual(Object.keys(f.state.error), originalKeys);
    assert.equal(f.state.transactions, 1);
  }
});
test('a reused error object with conflicting observations withholds an ambiguous operation label', async () => {
  const f = fixture();
  const harness = createHarness(f.db, runId);
  const actor = await harness.actor('reused-error');
  for (const operation of ['account-read', 'account-fence', 'receipt-read']) {
    f.state.failAt = operation;
    await assert.rejects(harness.mutate(actor, save()), (error) => error === f.state.error);
    assert.equal(
      harness.lastOperationFor(f.state.error),
      operation === 'account-read' ? 'account-read' : undefined,
    );
  }
});

test('deletion-marker boundary is recorded while the original failure is retained', async () => {
  const f = fixture();
  const harness = createHarness(f.db, runId);
  const actor = await harness.actor('delete-phase');
  await harness.mutate(actor, save());
  f.state.failAt = 'deletion-marker-write';
  await assert.rejects(harness.mutate(actor, removal), (error) => error === f.state.error);
  assert.equal(harness.lastOperationFor(f.state.error), 'deletion-marker-write');
});
test('transaction start and completion errors share an explicitly ambiguous transaction label', async () => {
  for (const operation of ['transaction-start', 'transaction-finish']) {
    const f = fixture();
    const harness = createHarness(f.db, runId);
    const actor = await harness.actor(operation);
    f.state.failAt = operation;
    await assert.rejects(harness.mutate(actor, save()), (error) => error === f.state.error);
    assert.equal(harness.lastOperationFor(f.state.error), 'transaction');
  }
});
test('success retains the original outcome and write sequence; simulated response loss is marked post-commit', async () => {
  const f = fixture();
  const harness = createHarness(f.db, runId);
  const actor = await harness.actor('success');
  const result = await harness.mutate(actor, save());
  assert(result.ok && result.version === 1);
  assert.equal(result.lastOperation, undefined);
  assert.deepEqual(f.writes, [
    'actor-create',
    'account-fence',
    'journal-write',
    'revision-write',
    'receipt-write',
  ]);
  let failure;
  try {
    await harness.mutate(actor, save(), { failAt: 'afterCommit' });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.code, 'H03_SIMULATED_RESPONSE_LOSS');
  assert.equal(harness.lastOperationFor(failure), 'post-commit');
});
test('invalid input is labelled before transactions and primitive errors do not acquire fabricated labels', async () => {
  const f = fixture();
  const harness = createHarness(f.db, runId);
  const actor = await harness.actor('input');
  let failure;
  try {
    await harness.mutate(actor, {
      ...save(),
      payload: { ...save().payload, ownerId: 'synthetic-forged' },
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(harness.lastOperationFor(failure), 'input-validation');
  assert.equal(f.state.transactions, 0);
  for (const reason of [null, undefined, 'synthetic-private-primitive']) {
    assert.equal(harness.lastOperationFor(reason), undefined);
  }
});

const ids = [
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
const results = () =>
  ids.map((id, index) => ({
    id,
    passed: index !== 5,
    transactionCallbacks: 1,
    ...(index === 5 ? { code: '-501001', lastOperation: 'account-fence' } : {}),
  }));
function reportFixture(savedReport) {
  let manifest = {
    probeTag: config.probeTag,
    runId,
    status: 'failed',
    ...(savedReport === undefined ? {} : { report: savedReport }),
  };
  const updates = [];
  const ref = {
    async get() {
      return { data: manifest };
    },
    async update({ data }) {
      updates.push(data);
      manifest = { ...manifest, ...data };
    },
  };
  const db = {
    collection(name) {
      assert(Object.values(config.collections).includes(name));
      return {
        doc() {
          return ref;
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
    },
  };
  return { db, ref, updates };
}
test('bounded last-operation labels persist with failures and are returned by a read without raw error values', async () => {
  const f = reportFixture();
  const rows = results();
  rows[5].errMsg = 'synthetic-private-error';
  rows[5].OPENID = 'synthetic-private-identity';
  const report = await persistRunReport(f.ref, rows, 17);
  assert.equal(report.results[5].lastOperation, 'account-fence');
  assert.equal(report.results[5].code, '-501001');
  assert.equal(f.updates.length, 1);
  assert.equal(f.updates[0].status, 'failed');
  const inspect = await inspectRun(f.db, runId);
  assert.equal(inspect.reportAvailable, true);
  assert.deepEqual(inspect.report, report);
  assert(!JSON.stringify(inspect).includes('synthetic-private'));
  assert.equal(f.updates.length, 1);
});
test('unknown or mistyped operation labels and success-labelled diagnostics invalidate reports', async () => {
  const f = reportFixture();
  const seed = await persistRunReport(f.ref, results(), 17);
  for (const value of ['synthetic-private-label', 'X'.repeat(200), [], {}, null, 42]) {
    const report = JSON.parse(JSON.stringify(seed));
    report.results[5].lastOperation = value;
    assert.equal(sanitizeReport(report), null);
    const inspect = await inspectRun(reportFixture(report).db, runId);
    assert.equal(inspect.reportValidation, 'invalid');
    assert.equal(inspect.report, null);
  }
  const report = JSON.parse(JSON.stringify(seed));
  report.results[0].lastOperation = 'account-read';
  assert.equal(sanitizeReport(report), null);
});
test('older valid reports remain readable without added labels and missing reports are never filled', async () => {
  const f = reportFixture();
  const rows = results();
  delete rows[5].lastOperation;
  const report = await persistRunReport(f.ref, rows, 17);
  assert.equal(report.results[5].lastOperation, undefined);
  const legacy = reportFixture(report);
  assert.deepEqual((await inspectRun(legacy.db, runId)).report, report);
  assert.equal(legacy.updates.length, 0);
  const missing = reportFixture();
  const inspect = await inspectRun(missing.db, runId);
  assert.equal(inspect.reportAvailable, false);
  assert.equal(inspect.reportValidation, 'missing');
  assert.equal(inspect.report, null);
  assert.equal(missing.updates.length, 0);
});
