const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { createCleanupService, markerId } = require('../cloudfunctions/moodsky/domains/cleanup');
const { databaseFixture } = require('./helpers/w2-database');
const ownerId = 'synthetic_w3_export_owner';
const jobId = 'synthetic_w3_cleanup_job';
const options = { jobId, batchSize: 1 };
const seed = (changes = {}) => ({
  ['accounts:' + ownerId]: { _id: ownerId, status: 'disabled' },
  ['cleanup_jobs:' + jobId]: {
    _id: jobId,
    ownerId,
    state: 'pending',
    progress: {},
    exportAccessRevoked: true,
  },
  ...changes,
});
const row = (id, extra = {}) => ({ _id: id, ownerId, ...extra });

test('pending export jobs never claim the size of a file that has not been prepared', async () => {
  for (const format of ['json', 'markdown']) {
    const f = databaseFixture({
      ['accounts:' + ownerId]: { _id: ownerId, status: 'active', operationFence: 0 },
    });
    const service = createExportService({
      db: f.db,
      now: () => new Date('2026-10-28T04:00:00.000Z'),
      readSourceState: async () => ({
        ownerId,
        status: 'active',
        epoch: 1,
        revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
      }),
    });
    const result = await service.createExportJob(ownerId, format, 'req_w3_size_' + format);
    const stored = f.inspect()['export_jobs:' + result.jobId];
    assert.equal(stored.state, 'pending');
    assert.equal(stored.fileId, null);
    assert.equal(Object.hasOwn(stored, 'fileSize'), false);
    assert.equal(Object.hasOwn(stored, 'byteLength'), false);
  }
});

test('cleanup totals are persisted from committed per-collection progress and repeat unchanged', async () => {
  const f = databaseFixture(
    seed({
      'journals:synthetic_journal': row('synthetic_journal'),
      'favorites:synthetic_favorite': row('synthetic_favorite'),
    }),
  );
  const service = createCleanupService({ db: f.db });
  const result = await service.executeAccountCleanup(ownerId, options);
  assert.equal(result.totalDeleted, 2);
  assert.equal(result.progress.journals, 1);
  assert.equal(result.progress.favorites, 1);
  assert.equal(f.inspect()['cleanup_jobs:' + jobId].totalDeleted, 2);
  assert.deepEqual(await service.executeAccountCleanup(ownerId, options), result);
});

test('cleanup propagates storage failures without logging private file references or platform messages', async () => {
  const fileId = 'SYNTHETIC_PRIVATE_FILE_REFERENCE';
  const error = new Error('SYNTHETIC_SIGNED_URL_AND_PLATFORM_DETAILS');
  const f = databaseFixture(
    seed({ 'export_jobs:synthetic_export': row('synthetic_export', { fileId }) }),
  );
  const logged = [],
    original = console.error;
  console.error = (...values) => logged.push(values);
  try {
    await assert.rejects(
      createCleanupService({
        db: f.db,
        removeExportFile: async () => {
          throw error;
        },
      }).cleanupByOwnerId('export_jobs', ownerId, options),
      (caught) => caught === error,
    );
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, []);
  const marker =
    f.inspect()['deletion_markers:' + markerId(ownerId, 'export_jobs', 'synthetic_export')];
  assert.equal(marker.cleanupState, 'pending');
  assert.doesNotMatch(JSON.stringify(marker), /PRIVATE_FILE|SIGNED_URL/);
  assert.ok(f.inspect()['export_jobs:synthetic_export']);
});

test('cleanup totals reject unsafe sums even when every individual collection count is safe', async () => {
  const initial = seed();
  initial['cleanup_jobs:' + jobId].progress = { journals: Number.MAX_SAFE_INTEGER, favorites: 1 };
  const f = databaseFixture(initial);
  await assert.rejects(createCleanupService({ db: f.db }).executeAccountCleanup(ownerId, options), {
    code: 'CONFLICT',
  });
  assert.deepEqual(f.inspect(), initial);
});

test('retry after a file failure counts already committed removals once and completes only after file acknowledgement', async () => {
  const f = databaseFixture(
    seed({
      'journals:synthetic_journal': row('synthetic_journal'),
      'export_jobs:synthetic_export': row('synthetic_export', { fileId: 'SYNTHETIC_FILE' }),
    }),
  );
  let failing = true;
  const service = createCleanupService({
    db: f.db,
    removeExportFile: async () => {
      if (failing) {
        throw new Error('SYNTHETIC_FILE_FAILURE');
      }
      return { alreadyMissing: true };
    },
  });
  await assert.rejects(service.executeAccountCleanup(ownerId, options), /SYNTHETIC_FILE_FAILURE/);
  assert.equal(f.inspect()['cleanup_jobs:' + jobId].progress.journals, 1);
  assert.notEqual(f.inspect()['cleanup_jobs:' + jobId].state, 'completed');
  assert.equal(Object.hasOwn(f.inspect()['cleanup_jobs:' + jobId], 'totalDeleted'), false);
  failing = false;
  const result = await service.executeAccountCleanup(ownerId, options);
  assert.equal(result.totalDeleted, 2);
  assert.equal(result.progress.export_jobs, 1);
  assert.equal(result.progress.journals, 1);
  assert.deepEqual(await service.executeAccountCleanup(ownerId, options), result);
});
