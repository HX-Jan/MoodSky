const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { LAYOUT } = require('../tools/journal-storage/cloudbase-candidate');
const { databaseFixture } = require('./helpers/w2-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const now = () => new Date('2026-10-20T00:00:00.000Z');

test('explicit new-account layout lets a first trusted caller save, read and review without a manual field patch', async () => {
  const f = databaseFixture();
  const router = createWeek2Backend({
    db: f.db,
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now,
  });
  const request = {
    apiVersion: '1',
    requestId: 'req_first_account_save',
    action: 'journal.upsert',
    payload: {
      date: '2026-10-20',
      weather: 'SUNNY',
      expectedVersion: 0,
      text: 'SYNTHETIC first save',
    },
  };
  const first = await router(request, { OPENID: 'synthetic_first_identity' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.entry.version, 1);
  assert.deepEqual(await router(request, { OPENID: 'synthetic_first_identity' }), first);
  const month = await router(
    {
      ...request,
      requestId: 'req_first_account_month',
      action: 'review.calendar',
      payload: { month: '2026-10' },
    },
    { OPENID: 'synthetic_first_identity' },
  );
  assert.equal(month.data.entries[0].id, first.data.entry.id);
  assert.equal(month.data.sourceRevision, 1);
  const account = Object.values(f.inspect()).find(
    (row) => row.openid === 'synthetic_first_identity',
  );
  assert.equal(account.journalLayout, LAYOUT);
  assert.equal(account.journalRevision, 1);
  assert.equal(account.operationFence, 2);
  assert.equal(account.exportEpoch, 1);
  assert.doesNotMatch(JSON.stringify(first), /ownerId|openid|operationFence|journalLayout/);
});

test('provisioning remains off by default and a layout flag never replaces unique-index readiness', async () => {
  const f = databaseFixture();
  const repository = createRepository({ db: f.db, newAccountJournalLayout: LAYOUT });
  await assert.rejects(repository.getOrCreateAccount('synthetic_no_index'), {
    code: 'NOT_IMPLEMENTED',
  });
  assert.deepEqual(f.inspect(), {});
  const enabled = createRepository({ db: f.db, accountUniqueIndexReady: true });
  await enabled.getOrCreateAccount('synthetic_legacy_default');
  const row = Object.values(f.inspect())[0];
  assert.equal(row.journalLayout, undefined);
  assert.equal(row.operationFence, undefined);
});

test('provisioning never migrates or revives existing unmigrated or disabled accounts', async () => {
  for (const status of ['active', 'disabled']) {
    const row = {
      _id: 'synthetic_existing',
      openid: 'synthetic_existing_identity',
      status,
      custom: 'SYNTHETIC preserved',
    };
    const f = databaseFixture({ 'accounts:synthetic_existing': row });
    const service = createRepository({
      db: f.db,
      accountUniqueIndexReady: true,
      newAccountJournalLayout: LAYOUT,
    });
    assert.deepEqual(await service.getOrCreateAccount(row.openid), { id: row._id, status });
    assert.deepEqual(f.inspect(), { 'accounts:synthetic_existing': row });
    assert.equal(
      f.calls.filter((call) => ['set', 'update', 'add'].includes(call.operation)).length,
      0,
    );
  }
});

test('concurrent first account calls converge on one initialized account even after an ambiguous add response', async () => {
  let failOnce = true;
  const f = databaseFixture(
    {},
    {
      fail: ({ operation }) =>
        operation === 'addResponse' && failOnce && ((failOnce = false), true),
    },
  );
  const service = createRepository({
    db: f.db,
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
  });
  const accounts = await Promise.all(
    Array.from({ length: 16 }, () => service.getOrCreateAccount('synthetic_racing_identity')),
  );
  assert.equal(new Set(accounts.map((account) => account.id)).size, 1);
  const rows = Object.values(f.inspect());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].journalLayout, LAYOUT);
  assert.deepEqual(
    [rows[0].journalRevision, rows[0].operationFence, rows[0].exportEpoch],
    [0, 0, 0],
  );
});

test('unsupported new-account layouts fail at server construction instead of being written to a database', () => {
  const f = databaseFixture();
  for (const layout of ['', null, true, {}, 'unknown-layout']) {
    assert.throws(() => createRepository({ db: f.db, newAccountJournalLayout: layout }), TypeError);
  }
  assert.deepEqual(f.calls, []);
});

test('account initialization failure is not mistaken for a successful empty account', async () => {
  const f = databaseFixture({}, { fail: ({ operation }) => operation === 'add' });
  const service = createRepository({
    db: f.db,
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
  });
  await assert.rejects(service.getOrCreateAccount('synthetic_failed_account'), /SIMULATED_FAILURE/);
  assert.deepEqual(f.inspect(), {});
  assert.equal(f.calls.filter((call) => call.operation === 'add').length, 1);
});

test('locked SDK serializes initialized account creation and the same first request reaches a journal transaction', async () => {
  await withOfflineWxDatabase({}, async ({ db, inspect, calls }) => {
    const router = createWeek2Backend({
      db,
      accountUniqueIndexReady: true,
      newAccountJournalLayout: LAYOUT,
      receiptPolicy: createSyntheticReceiptPolicy(),
      now,
    });
    const request = {
      apiVersion: '1',
      requestId: 'req_sdk_first_account',
      action: 'journal.upsert',
      payload: { date: '2026-10-20', weather: 'SUNNY', expectedVersion: 0 },
    };
    const saved = await router(request, { OPENID: 'synthetic_sdk_first_identity' });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.data.entry.version, 1);
    const accounts = Object.values(inspect()).filter(
      (row) => row.openid === 'synthetic_sdk_first_identity',
    );
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].journalLayout, LAYOUT);
    assert.equal(accounts[0].journalRevision, 1);
    assert.equal(calls.filter((call) => call.action === 'database.insertDocument').length, 1);
    assert.deepEqual(await router(request, { OPENID: 'synthetic_sdk_first_identity' }), saved);
    assert.equal(inspect()['accounts:' + accounts[0]._id].journalRevision, 1);
  });
});

test('locked SDK unique-key collisions converge on one initialized account under sixteen first callers', async () => {
  await withOfflineWxDatabase({}, async ({ db, inspect }) => {
    const service = createRepository({
      db,
      accountUniqueIndexReady: true,
      newAccountJournalLayout: LAYOUT,
    });
    const results = await Promise.all(
      Array.from({ length: 16 }, () => service.getOrCreateAccount('synthetic_sdk_racing_identity')),
    );
    assert.equal(new Set(results.map((row) => row.id)).size, 1);
    assert.equal(Object.keys(inspect()).length, 1);
    assert.equal(Object.values(inspect())[0].journalLayout, LAYOUT);
  });
});

test('locked SDK successful account insertion followed by a lost response is recovered without a second insert', async () => {
  await withOfflineWxDatabase({}, async ({ db, calls, inspect }) => {
    const collection = db.collection.bind(db);
    const reference = collection('accounts');
    const add = reference.add.bind(reference);
    reference.add = async (options) => {
      await add(options);
      throw new Error('SYNTHETIC lost account add response');
    };
    db.collection = (name) => (name === 'accounts' ? reference : collection(name));
    const service = createRepository({
      db,
      accountUniqueIndexReady: true,
      newAccountJournalLayout: LAYOUT,
    });
    const result = await service.getOrCreateAccount('synthetic_sdk_ambiguous_identity');
    assert.equal(result.status, 'active');
    assert.equal(calls.filter((call) => call.action === 'database.insertDocument').length, 1);
    assert.equal(inspect()['accounts:' + result.id].journalLayout, LAYOUT);
  });
});
