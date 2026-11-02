const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { createExportPreparation } = require('../tools/export-candidate/preparation');
const { createExportPublication } = require('../tools/export-candidate/publication');
const {
  exportStatus,
  planClaim,
  authorizeRead,
} = require('../tools/export-candidate/access-policy');
const ownerId = 'synthetic_publication_owner';
const fileId = 'synthetic_private_immutable_file';
const now = () => new Date('2026-10-21T04:00:00.000Z');
const seed = () => ({
  ['accounts:' + ownerId]: {
    _id: ownerId,
    status: 'active',
    exportEpoch: 4,
    operationFence: 0,
    journalRevision: 2,
  },
  'journals:synthetic_day': {
    _id: 'synthetic_day',
    ownerId,
    entryId: 'synthetic_entry',
    state: 'active',
    date: '2026-10-21',
    weather: 'SUNNY',
    tags: [],
    text: 'SIMULATED private publication writing 😀',
    version: 1,
    createdAt: '2026-10-21T03:00:00.000Z',
    updatedAt: '2026-10-21T03:00:00.000Z',
  },
});
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
async function build(db, format = 'json') {
  const options = { db, readSourceState, now, maxRecords: 100, maxBytes: 1048576 };
  const job = await createExportService(options).createExportJob(
    ownerId,
    format,
    'req_publication_' + format,
  );
  const prepared = await createExportPreparation(options).prepare(ownerId, job.jobId);
  const bytes = Buffer.from(prepared.artifact.content, 'utf8');
  const metadata = {
    ownerId,
    jobId: job.jobId,
    fileId,
    private: true,
    immutable: true,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    mimeType: prepared.artifact.mimeType,
  };
  let inspections = 0;
  const settings = {
    db,
    readSourceState,
    now,
    maxBytes: 1048576,
    inspectArtifact: async () => {
      inspections++;
      return globalThis.structuredClone(metadata);
    },
  };
  return { job, prepared, metadata, settings, inspections: () => inspections };
}
test('export pending job, real snapshot preparation and verified publication join both formats and pure read policy', async () => {
  for (const format of ['json', 'markdown']) {
    const f = databaseFixture(seed());
    const b = await build(f.db, format);
    const publisher = createExportPublication(b.settings);
    assert.deepEqual(await publisher.publish(ownerId, b.job.jobId, b.prepared, fileId), {
      jobId: b.job.jobId,
      state: 'ready',
      format,
    });
    const data = f.inspect();
    const job = data['export_jobs:' + b.job.jobId];
    assert.equal(job.state, 'ready');
    assert.equal(job.byteLength, b.metadata.byteLength);
    assert.equal(data['accounts:' + ownerId].operationFence, 2);
    assert.doesNotMatch(JSON.stringify(job), /private publication writing/);
    const input = {
      actorId: ownerId,
      account: { id: ownerId, status: 'active', exportEpoch: 4 },
      job: { ...job, id: b.job.jobId },
      sourceRevisions: job.sourceRevisions,
      now: now(),
    };
    assert.equal(exportStatus(input).state, 'ready');
    const plan = planClaim(input); // Pure trusted record only, NOT an issued credential.
    assert.deepEqual(authorizeRead(input, plan), { fileId });
    const before = f.inspect();
    await publisher.publish(ownerId, b.job.jobId, b.prepared, fileId);
    assert.deepEqual(f.inspect(), before);
    assert.equal(b.inspections(), 1);
  }
});
test('export publication rejects mismatched, public or mutable artifact metadata without advancing the task', async () => {
  for (const patch of [
    { ownerId: 'synthetic_other' },
    { jobId: 'synthetic_other_job' },
    { fileId: 'synthetic_other_file' },
    { private: false },
    { immutable: false },
    { sha256: '0'.repeat(64) },
    { byteLength: 0 },
    { mimeType: 'text/html' },
  ]) {
    const f = databaseFixture(seed());
    const b = await build(f.db);
    Object.assign(b.metadata, patch);
    const before = f.inspect();
    await assert.rejects(
      createExportPublication(b.settings).publish(ownerId, b.job.jobId, b.prepared, fileId),
      { code: 'FORBIDDEN' },
    );
    assert.deepEqual(f.inspect(), before);
  }
});
test('publication refuses foreign or stale jobs, disabled accounts and missing protocol before inspecting storage', async () => {
  for (const mode of ['foreign', 'source', 'disabled', 'legacy']) {
    const f = databaseFixture(seed());
    const b = await build(f.db);
    if (mode === 'foreign') {
      f.put('export_jobs', {
        ...f.inspect()['export_jobs:' + b.job.jobId],
        ownerId: 'synthetic_other',
      });
    } else {
      const account = f.inspect()['accounts:' + ownerId];
      if (mode === 'source') {
        account.journalRevision++;
      }
      if (mode === 'disabled') {
        account.status = 'disabled';
      }
      if (mode === 'legacy') {
        delete account.operationFence;
      }
      f.put('accounts', account);
    }
    const before = f.inspect();
    await assert.rejects(
      createExportPublication(b.settings).publish(ownerId, b.job.jobId, b.prepared, fileId),
    );
    assert.equal(b.inspections(), 0);
    assert.deepEqual(f.inspect(), before);
  }
  await assert.rejects(createExportPublication().publish(ownerId, 'synthetic_job', {}, fileId), {
    code: 'NOT_IMPLEMENTED',
  });
});
test('source mutation or account stop during artifact inspection prevents readiness', async () => {
  for (const mode of ['source', 'disabled']) {
    const f = databaseFixture(seed());
    const b = await build(f.db);
    b.settings.inspectArtifact = async () => {
      const row = f.inspect()['accounts:' + ownerId];
      f.put('accounts', {
        ...row,
        ...(mode === 'source' ? { journalRevision: 3 } : { status: 'disabled' }),
      });
      return b.metadata;
    };
    await assert.rejects(
      createExportPublication(b.settings).publish(ownerId, b.job.jobId, b.prepared, fileId),
    );
    assert.equal(f.inspect()['export_jobs:' + b.job.jobId].state, 'pending');
    assert.equal(f.inspect()['accounts:' + ownerId].operationFence, 1);
  }
});
test('sixteen same-artifact publishers advance the fence once and never renew expiry on replay', async () => {
  const f = databaseFixture(seed());
  const b = await build(f.db);
  let clock = now();
  b.settings.now = () => clock;
  const publisher = createExportPublication(b.settings);
  const results = await Promise.all(
    Array.from({ length: 16 }, () => publisher.publish(ownerId, b.job.jobId, b.prepared, fileId)),
  );
  assert.ok(results.every((result) => result.state === 'ready'));
  assert.equal(f.inspect()['accounts:' + ownerId].operationFence, 2);
  const before = f.inspect();
  clock = new Date('2026-10-21T05:00:00.000Z');
  await publisher.publish(ownerId, b.job.jobId, b.prepared, fileId);
  assert.deepEqual(f.inspect(), before);
  clock = new Date(before['export_jobs:' + b.job.jobId].expiresAt);
  await assert.rejects(publisher.publish(ownerId, b.job.jobId, b.prepared, fileId), {
    code: 'CONFLICT',
  });
  assert.deepEqual(f.inspect(), before);
});
test('a publication whose commit response is lost confirms the original ready state without a second write', async () => {
  const f = databaseFixture(seed());
  const b = await build(f.db);
  let lost = false;
  b.settings.db = {
    ...f.db,
    async runTransaction(work) {
      const result = await f.db.runTransaction(work);
      if (!lost && f.inspect()['export_jobs:' + b.job.jobId].state === 'ready') {
        lost = true;
        throw new Error('SIMULATED committed response lost');
      }
      return result;
    },
  };
  const publisher = createExportPublication(b.settings);
  await assert.rejects(publisher.publish(ownerId, b.job.jobId, b.prepared, fileId));
  const committed = f.inspect();
  assert.equal(committed['export_jobs:' + b.job.jobId].state, 'ready');
  assert.equal((await publisher.publish(ownerId, b.job.jobId, b.prepared, fileId)).state, 'ready');
  assert.deepEqual(f.inspect(), committed);
});
test('locked SDK publication rolls back a failed job write and original retry publishes once', async () => {
  let armed = false;
  await withOfflineWxDatabase(
    seed(),
    async ({ db, inspect }) => {
      const b = await build(db);
      const before = inspect();
      armed = true;
      const publisher = createExportPublication(b.settings);
      await assert.rejects(publisher.publish(ownerId, b.job.jobId, b.prepared, fileId));
      assert.deepEqual(inspect(), before);
      assert.equal(
        (await publisher.publish(ownerId, b.job.jobId, b.prepared, fileId)).state,
        'ready',
      );
      assert.equal(inspect()['accounts:' + ownerId].operationFence, 2);
    },
    {
      fail: (action, params) => {
        if (
          armed &&
          action === 'database.modifyDocument' &&
          params.collectionName === 'export_jobs'
        ) {
          armed = false;
          return 'SYNTHETIC_PUBLICATION_WRITE_FAILED';
        }
        return null;
      },
    },
  );
});

