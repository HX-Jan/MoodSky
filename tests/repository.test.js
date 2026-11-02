const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { createCleanupService, markerId } = require('../cloudfunctions/moodsky/domains/cleanup');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createCandidateRouter } = require('../cloudfunctions/moodsky/candidate-router');
const { fixture } = require('./helpers/backend-fixture');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const owner = 'synthetic_w2_owner',
  jobId = 'synthetic_cleanup_job';
const source = (changes = {}) => ({
  ownerId: owner,
  status: 'active',
  epoch: 1,
  revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
  ...changes,
});
const cleanupSeed = (changes = {}) => ({
  ['accounts:' + owner]: { _id: owner, status: 'disabled' },
  ['cleanup_jobs:' + jobId]: {
    _id: jobId,
    ownerId: owner,
    state: 'pending',
    exportAccessRevoked: true,
    progress: {},
  },
  ...changes,
});
const options = { jobId, batchSize: 2 };
const journalRows = (count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const id = 'synthetic_row_' + String(i).padStart(4, '0');
      return [
        'journals:' + id,
        {
          _id: id,
          ownerId: owner,
          state: 'active',
          date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
          weather: 'SUNNY',
          tags: [],
          text: 'SIMULATED body ' + i,
          version: 1,
          createdAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-20T00:00:00.000Z',
          platformSecret: 'SIMULATED_NOT_EXPORTED',
        },
      ];
    }),
  );

test('W2 modules import without initializing or loading a cloud SDK', () => {
  const paths = ['repository', 'export', 'cleanup'].map((name) =>
    require.resolve('../cloudfunctions/moodsky/domains/' + name),
  );
  const script =
    'const M=require("node:module"),load=M._load;M._load=function(id,...args){if(id==="wx-server-sdk")throw Error("Cloud side effect");return load.call(this,id,...args)};for(const p of ' +
    JSON.stringify(paths) +
    ')require(p);';
  execFileSync(process.execPath, ['-e', script]);
});

test('W2 account lookup uses openid and returns stable router IDs for active and disabled accounts', async () => {
  for (const status of ['active', 'disabled']) {
    const f = databaseFixture({
      ['accounts:' + owner]: { _id: owner, openid: 'synthetic_identity', status },
    });
    const repository = createRepository({ db: f.db });
    const result = await repository.getOrCreateAccount('synthetic_identity');
    assert.deepEqual(result, { id: owner, status });
    const router = createCandidateRouter({
      resolveAccount: repository.getOrCreateAccount,
      journalRepository: fixture().repository,
    });
    const response = await router(
      {
        apiVersion: '1',
        requestId: 'req_w2_identity_route',
        action: 'journal.get',
        payload: { date: '2026-10-18' },
      },
      { OPENID: 'synthetic_identity' },
    );
    if (status === 'active') {
      assert.equal(response.ok, true);
    } else {
      assert.equal(response.error.code, 'ACCOUNT_DISABLED');
    }
    assert.equal(f.calls.filter((c) => c.operation === 'add').length, 0);
  }
});

test('W2 account creation is gated by explicit unique-index readiness and converges under sixteen callers', async () => {
  const f = databaseFixture();
  await assert.rejects(createRepository({ db: f.db }).getOrCreateAccount('synthetic_identity'), {
    code: 'NOT_IMPLEMENTED',
  });
  const service = createRepository({ db: f.db, accountUniqueIndexReady: true });
  const accounts = await Promise.all(
    Array.from({ length: 16 }, () => service.getOrCreateAccount('synthetic_identity')),
  );
  assert.equal(new Set(accounts.map((a) => a.id)).size, 1);
  assert.equal(Object.values(f.inspect()).length, 1);
  assert.equal(Object.values(f.inspect())[0].openid, 'synthetic_identity');
  assert.equal(Object.hasOwn(Object.values(f.inspect())[0], '_openid'), false);
});

