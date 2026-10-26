const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { LAYOUT, dayId } = require('../tools/journal-storage/cloudbase-candidate');
const { databaseFixture } = require('./helpers/w2-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { error } = require('./helpers/backend-fixture');
const { backendClient } = require('./helpers/backend-client');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');

const NOW = () => new Date('2026-10-20T00:00:00.000Z');
function fixture(options = {}) {
  const account = (id, openid) => ({
    _id: id,
    openid,
    status: 'active',
    journalLayout: LAYOUT,
    journalRevision: 0,
    operationFence: 0,
    exportEpoch: 0,
  });
  const db = databaseFixture(
    {
      'accounts:synthetic_a': account('synthetic_a', 'synthetic_openid_a'),
      'accounts:synthetic_b': account('synthetic_b', 'synthetic_openid_b'),
    },
    options,
  );
  const router = createWeek2Backend({
    db: db.db,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now: NOW,
  });
  let serial = 0;
  const request = (action, payload, requestId = 'req_week2_' + ++serial) => ({
    apiVersion: '1',
    action,
    payload,
    requestId,
  });
  const call = (action, payload, openid = 'synthetic_openid_a', requestId) =>
    router(request(action, payload, requestId), { OPENID: openid });
  const save = (input = {}, openid, id) =>
    call(
      'journal.upsert',
      { date: '2026-10-20', weather: 'SUNNY', expectedVersion: 0, ...input },
      openid,
      id,
    );
  return { ...db, router, request, call, save };
}

test('W2 assembled backend resolves actual account rows and refreshes month/empty-month views through CRUD', async () => {
  const f = fixture();
  assert.equal((await f.call('review.calendar', { month: '2026-10' })).data.recordCount, 0);
  const first = await f.save({ text: 'SYNTHETIC private', tags: ['REST'] });
  assert.equal(first.ok, true, JSON.stringify(first));
  const id = first.data.entry.id;
  assert.equal(
    f.inspect()['journals:' + dayId('synthetic_a', '2026-10-20')].ownerId,
    'synthetic_a',
  );
  const calendar = await f.call('review.calendar', { month: '2026-10' });
  assert.equal(calendar.data.entries[0].id, id);
  assert.equal(calendar.data.sourceRevision, 1);
  assert.doesNotMatch(JSON.stringify(calendar), /SYNTHETIC private|REST|openid|ownerId/);
  assert.equal((await f.call('review.monthArchive', { month: '2026-09' })).data.recordCount, 0);
  const edited = await f.save({ expectedVersion: 1, weather: 'RAINY' });
  assert.equal(edited.data.entry.id, id);
  const archive = await f.call('review.monthArchive', { month: '2026-10' });
  assert.equal(archive.data.cards[0].weather, 'RAINY');
  assert.equal(archive.data.sourceRevision, 2);
  await f.call('journal.delete', { date: '2026-10-20', expectedVersion: 2 });
  assert.equal((await f.call('review.calendar', { month: '2026-10' })).data.recordCount, 0);
  assert.equal((await f.call('journal.get', { date: '2026-10-20' })).data.entry, null);
  const recreated = await f.save();
  assert.equal(recreated.data.entry.version, 4);
  assert.notEqual(recreated.data.entry.id, id);
  assert.equal(
    (await f.call('review.monthArchive', { month: '2026-10' })).data.cards[0].id,
    recreated.data.entry.id,
  );
});

test('W2 assembled backend rejects spoofed identity, isolates accounts and gates stop between lookup and transaction', async () => {
  const f = fixture();
  await f.save({ text: 'SYNTHETIC A only' });
  assert.equal(
    (await f.call('journal.get', { date: '2026-10-20' }, 'synthetic_openid_b')).data.entry,
    null,
  );
  await f.save({ weather: 'CLOUDY' }, 'synthetic_openid_b');
  error(await f.save({ ownerId: 'synthetic_b' }), 'INVALID_REQUEST');
  const before = f.calls.length;
  error(await f.router(f.request('journal.get', { date: '2026-10-20' }), {}), 'UNAUTHENTICATED');
  assert.equal(f.calls.length, before);
  // Change persisted status after the resolver returns, before the storage transaction.
  const originalTransaction = f.db.runTransaction;
  f.db.runTransaction = (work) => {
    f.put('accounts', { ...f.inspect()['accounts:synthetic_a'], status: 'disabled' });
    return originalTransaction(work);
  };
  error(await f.save({ expectedVersion: 1 }), 'ACCOUNT_DISABLED');
  assert.equal(f.inspect()['accounts:synthetic_a'].journalRevision, 1);
  assert.equal(f.inspect()['accounts:synthetic_b'].journalRevision, 1);
});

test('W2 assembled backend does not silently migrate new accounts or enable unrelated domains', async () => {
  const f = fixture();
  error(
    await f.call('journal.get', { date: '2026-10-20' }, 'synthetic_unknown'),
    'NOT_IMPLEMENTED',
  );
  assert.equal(Object.keys(f.inspect()).length, 2);
  for (const [action, payload] of [
    ['account.preferences', {}],
    ['tasks.history', {}],
    ['review.decorations', { month: '2026-10', operation: 'get' }],
  ]) {
    error(await f.call(action, payload), 'NOT_IMPLEMENTED');
  }
  const router = createWeek2Backend({
    db: f.db,
    accountUniqueIndexReady: true,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now: NOW,
  });
  error(
    await router(f.request('journal.get', { date: '2026-10-20' }), { OPENID: 'synthetic_new' }),
    'NOT_IMPLEMENTED',
  );
  const created = Object.values(f.inspect()).find((row) => row.openid === 'synthetic_new');
  assert.ok(created);
  assert.equal(created.journalLayout, undefined);
  assert.equal(Object.keys(f.inspect()).filter((key) => key.startsWith('journals:')).length, 0);
});

test('W2 assembled backend failure rolls back storage and does not leak SDK details', async () => {
  const f = fixture({
    fail: ({ collection, operation }) => collection === 'request_receipts' && operation === 'set',
  });
  const initial = f.inspect();
  const response = await f.save({ text: 'SYNTHETIC secret' });
  error(response, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(response), /SIMULATED|SYNTHETIC secret/);
  assert.deepEqual(f.inspect(), initial);
});

test('W2 real client services and controller traverse assembled account/storage and notify review of changes', async () => {
  const f = fixture();
  const client = backendClient({ router: f.router, actor: 'synthetic_openid_a', repository: null });
  const changes = [];
  const controller = createJournalController({
    service: client.journal,
    now: NOW,
    onChanged: (value) => changes.push(value),
  });
  await controller.loadDate();
  controller.chooseWeather('SUNNY');
  controller.setText('SYNTHETIC full chain');
  client.loseNextResponse('journal.upsert');
  assert.equal(await controller.save(), false);
  const original = client.requests.at(-1);
  assert.equal(await controller.retry(), true);
  assert.equal(client.requests.at(-1), original);
  assert.equal(changes.length, 1);
  const firstId = controller.getState().entry.id;
  assert.equal((await client.reader.calendar('2026-10')).data.entries[0].id, firstId);
  controller.chooseWeather('RAINY');
  assert.equal(await controller.save(), true);
  assert.equal((await client.reader.monthArchive('2026-10')).data.cards[0].weather, 'RAINY');
  controller.requestDelete();
  assert.equal(await controller.confirmDelete(), true);
  assert.equal(changes.length, 3);
  assert.equal((await client.reader.calendar('2026-10')).data.recordCount, 0);
  assert.equal((await client.reader.getEntry('2026-10-20')).data.entry, null);
  controller.dispose();
});

test('W2 assembled account-to-journal-to-review path crosses the locked SDK without real network', async () => {
  const f = fixture();
  await withOfflineWxDatabase(f.inspect(), async ({ db, calls, inspect }) => {
    const router = createWeek2Backend({
      db,
      receiptPolicy: createSyntheticReceiptPolicy(),
      now: NOW,
    });
    const request = f.request('journal.upsert', {
      date: '2026-10-20',
      weather: 'SUNNY',
      expectedVersion: 0,
    });
    const result = await router(request, { OPENID: 'synthetic_openid_a' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const month = await router(f.request('review.calendar', { month: '2026-10' }), {
      OPENID: 'synthetic_openid_a',
    });
    assert.equal(month.data.entries[0].id, result.data.entry.id);
    const other = await router(f.request('journal.get', { date: '2026-10-20' }), {
      OPENID: 'synthetic_openid_b',
    });
    assert.equal(other.data.entry, null);
    const queries = calls.filter(
      (call) => call.action === 'database.getDocument' && !call.params.transactionId,
    );
    assert.equal(queries.length, 3);
    assert.equal(inspect()['accounts:synthetic_a'].journalRevision, 1);
    assert.equal(inspect()['accounts:synthetic_b'].journalRevision, 0);
  });
});
