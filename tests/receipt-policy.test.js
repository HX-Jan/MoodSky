const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createReceiptPolicy,
  CANONICAL_VERSION,
} = require('../cloudfunctions/moodsky/services/receipt-policy');
const { createJournalService } = require('../cloudfunctions/moodsky/services/journal');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryJournalRepository } = require('./helpers/memory-journal-repository');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { fixture, error } = require('./helpers/backend-fixture');
const now = new Date('2026-10-18T00:00:00.000Z');
const policy = (activeKeyId = 'synthetic_old', includeOld = true) =>
  createReceiptPolicy({
    activeKeyId,
    keys: {
      ...(includeOld ? { synthetic_old: Buffer.alloc(32, 65) } : {}),
      synthetic_new: Buffer.alloc(32, 66),
    },
    maxAgeMs: 1000,
  });

test('receipt binding preserves omitted fields, array order, Unicode and whitespace but ignores object key order', () => {
  const p = policy();
  const payload = {
    date: '2026-10-18',
    weather: 'SUNNY',
    expectedVersion: 0,
    tags: ['REST', 'STUDY'],
    text: 'é ',
  };
  const binding = p.bind('journal.upsert', payload, now);
  assert.equal(binding.stamp.canonicalVersion, CANONICAL_VERSION);
  assert.equal(
    p
      .bind(
        'journal.upsert',
        {
          text: 'é ',
          tags: ['REST', 'STUDY'],
          expectedVersion: 0,
          weather: 'SUNNY',
          date: '2026-10-18',
        },
        now,
      )
      .matches(binding.stamp),
    true,
  );
  for (const changed of [
    { ...payload, tags: ['STUDY', 'REST'] },
    { ...payload, text: 'é' },
    { ...payload, text: 'e\u0301 ' },
  ]) {
    assert.equal(p.bind('journal.upsert', changed, now).matches(binding.stamp), false);
  }
  assert.equal(p.bind('journal.delete', payload, now).matches(binding.stamp), false);
  const missing = p.bind(
    'journal.upsert',
    { date: payload.date, weather: payload.weather, expectedVersion: 0 },
    now,
  );
  assert.equal(
    p
      .bind(
        'journal.upsert',
        { date: payload.date, weather: payload.weather, expectedVersion: 0, text: '' },
        now,
      )
      .matches(missing.stamp),
    false,
  );
  assert.throws(() => p.bind('journal.upsert', { text: undefined }, now), {
    code: 'INVALID_INPUT',
  });
});

test('receipt key rotation verifies retained old keys and refuses missing or unknown verification material', () => {
  const binding = policy().bind('journal.upsert', { text: 'SYNTHETIC secret' }, now);
  assert.equal(
    policy('synthetic_new')
      .bind('journal.upsert', { text: 'SYNTHETIC secret' }, now)
      .matches(binding.stamp),
    true,
  );
  assert.equal(
    policy('synthetic_new', false)
      .bind('journal.upsert', { text: 'SYNTHETIC secret' }, now)
      .matches(binding.stamp),
    false,
  );
  assert.equal(
    binding.matches({ ...binding.stamp, canonicalVersion: 'unknown_future_version' }),
    false,
  );
  assert.equal(binding.matches({ ...binding.stamp, digest: 'z'.repeat(64) }), false);
  assert.doesNotMatch(JSON.stringify(binding.stamp), /SYNTHETIC secret|payload|text/);
  assert.throws(
    () =>
      createReceiptPolicy({ activeKeyId: 'test', keys: { test: Buffer.alloc(8) }, maxAgeMs: 1000 }),
    TypeError,
  );
});

test('receipt expiration rejects exactly at the boundary and keeps an expired key occupied', async () => {
  const f = fixture();
  const first = await f.save({}, { id: 'req_h03_expired' });
  assert.equal(first.ok, true);
  f.setClock('2026-10-17T16:59:59.999Z');
  assert.equal((await f.save({}, { id: 'req_h03_expired' })).ok, true);
  f.setClock('2026-10-17T17:00:00.000Z');
  error(await f.save({}, { id: 'req_h03_expired' }), 'CONFLICT');
  assert.equal(f.repository.inspect('synthetic_a').revision, 1);
  await f.repository.transact('synthetic_a', (tx) =>
    tx.setReceipt('journal.upsert', 'req_h03_expired', { state: 'expired' }),
  );
  error(await f.save({}, { id: 'req_h03_expired' }), 'CONFLICT');
  assert.equal(f.repository.inspect('synthetic_a').revision, 1);
});

test('receipt lifetime is explicit and malformed/future/overlong stamps never authorize replay', () => {
  const p = policy();
  const binding = p.bind('journal.delete', { date: '2026-10-18', expectedVersion: 1 }, now);
  assert.equal(
    p
      .bind(
        'journal.delete',
        { date: '2026-10-18', expectedVersion: 1 },
        new Date(now.getTime() + 999),
      )
      .matches(binding.stamp),
    true,
  );
  assert.equal(
    p
      .bind(
        'journal.delete',
        { date: '2026-10-18', expectedVersion: 1 },
        new Date(now.getTime() + 1000),
      )
      .matches(binding.stamp),
    false,
  );
  for (const change of [
    { state: 'expired' },
    { acceptedAt: '2026-10-18T00:00:00.001Z' },
    { expiresAt: '2026-10-18T00:00:01.001Z' },
    { acceptedAt: 'bad' },
  ]) {
    assert.equal(binding.matches({ ...binding.stamp, ...change }), false);
  }
});

test('journal writes require a configured receipt policy but read-only services remain available', async () => {
  const repository = createMemoryJournalRepository();
  const router = createRouter({
    journalRepository: repository,
    resolveAccount: async () => ({ id: 'synthetic_a', status: 'active' }),
  });
  const request = (action, payload) => ({
    apiVersion: '1',
    requestId: 'req_h03_no_policy',
    action,
    payload,
  });
  error(
    await router(
      request('journal.upsert', { date: '2026-10-18', weather: 'SUNNY', expectedVersion: 0 }),
      { OPENID: 'synthetic' },
    ),
    'NOT_IMPLEMENTED',
  );
  assert.equal(
    (await router(request('journal.get', { date: '2026-10-18' }), { OPENID: 'synthetic' })).data
      .entry,
    null,
  );
  assert.equal(repository.inspect('synthetic_a').revision, 0);
});

test('journal callback retries reuse the candidate identity, original request and invocation clock', async () => {
  const base = createMemoryJournalRepository();
  const repository = {
    ...base,
    async transact(ownerId, work) {
      await assert.rejects(
        base.transact(ownerId, async (tx) => {
          await work(tx);
          throw new Error('SYNTHETIC callback rollback');
        }),
        /callback rollback/,
      );
      return base.transact(ownerId, work);
    },
  };
  let clocks = 0;
  let identities = 0;
  const service = createJournalService({
    repository,
    receiptPolicy: createSyntheticReceiptPolicy(),
    now: () => new Date(now.getTime() + clocks++),
    createId: () => 'synthetic_candidate_' + ++identities,
  });
  const result = await service({
    action: 'journal.upsert',
    payload: { date: '2026-10-18', weather: 'SUNNY', expectedVersion: 0 },
    actor: { accountId: 'synthetic_a' },
    requestId: 'req_h03_fixed_candidate',
  });
  assert.equal(result.entry.id, 'synthetic_candidate_1');
  assert.equal(result.entry.createdAt, now.toISOString());
  assert.equal(clocks, 1);
  assert.equal(identities, 1);
  assert.equal(base.inspect('synthetic_a').revision, 1);
});