test('W2 ambiguous account creation re-reads once instead of repeating a committed add', async () => {
  let armed = true;
  const f = databaseFixture(
    {},
    { fail: ({ operation }) => operation === 'addResponse' && armed && ((armed = false), true) },
  );
  const service = createRepository({ db: f.db, accountUniqueIndexReady: true });
  assert.equal((await service.getOrCreateAccount('synthetic_identity')).status, 'active');
  assert.equal(f.calls.filter((c) => c.operation === 'add').length, 1);
  assert.equal(Object.values(f.inspect()).length, 1);
  const bad = databaseFixture({
    'accounts:a': { _id: 'a', openid: 'synthetic_identity', status: 'active' },
    'accounts:b': { _id: 'b', openid: 'synthetic_identity', status: 'active' },
  });
  await assert.rejects(createRepository({ db: bad.db }).getOrCreateAccount('synthetic_identity'), {
    code: 'CONFLICT',
  });
});

test('W2 journal helpers reuse transactional versions, tombstones and original-request receipts', async () => {
  const f = fixture();
  const service = createRepository({
    journalRepository: f.repository,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now: () => new Date('2026-10-18T00:00:00.000Z'),
  });
  const payload = {
    date: '2026-10-18',
    weather: 'SUNNY',
    tags: [],
    text: 'SIMULATED W2',
    expectedVersion: 0,
  };
  const first = await service.saveJournal(owner, payload, 'req_w2_save_original');
  assert.deepEqual(await service.saveJournal(owner, payload, 'req_w2_save_original'), first);
  await assert.rejects(service.saveJournal(owner, payload), { code: 'INVALID_INPUT' });
  await assert.rejects(service.deleteJournal(owner, payload.date, 7, 'req_w2_bad_version'), {
    code: 'CONFLICT',
  });
  assert.equal(await service.deleteJournal(owner, payload.date, 1, 'req_w2_delete_original'), true);
  assert.equal(await service.getJournalByDate(owner, payload.date), null);
  const recreated = await service.saveJournal(owner, payload, 'req_w2_save_recreated');
  assert.equal(recreated.version, 3);
  assert.notEqual(recreated.id, first.id);
  await assert.rejects(service.saveJournal(owner, payload, 'req_w2_save_original'), {
    code: 'CONFLICT',
  });
});

test('W2 export paginates all five scopes, filters deleted writing and projects internal source rows', async () => {
  const f = databaseFixture({
    ['accounts:' + owner]: { _id: owner, status: 'active' },
    ...journalRows(101),
    'journals:zz_deleted': {
      _id: 'zz_deleted',
      ownerId: owner,
      state: 'deleted',
      text: 'SIMULATED DELETED BODY',
    },
    'journals:foreign': { _id: 'foreign', ownerId: 'synthetic_other', state: 'active' },
    'month_decorations:month': {
      _id: 'month',
      ownerId: owner,
      month: '2026-10',
      version: 1,
      stickers: [],
      backgroundId: null,
    },
  });
  const service = createExportService({
    db: f.db,
    readSourceState: async () => source(),
    maxRecords: 1000,
    pageSize: 40,
  });
  const output = await service.gatherExportData(owner);
  assert.equal(output.journals.length, 101);
  assert.equal(output.monthDecorations.length, 1);
  assert.equal(output.preferences, null);
  assert.doesNotMatch(JSON.stringify(output), /DELETED BODY|platformSecret|NOT_EXPORTED|foreign/);
  assert.equal(
    f.calls.filter((c) => c.operation === 'query' && c.collection === 'journals').length,
    3,
  );
});

