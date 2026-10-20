const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createJournalService } = require('../cloudfunctions/moodsky/services/journal');
const { createMemoryJournalRepository } = require('./helpers/memory-journal-repository');

const { fixture, error } = require('./helpers/backend-fixture');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');

test('backend writes a private whitelisted view and preserves creation timestamp on edit', async () => {
  const f = fixture();
  const saved = await f.save({ text: 'SYNTHETIC 正文😀', tags: ['REST'] });
  assert.equal(saved.ok, true);
  const first = saved.data.entry;
  assert.deepEqual(Object.keys(first).sort(), [
    'createdAt',
    'date',
    'id',
    'tags',
    'text',
    'updatedAt',
    'version',
    'weather',
  ]);
  assert.equal(first.version, 1);
  saved.data.entry.tags.push('STUDY');
  f.setClock('2026-10-18T01:00:00.000Z');
  const edited = await f.save({ expectedVersion: 1, text: 'SYNTHETIC edit', weather: 'RAINY' });
  assert.equal(edited.data.entry.id, first.id);
  assert.equal(edited.data.entry.createdAt, first.createdAt);
  assert.equal(edited.data.entry.updatedAt, '2026-10-18T01:00:00.000Z');
  assert.equal(edited.data.entry.version, 2);
  assert.equal(f.repository.inspect('synthetic_a').revision, 2);
  assert.equal(
    (await f.call('journal.get', { date: first.date })).data.entry.text,
    'SYNTHETIC edit',
  );
});

test('backend derives owner from trusted identity and rejects spoofing, disabled and missing actors', async () => {
  const f = fixture();
  await f.save({ text: 'SYNTHETIC A only' });
  assert.equal(
    (await f.call('journal.get', { date: '2026-10-18' }, { actor: 'b' })).data.entry,
    null,
  );
  assert.equal((await f.save({}, { actor: 'b' })).data.entry.version, 1);
  error(await f.save({}, { actor: 'disabled' }), 'ACCOUNT_DISABLED');
  error(await f.save({}, { actor: 'unknown' }), 'UNAUTHENTICATED');
  error(await f.save({ ownerId: 'synthetic_b' }), 'INVALID_REQUEST');
  error(await f.router(f.request('journal.get', { date: '2026-10-18' })), 'UNAUTHENTICATED');
  assert.equal(f.repository.inspect('synthetic_a').revision, 1);
});

test('backend retries bind the original input with keyed digests and do not retain writing in receipts', async () => {
  const f = fixture();
  const options = { id: 'req_backend_retry' };
  const first = await f.save({ text: 'SYNTHETIC private writing' }, options);
  const retry = await f.save({ text: 'SYNTHETIC private writing' }, options);
  assert.deepEqual(retry, first);
  error(await f.save({ tags: [], text: 'SYNTHETIC private writing' }, options), 'CONFLICT');
  error(await f.save({ text: 'different' }, options), 'CONFLICT');
  const data = f.repository.inspect('synthetic_a');
  assert.equal(data.revision, 1);
  assert.doesNotMatch(JSON.stringify(data.receipts), /SYNTHETIC private writing|SUNNY|REST/);
  assert.match(Object.values(data.receipts)[0].digest, /^[a-f0-9]{64}$/);
});

test('backend concurrent creates and optimistic edits permit exactly one winner per version', async () => {
  const f = fixture();
  const created = await Promise.all(Array.from({ length: 16 }, () => f.save()));
  assert.equal(created.filter((result) => result.ok).length, 1);
  for (const failed of created.filter((result) => !result.ok)) {
    error(failed, 'CONFLICT');
  }
  const edited = await Promise.all(
    Array.from({ length: 16 }, (_, i) => f.save({ expectedVersion: 1, text: 'SYNTHETIC ' + i })),
  );
  assert.equal(edited.filter((result) => result.ok).length, 1);
  assert.equal(f.repository.inspect('synthetic_a').revision, 2);
});

test('backend concurrent identical retries commit once and isolate receipts across accounts', async () => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 16 }, () => f.save({}, { id: 'req_backend_same' })),
  );
  for (const result of results) {
    assert.deepEqual(result, results[0]);
  }
  const other = await f.save({}, { actor: 'b', id: 'req_backend_same' });
  assert.equal(other.ok, true);
  assert.notEqual(other.data.entry.id, results[0].data.entry.id);
  assert.equal(f.repository.inspect('synthetic_a').revision, 1);
});

test('backend delete erases writing, invalidates old save retry and cannot delete another account', async () => {
  const f = fixture();
  await f.save({ text: 'SYNTHETIC erase me', tags: ['REST'] }, { id: 'req_backend_original' });
  await f.save({ text: 'SYNTHETIC B stays' }, { actor: 'b' });
  error(await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 9 }), 'CONFLICT');
  const options = { id: 'req_backend_delete' };
  const payload = { date: '2026-10-18', expectedVersion: 1 };
  const deleted = await f.call('journal.delete', payload, options);
  assert.deepEqual(deleted.data, { date: payload.date, deleted: true });
  assert.deepEqual(await f.call('journal.delete', payload, options), deleted);
  assert.equal((await f.call('journal.get', { date: payload.date })).data.entry, null);
  assert.deepEqual(f.repository.inspect('synthetic_a').days[payload.date], {
    version: 2,
    entry: null,
  });
  assert.doesNotMatch(
    JSON.stringify(f.repository.inspect('synthetic_a')),
    /SYNTHETIC erase me|REST/,
  );
  error(
    await f.save({ text: 'SYNTHETIC erase me', tags: ['REST'] }, { id: 'req_backend_original' }),
    'CONFLICT',
  );
  assert.equal(
    (await f.call('journal.get', { date: payload.date }, { actor: 'b' })).data.entry.text,
    'SYNTHETIC B stays',
  );
});