test('publication captures prepared inputs before inspection and rejects a changed ready replay', async () => {
  const f = databaseFixture(seed());
  const b = await build(f.db);
  const original = globalThis.structuredClone(b.prepared);
  b.settings.inspectArtifact = async () => {
    b.prepared.format = 'markdown';
    b.prepared.sourceRevisions.journals = 999;
    b.prepared.artifact.content = 'SIMULATED changed while awaiting metadata';
    return b.metadata;
  };
  const publisher = createExportPublication(b.settings);
  assert.equal((await publisher.publish(ownerId, b.job.jobId, b.prepared, fileId)).format, 'json');
  const committed = f.inspect();
  await assert.rejects(publisher.publish(ownerId, b.job.jobId, original, 'synthetic_other_file'), {
    code: 'CONFLICT',
  });
  const changed = globalThis.structuredClone(original);
  changed.artifact.content += ' ';
  changed.artifact.byteLength++;
  await assert.rejects(publisher.publish(ownerId, b.job.jobId, changed, fileId), {
    code: 'CONFLICT',
  });
  assert.deepEqual(f.inspect(), committed);
});

test('the publication account fence prevents ready commit after a concurrent disable in the SDK snapshot model', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ db, inspect }) => {
      const b = await build(db);
      let stopped = false;
      b.settings.db = {
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
                      get: () => document.get(),
                      async update(input) {
                        if (!stopped && input.data.state === 'ready') {
                          stopped = true;
                          await db.runTransaction(async (writer) => {
                            const ref = writer.collection('accounts').doc(ownerId);
                            const owner = (await ref.get()).data;
                            await ref.update({
                              data: {
                                status: 'disabled',
                                operationFence: owner.operationFence + 1,
                              },
                            });
                          });
                        }
                        return document.update(input);
                      },
                    };
                  },
                };
              },
            }),
          );
        },
      };
      await assert.rejects(
        createExportPublication(b.settings).publish(ownerId, b.job.jobId, b.prepared, fileId),
        { code: 'ACCOUNT_DISABLED' },
      );
      assert.equal(stopped, true);
      assert.equal(inspect()['export_jobs:' + b.job.jobId].state, 'pending');
      assert.equal(inspect()['accounts:' + ownerId].status, 'disabled');
      assert.equal(inspect()['accounts:' + ownerId].operationFence, 2);
    },
    { conflictScope: 'written-documents' },
  );
});