test('W2 export refuses truncation, source changes, disabled accounts and missing consistency adapters', async () => {
  const f = databaseFixture({
    ...journalRows(101),
    ['accounts:' + owner]: { _id: owner, status: 'active' },
  });
  await assert.rejects(
    createExportService({
      db: f.db,
      readSourceState: async () => source(),
      maxRecords: 100,
    }).gatherExportData(owner),
    { code: 'INVALID_INPUT' },
  );
  let reads = 0;
  await assert.rejects(
    createExportService({
      db: f.db,
      readSourceState: async () => source({ epoch: ++reads }),
      maxRecords: 200,
    }).gatherExportData(owner),
    { code: 'CONFLICT' },
  );
  await assert.rejects(
    createExportService({
      db: f.db,
      readSourceState: async () => source({ status: 'disabled' }),
      maxRecords: 200,
    }).gatherExportData(owner),
    { code: 'ACCOUNT_DISABLED' },
  );
  await assert.rejects(createExportService({ db: f.db, maxRecords: 200 }).gatherExportData(owner), {
    code: 'NOT_IMPLEMENTED',
  });
  f.put('accounts', { _id: owner, status: 'disabled' });
  await assert.rejects(
    createExportService({
      db: f.db,
      readSourceState: async () => source(),
      maxRecords: 200,
    }).gatherExportData(owner),
    { code: 'ACCOUNT_DISABLED' },
  );
});

test('W2 export job creation is idempotent, private and rechecks the account in its transaction', async () => {
  const f = databaseFixture({
    ['accounts:' + owner]: { _id: owner, status: 'active', operationFence: 0 },
  });
  const service = createExportService({ db: f.db, readSourceState: async () => source() });
  await assert.rejects(service.createExportJob(owner, 'html', 'req_w2_export_job'), {
    code: 'INVALID_INPUT',
  });
  const jobs = await Promise.all(
    Array.from({ length: 16 }, () => service.createExportJob(owner, 'json', 'req_w2_export_job')),
  );
  assert.equal(new Set(jobs.map((j) => j.jobId)).size, 1);
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('export_jobs:')).length, 1);
  assert.equal(f.inspect()['accounts:' + owner].operationFence, 1);
  assert.deepEqual(Object.keys(jobs[0]).sort(), ['format', 'jobId', 'state']);
  await assert.rejects(service.createExportJob(owner, 'markdown', 'req_w2_export_job'), {
    code: 'CONFLICT',
  });
  f.put('accounts', { _id: owner, status: 'disabled' });
  await assert.rejects(service.createExportJob(owner, 'json', 'req_w2_export_disabled'), {
    code: 'ACCOUNT_DISABLED',
  });
});

test('W2 cleanup requires a persisted matching job, disabled account and revoked export access', async () => {
  for (const change of [
    { ['accounts:' + owner]: { _id: owner, status: 'active' } },
    {
      ['cleanup_jobs:' + jobId]: {
        _id: jobId,
        ownerId: 'synthetic_other',
        state: 'pending',
        exportAccessRevoked: true,
      },
    },
    { ['cleanup_jobs:' + jobId]: { _id: jobId, ownerId: owner, state: 'pending' } },
  ]) {
    const f = databaseFixture(cleanupSeed({ ...journalRows(1), ...change }));
    await assert.rejects(
      createCleanupService({ db: f.db }).cleanupByOwnerId('journals', owner, options),
      { code: 'FORBIDDEN' },
    );
    assert.ok(f.inspect()['journals:synthetic_row_0000']);
    assert.equal(f.calls.filter((c) => c.operation === 'remove').length, 0);
  }
  const f = databaseFixture(cleanupSeed());
  await assert.rejects(
    createCleanupService({ db: f.db }).cleanupByOwnerId('accounts', owner, options),
    { code: 'INVALID_INPUT' },
  );
  f.put('accounts', { _id: owner, status: 'disabled', journalLayout: 'deterministic-days-v1' });
  await assert.rejects(createCleanupService({ db: f.db }).executeAccountCleanup(owner, options), {
    code: 'NOT_IMPLEMENTED',
  });
});