test('backend tombstone versions prevent ABA updates and stale delete retries after recreation', async () => {
  const f = fixture();
  const first = await f.save();
  const payload = { date: '2026-10-18', expectedVersion: 1 };
  await f.call('journal.delete', payload, { id: 'req_backend_delete' });
  const recreated = await f.save();
  assert.equal(recreated.data.entry.version, 3);
  assert.notEqual(recreated.data.entry.id, first.data.entry.id);
  error(await f.save({ expectedVersion: 1 }), 'CONFLICT');
  error(await f.call('journal.delete', payload, { id: 'req_backend_delete' }), 'CONFLICT');
  error(await f.call('journal.delete', payload), 'CONFLICT');
  assert.equal(f.repository.inspect('synthetic_a').revision, 3);
});

test('backend empty delete is idempotent without advancing source revision', async () => {
  const f = fixture();
  const payload = { date: '2026-10-18', expectedVersion: 1 };
  const options = { id: 'req_backend_absent' };
  const first = await f.call('journal.delete', payload, options);
  assert.deepEqual(first.data, { date: payload.date, deleted: false });
  assert.deepEqual(await f.call('journal.delete', payload, options), first);
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
  await f.save();
  error(await f.call('journal.delete', payload, options), 'CONFLICT');
});

test('backend uses China date for new-entry window and permits edits to existing old records', async () => {
  const f = fixture();
  assert.equal((await f.save({ date: '2026-09-19' })).ok, true); // 29 days ago.
  error(await f.save({ date: '2026-09-18' }), 'INVALID_INPUT');
  error(await f.save({ date: '2026-10-19' }), 'INVALID_INPUT');
  f.setClock('2026-12-01T00:00:00.000Z');
  assert.equal((await f.save({ date: '2026-09-19', expectedVersion: 1 })).ok, true);
  await f.call('journal.delete', { date: '2026-09-19', expectedVersion: 2 });
  error(await f.save({ date: '2026-09-19' }), 'INVALID_INPUT');
});

test('backend rejects malformed queries, unsafe versions and unagreed fields before storage', async () => {
  const f = fixture();
  for (const payload of [{ date: '2026-02-30' }, { date: '2026-10-18', id: 'other' }, {}]) {
    error(await f.call('journal.get', payload), 'INVALID_INPUT');
  }
  for (const expectedVersion of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    error(await f.call('journal.delete', { date: '2026-10-18', expectedVersion }), 'INVALID_INPUT');
  }
  for (const expectedVersion of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    error(await f.save({ expectedVersion }), 'INVALID_INPUT');
  }
  error(await f.save({ text: '😀'.repeat(1001) }), 'INVALID_INPUT');
  assert.equal((await f.save({ text: '😀'.repeat(1000) })).ok, true);
  assert.equal(f.repository.inspect('synthetic_a').revision, 1);
});

test('backend transaction failure rolls back entry, revision and receipt, then retry can succeed', async () => {
  const f = fixture();
  let fail = true;
  const repository = {
    ...f.repository,
    transact: (ownerId, work) =>
      f.repository.transact(ownerId, (tx) =>
        work({
          ...tx,
          setReceipt: async (...args) => {
            await tx.setReceipt(...args);
            if (fail) {
              throw new Error('SYNTHETIC private platform error');
            }
          },
        }),
      ),
  };
  const router = createRouter({
    journalRepository: repository,
    journalReceiptPolicy: createSyntheticReceiptPolicy(),
    now: () => new Date('2026-10-18T00:00:00.000Z'),
    resolveAccount: async () => ({ id: 'synthetic_a', status: 'active' }),
  });
  const request = f.request('journal.upsert', {
    date: '2026-10-18',
    weather: 'SUNNY',
    expectedVersion: 0,
  });
  const response = await router(request, { OPENID: 'a' });
  error(response, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(response), /private platform error/);
  assert.deepEqual(f.repository.inspect('synthetic_a'), { days: {}, receipts: {}, revision: 0 });
  fail = false;
  assert.equal((await router(request, { OPENID: 'a' })).data.entry.version, 1);
});

test('backend clones caller input before queued execution and does not trust repository output fields', async () => {
  const repository = createMemoryJournalRepository();
  const service = createJournalService({
    repository,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now: () => new Date('2026-10-18T00:00:00Z'),
  });
  const payload = {
    date: '2026-10-18',
    weather: 'SUNNY',
    expectedVersion: 0,
    tags: ['REST'],
    text: 'SYNTHETIC original',
  };
  const promise = service({
    action: 'journal.upsert',
    payload,
    actor: { accountId: 'synthetic_a' },
    requestId: 'req_backend_immutable',
  });
  payload.tags.push('STUDY');
  payload.text = 'SYNTHETIC changed';
  const saved = await promise;
  assert.equal(saved.entry.text, 'SYNTHETIC original');
  assert.deepEqual(saved.entry.tags, ['REST']);
  await repository.transact('synthetic_a', async (tx) => {
    const day = await tx.getDay(payload.date);
    day.entry.ownerId = 'SYNTHETIC secret owner';
    day.entry.internalSecret = 'SYNTHETIC internal';
    await tx.setDay(payload.date, day);
  });
  const read = await service({
    action: 'journal.get',
    payload: { date: payload.date },
    actor: { accountId: 'synthetic_a' },
  });
  assert.doesNotMatch(JSON.stringify(read), /secret owner|internalSecret|SYNTHETIC internal/);
});
