const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const ownerId = 'synthetic_export_atomic_owner';
const seed = {
  ['accounts:' + ownerId]: {
    _id: ownerId,
    status: 'active',
    operationFence: 0,
    exportEpoch: 1,
    journalRevision: 1,
  },
};
async function readSourceState(id, tx) {
  const row = (await tx.collection('accounts').doc(id).get()).data;
  return {
    ownerId: id,
    status: row.status,
    epoch: row.exportEpoch,
    revisions: {
      journals: row.journalRevision,
      favorites: 0,
      tasks: 0,
      preferences: 0,
      decorations: 0,
    },
  };
}

test('export source versions and job creation share one transaction snapshot', async () => {
  const f = databaseFixture(seed);
  let transactions = 0;
  const db = {
    ...f.db,
    runTransaction(work) {
      transactions++;
      // Simulate a source mutation at the boundary between separate transactions.
      if (transactions === 2) {
        f.put('accounts', { ...seed['accounts:' + ownerId], exportEpoch: 2, journalRevision: 2 });
      }
      return f.db.runTransaction(work);
    },
  };
  const result = await createExportService({ db, readSourceState }).createExportJob(
    ownerId,
    'json',
    'req_export_atomic_snapshot',
  );
  const stored = f.inspect();
  assert.equal(
    stored['export_jobs:' + result.jobId].accountEpoch,
    stored['accounts:' + ownerId].exportEpoch,
  );
  assert.equal(transactions, 1, 'No preliminary transaction may leave a stale source closure');
});

test('export source versions are reread when the locked SDK retries the job transaction', async () => {
  await withOfflineWxDatabase(seed, async ({ db, inspect }) => {
    let injected = false;
    let sourceReads = 0;
    const candidateDb = {
      config: db.config,
      runTransaction(work) {
        return db.runTransaction((tx) =>
          work({
            collection(name) {
              if (name !== 'export_jobs') {
                return tx.collection(name);
              }
              return {
                doc(id) {
                  const document = tx.collection(name).doc(id);
                  return {
                    async get() {
                      if (!injected) {
                        injected = true;
                        await db.runTransaction((writer) =>
                          writer
                            .collection('accounts')
                            .doc(ownerId)
                            .update({
                              data: { exportEpoch: 2, journalRevision: 2 },
                            }),
                        );
                      }
                      return document.get();
                    },
                    set: (input) => document.set(input),
                  };
                },
              };
            },
          }),
        );
      },
    };
    const service = createExportService({
      db: candidateDb,
      readSourceState: async (...args) => {
        sourceReads++;
        return readSourceState(...args);
      },
    });
    const result = await service.createExportJob(ownerId, 'json', 'req_export_atomic_sdk_retry');
    const job = inspect()['export_jobs:' + result.jobId];
    assert.equal(injected, true);
    assert.equal(sourceReads, 2, 'The SDK must rerun the source read with the job write');
    assert.equal(job.accountEpoch, 2);
    assert.equal(job.sourceRevisions.journals, 2);
    assert.equal(Object.keys(inspect()).filter((key) => key.startsWith('export_jobs:')).length, 1);
    assert.deepEqual(
      await service.createExportJob(ownerId, 'json', 'req_export_atomic_sdk_retry'),
      result,
    );
  });
});

test('export source mutation invalidates the old request without rewriting its job', async () => {
  const f = databaseFixture(seed);
  const service = createExportService({ db: f.db, readSourceState });
  const original = await service.createExportJob(ownerId, 'json', 'req_export_atomic_original');
  const saved = f.inspect()['export_jobs:' + original.jobId];
  f.put('accounts', { ...seed['accounts:' + ownerId], exportEpoch: 2, journalRevision: 2 });
  await assert.rejects(service.createExportJob(ownerId, 'json', 'req_export_atomic_original'), {
    code: 'CONFLICT',
  });
  assert.deepEqual(f.inspect()['export_jobs:' + original.jobId], saved);
  const next = await service.createExportJob(ownerId, 'json', 'req_export_atomic_new');
  assert.notEqual(next.jobId, original.jobId);
  assert.equal(f.inspect()['export_jobs:' + next.jobId].sourceRevisions.journals, 2);
});

test('export creation writes no job when a source read fails or its transaction cannot commit', async () => {
  for (const stage of ['source', 'commit']) {
    const f = databaseFixture(seed, {
      fail: ({ operation }) => stage === 'commit' && operation === 'commit',
    });
    const service = createExportService({
      db: f.db,
      readSourceState:
        stage === 'source'
          ? async () => {
              throw Error('SYNTHETIC_SOURCE_FAILURE');
            }
          : readSourceState,
    });
    await assert.rejects(
      service.createExportJob(ownerId, 'json', 'req_export_atomic_failure'),
      /SYNTHETIC|SIMULATED/,
    );
    assert.deepEqual(f.inspect(), seed);
  }
});