test('W2 cleanup commits deletion, body-free ledger and persisted progress atomically across batches', async () => {
  const f = databaseFixture(
    cleanupSeed({
      ...journalRows(3),
      'favorites:foreign': { _id: 'foreign', ownerId: 'synthetic_other' },
    }),
  );
  const service = createCleanupService({ db: f.db });
  assert.equal(await service.cleanupByOwnerId('journals', owner, options), 3);
  const stored = f.inspect(),
    markers = Object.entries(stored).filter(([key]) => key.startsWith('deletion_markers:'));
  assert.equal(markers.length, 3);
  assert.ok(markers.every(([, row]) => row.cleanupState === 'completed' && row.ownerId === owner));
  assert.doesNotMatch(JSON.stringify(markers), /SIMULATED body|SUNNY|text/);
  assert.equal(stored['cleanup_jobs:' + jobId].progress.journals, 3);
  assert.ok(stored['favorites:foreign']);
  assert.equal(await service.cleanupByOwnerId('journals', owner, options), 0);
});

test('W2 cleanup rolls back intent or deletion failures and retries without losing its ledger', async () => {
  for (const failure of ['set', 'remove', 'commit']) {
    let armed = true;
    const f = databaseFixture(cleanupSeed(journalRows(1)), {
      fail: ({ operation, collection }) =>
        armed &&
        ((failure === 'set' && operation === 'set' && collection === 'deletion_markers') ||
          (failure === 'remove' && operation === 'remove') ||
          (failure === 'commit' && operation === 'commit')),
    });
    const service = createCleanupService({ db: f.db });
    await assert.rejects(service.cleanupByOwnerId('journals', owner, options), /SIMULATED/);
    assert.ok(f.inspect()['journals:synthetic_row_0000']);
    assert.equal(
      Object.keys(f.inspect()).filter((k) => k.startsWith('deletion_markers:')).length,
      0,
    );
    armed = false;
    assert.equal(await service.cleanupByOwnerId('journals', owner, options), 1);
    assert.equal(
      f.inspect()['deletion_markers:' + markerId(owner, 'journals', 'synthetic_row_0000')]
        .cleanupState,
      'completed',
    );
  }
});

test('W2 export-file cleanup persists intent before file failure and completes only after acknowledgement', async () => {
  const f = databaseFixture(
    cleanupSeed({
      'export_jobs:export1': { _id: 'export1', ownerId: owner, fileId: 'SIMULATED_FILE_REFERENCE' },
    }),
  );
  let failing = true,
    calls = 0;
  const service = createCleanupService({
    db: f.db,
    removeExportFile: async () => {
      calls++;
      if (failing) {
        throw Error('SIMULATED_FILE_FAILURE');
      }
      return { alreadyMissing: true };
    },
  });
  await assert.rejects(
    service.cleanupByOwnerId('export_jobs', owner, options),
    /SIMULATED_FILE_FAILURE/,
  );
  const marker = 'deletion_markers:' + markerId(owner, 'export_jobs', 'export1');
  assert.equal(f.inspect()[marker].cleanupState, 'pending');
  assert.ok(f.inspect()['export_jobs:export1']);
  failing = false;
  assert.equal(await service.cleanupByOwnerId('export_jobs', owner, options), 1);
  assert.equal(f.inspect()[marker].cleanupState, 'completed');
  assert.equal(f.inspect()['cleanup_jobs:' + jobId].progress.export_jobs, 1);
  assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(f.inspect()[marker]), /FILE_REFERENCE/);
});

