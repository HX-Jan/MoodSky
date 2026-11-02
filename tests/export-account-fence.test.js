const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { databaseFixture } = require('./helpers/w2-database');
const ownerId = 'synthetic_export_fence_owner';
const row = {
  _id: ownerId,
  status: 'active',
  operationFence: 0,
  exportEpoch: 1,
  journalRevision: 1,
};
const seed = { ['accounts:' + ownerId]: row };
const source = async (id, tx) => {
  const account = (await tx.collection('accounts').doc(id).get()).data;
  return {
    ownerId: id,
    status: account.status,
    epoch: account.exportEpoch,
    revisions: {
      journals: account.journalRevision,
      favorites: 0,
      tasks: 0,
      preferences: 0,
      decorations: 0,
    },
  };
};
const service = (db) =>
  createExportService({
    db,
    readSourceState: source,
    now: () => new Date('2026-10-21T00:00:00.000Z'),
  });
function raceBeforeJobRead(db, mutate) {
  let injected = false;
  return {
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
                      await mutate(db);
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
}

test('synthetic snapshot isolation permits disjoint writes without undoing another transaction commit', async () => {
  await withOfflineWxDatabase(
    seed,
    async ({ db, inspect }) => {
      await db.runTransaction(async (tx) => {
        assert.equal((await tx.collection('accounts').doc(ownerId).get()).data.status, 'active');
        await db.runTransaction((writer) =>
          writer
            .collection('accounts')
            .doc(ownerId)
            .update({ data: { status: 'disabled', operationFence: 1 } }),
        );
        // A read alone did not join the account writer's conflict set in this model.
        await tx
          .collection('export_jobs')
          .doc('synthetic_unfenced_control')
          .set({ data: { ownerId, state: 'pending' } });
      });
      assert.equal(inspect()['accounts:' + ownerId].status, 'disabled');
      assert.equal(inspect()['export_jobs:synthetic_unfenced_control'].state, 'pending');
    },
    { conflictScope: 'written-documents' },
  );
});

test('export creation cannot commit a new job from an active snapshot after account disablement', async () => {
  await withOfflineWxDatabase(
    seed,
    async ({ db, inspect }) => {
      const candidateDb = raceBeforeJobRead(db, (database) =>
        database.runTransaction((writer) =>
          writer
            .collection('accounts')
            .doc(ownerId)
            .update({ data: { status: 'disabled', operationFence: 1 } }),
        ),
      );
      let error;
      try {
        await service(candidateDb).createExportJob(ownerId, 'json', 'req_export_close_race');
      } catch (caught) {
        error = caught;
      }
      assert.equal(inspect()['accounts:' + ownerId].status, 'disabled');
      assert.equal(
        Object.keys(inspect()).filter((key) => key.startsWith('export_jobs:')).length,
        0,
      );
      assert.equal(error?.code, 'ACCOUNT_DISABLED');
    },
    { conflictScope: 'written-documents' },
  );
});

test('export creation rereads its sources after a concurrent account-fenced source mutation', async () => {
  await withOfflineWxDatabase(
    seed,
    async ({ db, inspect }) => {
      const candidateDb = raceBeforeJobRead(db, (database) =>
        database.runTransaction((writer) =>
          writer
            .collection('accounts')
            .doc(ownerId)
            .update({ data: { operationFence: 1, exportEpoch: 2, journalRevision: 2 } }),
        ),
      );
      const result = await service(candidateDb).createExportJob(
        ownerId,
        'json',
        'req_export_source_fence_race',
      );
      const job = inspect()['export_jobs:' + result.jobId];
      assert.equal(job.accountEpoch, 2);
      assert.equal(job.sourceRevisions.journals, 2);
      assert.equal(inspect()['accounts:' + ownerId].operationFence, 2);
    },
    { conflictScope: 'written-documents' },
  );
});

test('new export jobs require an existing valid account fence and never initialize legacy account metadata', async () => {
  for (const operationFence of [
    undefined,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const account = { ...row, operationFence };
    if (operationFence === undefined) {
      delete account.operationFence;
    }
    const f = databaseFixture({ ['accounts:' + ownerId]: account });
    const before = f.inspect();
    await assert.rejects(
      service(f.db).createExportJob(ownerId, 'json', 'req_export_fence_readiness'),
      { code: operationFence === undefined ? 'NOT_IMPLEMENTED' : 'CONFLICT' },
    );
    assert.deepEqual(f.inspect(), before);
    if (operationFence === undefined) {
      // This gate does not invent a fence or prohibit the existing read-only snapshot helper.
      assert.equal(
        (
          await createExportService({
            db: f.db,
            readSourceState: source,
            maxRecords: 10,
          }).gatherExportData(ownerId)
        ).journals.length,
        0,
      );
    }
  }
});

test('locked SDK fence-write failure rolls back export creation and preserves the original retry', async () => {
  for (const failedCollection of ['accounts', 'export_jobs']) {
    let armed = true;
    await withOfflineWxDatabase(
      seed,
      async ({ db, inspect }) => {
        const candidate = service(db);
        await assert.rejects(
          candidate.createExportJob(ownerId, 'json', 'req_export_fence_write_failure'),
          (error) => error.errCode === -501001,
        );
        assert.deepEqual(inspect(), seed);
        armed = false;
        const result = await candidate.createExportJob(
          ownerId,
          'json',
          'req_export_fence_write_failure',
        );
        assert.equal(inspect()['accounts:' + ownerId].operationFence, 1);
        assert.equal(inspect()['export_jobs:' + result.jobId].state, 'pending');
      },
      {
        conflictScope: 'written-documents',
        fail: (action, params) =>
          armed &&
          action === 'database.modifyDocument' &&
          params.collectionName === failedCollection
            ? 'SYS_ERR'
            : null,
      },
    );
  }
});

test('sixteen same-ID export callers create one job and advance the account fence only once', async () => {
  await withOfflineWxDatabase(
    seed,
    async ({ db, inspect }) => {
      const candidate = service(db);
      const results = await Promise.all(
        Array.from({ length: 16 }, () =>
          candidate.createExportJob(ownerId, 'json', 'req_export_fence_same_id'),
        ),
      );
      results.forEach((result) => assert.deepEqual(result, results[0]));
      assert.equal(inspect()['accounts:' + ownerId].operationFence, 1);
      assert.equal(
        Object.keys(inspect()).filter((key) => key.startsWith('export_jobs:')).length,
        1,
      );
    },
    { conflictScope: 'written-documents' },
  );
});

test('export snapshot consistency ignores unrelated operation-fence advances when all source versions remain equal', async () => {
  let changed = false;
  const f = databaseFixture(seed, {
    fail: ({ operation }) => {
      if (!changed && operation === 'query') {
        changed = true;
        f.put('accounts', { ...row, operationFence: 7 });
      }
      return false;
    },
  });
  const result = await createExportService({
    db: f.db,
    readSourceState: source,
    maxRecords: 10,
  }).gatherExportData(ownerId);
  assert.equal(changed, true);
  assert.equal(result.accountEpoch, 1);
  assert.equal(result.sourceRevision, 1);
  assert.equal(f.inspect()['accounts:' + ownerId].operationFence, 7);
});
