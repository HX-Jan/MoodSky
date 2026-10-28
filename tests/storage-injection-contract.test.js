const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { createCleanupService } = require('../cloudfunctions/moodsky/domains/cleanup');
const { databaseFixture } = require('./helpers/w2-database');
const owner = 'synthetic_injection_owner';
const source = async () => ({
  ownerId: owner,
  status: 'active',
  epoch: 0,
  revisions: { journals: 0, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
});

for (const factory of [createRepository, createExportService, createCleanupService]) {
  test(
    factory.name + ' rejects positional arguments and raw databases before any operation',
    () => {
      const f = databaseFixture();
      for (const args of [[f.db, {}], [{ db: f.db }, {}], [f.db], [null], [[]]]) {
        assert.throws(() => factory(...args), /expects one options object/);
      }
      assert.equal(f.calls.length, 0);
      assert.doesNotThrow(() => factory());
      assert.doesNotThrow(() => factory({ db: f.db }));
    },
  );
}

test('a fixture wrapper is diagnosed consistently without reading or changing its store', async () => {
  const f = databaseFixture();
  const operations = [
    () => createRepository({ db: f }).getOrCreateAccount(owner),
    () =>
      createExportService({ db: f, maxRecords: 10, readSourceState: source }).gatherExportData(
        owner,
      ),
    () =>
      createCleanupService({ db: f }).cleanupByOwnerId('journals', owner, {
        jobId: 'synthetic_job',
      }),
  ];
  for (const run of operations) {
    await assert.rejects(run(), /pass fixture.db/);
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.inspect(), {});
});

test('export scans reject a transaction-only double before opening its first snapshot', async () => {
  let calls = 0;
  const db = {
    config: { throwOnNotFound: false },
    runTransaction() {
      calls++;
      throw new Error('Must not start');
    },
  };
  await assert.rejects(
    createExportService({ db, maxRecords: 10, readSourceState: source }).gatherExportData(owner),
    /missing collection\(\)/,
  );
  assert.equal(calls, 0);
});

test('cleanup rejects missing collection or serverDate before transaction or deletion starts', async () => {
  for (const missing of ['collection', 'serverDate']) {
    let calls = 0;
    const db = {
      config: { throwOnNotFound: false },
      runTransaction() {
        calls++;
        throw new Error('Must not start');
      },
      collection() {
        calls++;
        throw new Error('Must not query');
      },
      serverDate: () => '2026-10-28T00:00:00.000Z',
    };
    delete db[missing];
    await assert.rejects(
      createCleanupService({ db }).cleanupByOwnerId('journals', owner, { jobId: 'synthetic_job' }),
      new RegExp('missing ' + missing + '\\(\\)'),
    );
    assert.equal(calls, 0);
  }
});

test('account creation diagnoses a missing serverDate before add, while lookup needs no timestamp', async () => {
  const f = databaseFixture();
  delete f.db.serverDate;
  const service = createRepository({ db: f.db, accountUniqueIndexReady: true });
  await assert.rejects(service.getOrCreateAccount(owner), /missing serverDate\(\)/);
  assert.equal(
    f.calls.some((call) => call.operation === 'add'),
    false,
  );
  f.put('accounts', { _id: owner, openid: owner, status: 'active' });
  assert.deepEqual(await service.getOrCreateAccount(owner), { id: owner, status: 'active' });
});

test('the shared WX double exercises export and cleanup with the supported options and method shape', async () => {
  const f = databaseFixture({
    ['accounts:' + owner]: { _id: owner, status: 'active' },
    'journals:synthetic_record': {
      _id: 'synthetic_record',
      ownerId: owner,
      state: 'active',
      date: '2026-10-28',
      weather: 'CUSTOM',
      weatherName: '合成验收',
      text: 'SIMULATED',
      tags: [],
      version: 1,
    },
  });
  const snapshot = await createExportService({
    db: f.db,
    readSourceState: source,
    maxRecords: 10,
  }).gatherExportData(owner);
  assert.equal(snapshot.journals[0].weatherName, '合成验收');
  assert.equal(
    f.calls.some((call) => ['add', 'set', 'update', 'remove'].includes(call.operation)),
    false,
  );
  f.put('accounts', { _id: owner, status: 'disabled' });
  f.put('cleanup_jobs', {
    _id: 'synthetic_job',
    ownerId: owner,
    state: 'pending',
    exportAccessRevoked: true,
    progress: {},
  });
  const count = await createCleanupService({ db: f.db }).cleanupByOwnerId('journals', owner, {
    jobId: 'synthetic_job',
    batchSize: 2,
  });
  assert.equal(count, 1);
  assert.equal(f.inspect()['journals:synthetic_record'], undefined);
  const marker = Object.entries(f.inspect()).find(([key]) =>
    key.startsWith('deletion_markers:'),
  )[1];
  assert.equal(marker.cleanupState, 'completed');
  assert.equal(marker.deletedAt, '2026-10-20T00:00:00.000Z');
});