test('W2 full cleanup retains ledger, records all progress and never fakes skipped export completion', async () => {
  const f = databaseFixture(
    cleanupSeed({ ...journalRows(1), 'favorites:favorite1': { _id: 'favorite1', ownerId: owner } }),
  );
  const result = await createCleanupService({ db: f.db }).executeAccountCleanup(owner, options);
  assert.equal(result.state, 'completed');
  assert.equal(result.progress.journals, 1);
  assert.equal(result.progress.favorites, 1);
  assert.equal(result.progress.export_jobs, 0);
  assert.equal(f.inspect()['cleanup_jobs:' + jobId].state, 'completed');
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('deletion_markers:')).length, 2);
  assert.deepEqual(
    await createCleanupService({ db: f.db }).executeAccountCleanup(owner, options),
    result,
  );
  const blocked = databaseFixture(
    cleanupSeed({
      'export_jobs:export1': { _id: 'export1', ownerId: owner, fileId: 'SIMULATED_FILE' },
    }),
  );
  await assert.rejects(
    createCleanupService({ db: blocked.db }).executeAccountCleanup(owner, options),
    { code: 'NOT_IMPLEMENTED' },
  );
  assert.notEqual(blocked.inspect()['cleanup_jobs:' + jobId].state, 'completed');
  assert.ok(blocked.inspect()['export_jobs:export1']);
});

test('W2 cleanup crosses the locked SDK transaction serializer and rolls back a failed deletion', async () => {
  let armed = true;
  await withOfflineWxDatabase(
    cleanupSeed(journalRows(1)),
    async ({ db, inspect, calls }) => {
      // Query pagination is covered separately; here queries read the transport's committed snapshot.
      // Every per-row mutation still goes through the installed wx SDK transaction serializer.
      const candidateDb = {
        config: db.config,
        command: db.command,
        serverDate: () => db.serverDate(),
        runTransaction: (work) => db.runTransaction(work),
        collection(name) {
          return {
            where(filter) {
              let size = 100;
              const query = {
                orderBy() {
                  return query;
                },
                limit(value) {
                  size = value;
                  return query;
                },
                async get() {
                  return {
                    data: Object.entries(inspect())
                      .filter(
                        ([key, row]) =>
                          key.startsWith(name + ':') && row.ownerId === filter.ownerId,
                      )
                      .map(([, row]) => row)
                      .sort((a, b) => a._id.localeCompare(b._id))
                      .slice(0, size),
                  };
                },
              };
              return query;
            },
          };
        },
      };
      const service = createCleanupService({ db: candidateDb });
      await assert.rejects(service.cleanupByOwnerId('journals', owner, options));
      assert.ok(inspect()['journals:synthetic_row_0000']);
      assert.equal(
        Object.keys(inspect()).filter((key) => key.startsWith('deletion_markers:')).length,
        0,
      );
      armed = false;
      assert.equal(await service.cleanupByOwnerId('journals', owner, options), 1);
      assert.equal(inspect()['cleanup_jobs:' + jobId].progress.journals, 1);
      assert.equal(
        inspect()['deletion_markers:' + markerId(owner, 'journals', 'synthetic_row_0000')]
          .cleanupState,
        'completed',
      );
      assert.ok(calls.some((call) => call.action === 'database.removeDocument'));
    },
    {
      fail: (action) =>
        armed && action === 'database.removeDocument' ? 'SIMULATED_DELETE_FAILURE' : null,
    },
  );
});

test('W2 export job crosses the locked SDK transaction boundary without enabling downloads', async () => {
  await withOfflineWxDatabase(
    { ['accounts:' + owner]: { _id: owner, status: 'active', operationFence: 0 } },
    async ({ db, inspect }) => {
      const service = createExportService({ db, readSourceState: async () => source() });
      const result = await service.createExportJob(owner, 'json', 'req_w2_sdk_export');
      assert.deepEqual(await service.createExportJob(owner, 'json', 'req_w2_sdk_export'), result);
      assert.equal(inspect()['export_jobs:' + result.jobId].state, 'pending');
      assert.equal(inspect()['export_jobs:' + result.jobId].fileId, null);
      assert.equal(
        Object.keys(inspect()).filter((key) => key.startsWith('export_jobs:')).length,
        1,
      );
    },
  );
});
