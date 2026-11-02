const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportPreparation } = require('../tools/export-candidate/preparation');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { syntheticSnapshot } = require('../tools/export-candidate/fixture');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const ownerId = 'synthetic_export_owner';
const now = () => new Date('2026-10-21T04:00:00.000Z');
function seed() {
  const source = syntheticSnapshot();
  const rows = {
    ['accounts:' + ownerId]: {
      _id: ownerId,
      status: 'active',
      exportEpoch: 1,
      operationFence: 0,
      journalRevision: 1,
    },
  };
  for (const [collection, entries] of Object.entries({
    journals: source.journals,
    favorites: source.favorites,
    task_history: source.taskHistory,
    preferences: [source.preferences],
    month_decorations: source.monthDecorations,
  })) {
    entries.forEach((row, index) => {
      const id = collection + '_' + index;
      rows[collection + ':' + id] = {
        ...row,
        _id: id,
        ...(collection === 'journals' && row.id ? { entryId: row.id } : {}),
      };
    });
  }
  return rows;
}
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
const options = (db) => ({
  db,
  readSourceState,
  maxRecords: 100,
  maxBytes: 1048576,
  pageSize: 1,
  now,
});
async function createJob(db, format = 'json') {
  return createExportService({ db, readSourceState, now }).createExportJob(
    ownerId,
    format,
    'req_synthetic_prepare_' + format,
  );
}

test('export preparation joins actual pending jobs, paginated sources and both formatters without writes', async () => {
  for (const format of ['json', 'markdown']) {
    const f = databaseFixture(seed());
    const job = await createJob(f.db, format);
    const before = f.inspect();
    const result = await createExportPreparation(options(f.db)).prepare(ownerId, job.jobId);
    assert.equal(result.format, format);
    assert.equal(result.jobId, job.jobId);
    assert.equal(result.accountEpoch, 1);
    assert.equal(result.artifact.byteLength, Buffer.byteLength(result.artifact.content, 'utf8'));
    assert.match(result.artifact.content, /SIMULATED/);
    assert.doesNotMatch(
      result.artifact.content,
      /ownerId|targetEntryId|synthetic_export_owner|sourceRevision/,
    );
    assert.deepEqual(
      f.inspect(),
      before,
      'Preparation must not publish ready state or write storage',
    );
    assert.equal(f.inspect()['export_jobs:' + job.jobId].state, 'pending');
    if (format === 'json') {
      const data = JSON.parse(result.artifact.content).data;
      assert.equal(data.journals.length, 2);
      assert.equal(data.favorites.length, 1);
      assert.equal(data.taskHistory.length, 1);
      assert.equal(data.monthDecorations[0].stickers.length, 1);
    }
  }
});

test('export preparation rejects foreign, revoked, nonpending and stale tasks before scanning private rows', async () => {
  for (const patch of [
    { ownerId: 'synthetic_other' },
    { state: 'ready' },
    { state: 'processing' },
    { revoked: true },
    { revoked: 'false' },
    { accountEpoch: 0 },
    { format: 'html' },
    { createdAt: '1' },
    { createdAt: '2026-10-22T04:00:00.000Z' },
  ]) {
    const f = databaseFixture(seed());
    const job = await createJob(f.db);
    f.put('export_jobs', { ...f.inspect()['export_jobs:' + job.jobId], ...patch });
    const reads = f.calls.length;
    await assert.rejects(createExportPreparation(options(f.db)).prepare(ownerId, job.jobId));
    assert.equal(f.calls.slice(reads).filter((c) => c.operation === 'query').length, 0);
  }
});

test('export preparation rechecks task revocation and format changes after private pagination', async () => {
  for (const patch of [{ revoked: true }, { state: 'processing' }, { format: 'markdown' }]) {
    const f = databaseFixture(seed());
    const job = await createJob(f.db);
    let injected = false;
    const db = {
      ...f.db,
      collection(name) {
        const collection = f.db.collection(name);
        if (name !== 'journals') {
          return collection;
        }
        return {
          ...collection,
          where(filter) {
            const query = collection.where(filter);
            const get = query.get;
            query.get = async () => {
              const result = await get();
              if (!injected) {
                injected = true;
                f.put('export_jobs', { ...f.inspect()['export_jobs:' + job.jobId], ...patch });
              }
              return result;
            };
            return query;
          },
        };
      },
    };
    await assert.rejects(createExportPreparation(options(db)).prepare(ownerId, job.jobId), {
      code: 'CONFLICT',
    });
    assert.equal(injected, true);
    assert.deepEqual(f.inspect()['export_jobs:' + job.jobId].fileId, null);
  }
});

test('export preparation detects mutations between job check, snapshot scan and final revalidation', async () => {
  for (const boundary of [2, 4]) {
    const f = databaseFixture(seed());
    const job = await createJob(f.db);
    let count = 0;
    const db = {
      ...f.db,
      runTransaction(work) {
        count++;
        if (count === boundary) {
          const row = f.inspect()['accounts:' + ownerId];
          f.put('accounts', { ...row, exportEpoch: 2, journalRevision: 2 });
        }
        return f.db.runTransaction(work);
      },
    };
    await assert.rejects(createExportPreparation(options(db)).prepare(ownerId, job.jobId), {
      code: 'CONFLICT',
    });
    assert.equal(f.inspect()['export_jobs:' + job.jobId].state, 'pending');
  }
});

test('export preparation rejects source adapter epoch mismatch, malformed data and output bounds', async () => {
  for (const mode of ['epoch', 'invalid-row', 'bytes', 'rows', 'disabled']) {
    const f = databaseFixture(seed());
    const job = await createJob(f.db);
    const config = options(f.db);
    if (mode === 'epoch') {
      config.readSourceState = async (id, tx) => ({ ...(await readSourceState(id, tx)), epoch: 0 });
    }
    if (mode === 'invalid-row') {
      f.put('journals', { ...f.inspect()['journals:journals_0'], createdAt: '1' });
    }
    if (mode === 'bytes') {
      config.maxBytes = 1;
    }
    if (mode === 'rows') {
      config.maxRecords = 1;
    }
    if (mode === 'disabled') {
      f.put('accounts', { ...f.inspect()['accounts:' + ownerId], status: 'disabled' });
    }
    await assert.rejects(createExportPreparation(config).prepare(ownerId, job.jobId));
    assert.equal(f.inspect()['export_jobs:' + job.jobId].state, 'pending');
  }
  await assert.rejects(createExportPreparation().prepare(ownerId, 'synthetic_job'), {
    code: 'NOT_IMPLEMENTED',
  });
});

test('export preparation traverses the locked SDK with HTTP disabled and leaves the database unchanged', async () => {
  await withOfflineWxDatabase(seed(), async ({ db, inspect }) => {
    const job = await createJob(db);
    const before = inspect();
    const output = await createExportPreparation(options(db)).prepare(ownerId, job.jobId);
    assert.equal(JSON.parse(output.artifact.content).data.journals.length, 2);
    assert.deepEqual(inspect(), before);
  });
});
