// W3 JF01 - formal account resolver, journal preflight and layout confirmation.
// Owner: Jiawei Fang (w3-account). Reviewer: Xiang Hong. Independent check: Qizhen Cai.
// Local doubles only: every account row below is synthetic, the database is the
// copy-on-write fixture and no cloud call is made. Passing here is not evidence
// that real-cloud provisioning, uniq_openid or the account layout is verified.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const {
  createAccountAdapters,
  createAccountReaders,
  JOURNAL_LAYOUT,
} = require('../cloudfunctions/moodsky/services/account-adapters');
const { databaseFixture } = require('./helpers/w2-database');

const ALPHA = 'trusted_openid_alpha';
const LEGACY = 'trusted_openid_legacy';
const FIXED_NOW = new Date('2026-10-29T02:00:00.000Z');
const clock = () => FIXED_NOW;
const LAYOUT = 'deterministic-days-v1';

function world({ seed = {}, accountUniqueIndexReady = true, readAccount } = {}) {
  const f = databaseFixture(seed);
  const repository = createRepository({
    db: f.db,
    accountUniqueIndexReady,
    newAccountJournalLayout: LAYOUT,
  });
  const readers = createAccountReaders({ db: f.db });
  const adapters = createAccountAdapters({
    repository,
    clock,
    receiptSecret: 'local_test_secret',
    readAccount: readAccount === undefined ? readers.readAccount : readAccount,
  });
  const rows = (collection) =>
    Object.entries(f.inspect())
      .filter(([key]) => key.startsWith(collection + ':'))
      .map(([, row]) => row);
  const accountWrites = () =>
    f.calls.filter(
      (call) =>
        call.collection === 'accounts' &&
        ['add', 'update', 'set', 'remove'].includes(call.operation),
    );
  return { f, repository, readers, adapters, rows, accountWrites };
}

const legacySeed = {
  ['accounts:account_legacy']: {
    _id: 'account_legacy',
    openid: LEGACY,
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
};

test('JF01-A01 a repeat trusted entry reuses one account row', async () => {
  const { adapters, rows, accountWrites } = world();
  const first = await adapters.resolveAccount(ALPHA);
  const second = await adapters.resolveAccount(ALPHA);
  assert.equal(typeof first.id, 'string');
  assert.equal(first.status, 'active');
  assert.deepEqual(second, first);
  assert.equal(rows('accounts').length, 1);
  // One add for the first entry; the second entry only reads.
  assert.equal(accountWrites().filter((call) => call.operation === 'add').length, 1);
});

test('JF01-A02 a real Promise.all first entry leaves exactly one account', async () => {
  const { adapters, rows } = world();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => adapters.resolveAccount('trusted_openid_race')),
  );
  for (const result of results) {
    assert.equal(typeof result.id, 'string');
    assert.equal(result.id, results[0].id);
    assert.equal(result.status, 'active');
  }
  const accounts = rows('accounts');
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].openid, 'trusted_openid_race');
});

test('JF01-A03 a new account gets the declared journal layout and zero fences', async () => {
  const { adapters, rows } = world();
  const account = await adapters.resolveAccount(ALPHA);
  const row = rows('accounts').find((item) => item._id === account.id);
  assert.equal(row.status, 'active');
  assert.equal(row.openid, ALPHA);
  assert.equal(row.journalLayout, LAYOUT);
  assert.equal(row.journalRevision, 0);
  assert.equal(row.operationFence, 0);
  assert.equal(row.exportEpoch, 0);
  // Timestamps are server dates, never a client value.
  assert.equal(row.createdAt, '2026-10-20T00:00:00.000Z');
});

test('JF01-A04 a disabled legacy identity is passed through and never revived', async () => {
  const { adapters, rows, accountWrites } = world({
    seed: {
      ['accounts:account_disabled']: {
        _id: 'account_disabled',
        openid: LEGACY,
        status: 'disabled',
      },
    },
  });
  const account = await adapters.resolveAccount(LEGACY);
  assert.deepEqual(account, { id: 'account_disabled', status: 'disabled' });
  const preflight = await adapters.resolveAccountForJournal(LEGACY);
  assert.equal(preflight.status, 'disabled');
  assert.equal(preflight.journalReady, false);
  assert.equal(rows('accounts').length, 1);
  assert.equal(rows('accounts')[0].status, 'disabled');
  assert.deepEqual(accountWrites(), []);
});

test('JF01-A05 a legacy row without journalLayout is read, never migrated', async () => {
  const { adapters, rows, accountWrites } = world({ seed: legacySeed });
  const account = await adapters.resolveAccount(LEGACY);
  assert.deepEqual(account, { id: 'account_legacy', status: 'active' });
  const preflight = await adapters.resolveAccountForJournal(LEGACY);
  assert.deepEqual(preflight, {
    accountId: 'account_legacy',
    status: 'active',
    journalReady: false,
    journalLayout: null,
    journalRevision: null,
  });
  // No field was added and the row is byte-identical to the seed.
  assert.deepEqual(rows('accounts')[0], legacySeed['accounts:account_legacy']);
  assert.deepEqual(accountWrites(), []);
});

test('JF01-A06 an unwired unique index fails closed with NOT_IMPLEMENTED', async () => {
  const { adapters, rows, accountWrites } = world({ accountUniqueIndexReady: false });
  await assert.rejects(adapters.resolveAccount(ALPHA), { code: 'NOT_IMPLEMENTED' });
  assert.deepEqual(rows('accounts'), []);
  assert.deepEqual(accountWrites(), []);
});

test('JF01-A07 an empty or non-string openid never touches the store', async () => {
  const { adapters, f } = world();
  for (const value of ['', null, undefined, 42, {}]) {
    assert.equal(await adapters.resolveAccount(value), null);
  }
  assert.deepEqual(f.calls, []);
});

test('JF01-A08 the journal preflight reports readiness for a stored layout', async () => {
  const { adapters, rows } = world();
  const preflight = await adapters.resolveAccountForJournal(ALPHA);
  assert.equal(preflight.status, 'active');
  assert.equal(preflight.journalReady, true);
  assert.equal(preflight.journalLayout, JOURNAL_LAYOUT);
  assert.equal(preflight.journalRevision, 0);
  const again = await adapters.resolveAccountForJournal(ALPHA);
  assert.deepEqual(again, preflight);
  assert.equal(rows('accounts').length, 1);
});

test('JF01-A09 without a row reader the preflight fails closed instead of guessing', async () => {
  const { adapters } = world({ readAccount: null });
  const preflight = await adapters.resolveAccountForJournal(ALPHA);
  assert.equal(preflight.journalReady, false);
  assert.equal(preflight.journalLayout, null);
  assert.equal(preflight.journalRevision, null);
});

test('JF01-A10 the adapters plug straight into the router as its three seams', async () => {
  const { adapters, rows } = world();
  const router = createRouter({
    resolveAccount: adapters.resolveAccount,
    resolveOperatorRoles: adapters.resolveOperatorRoles,
    resolveCleanupReceipt: adapters.resolveCleanupReceipt,
  });
  const request = (action, payload = {}) => ({
    apiVersion: '1',
    requestId: 'req_w3_jf01_001',
    action,
    payload,
  });
  // A private action provisions the account first and then reaches the unwired
  // journal stub, which must still answer NOT_IMPLEMENTED.
  const denied = await router(request('journal.get', { date: '2026-10-29' }), { OPENID: ALPHA });
  assert.equal(denied.ok, false);
  assert.deepEqual(
    rows('accounts').map((row) => row.openid),
    [ALPHA],
  );
  // Operator roles stay behind the injected seam: no local grant.
  const operator = await router(request('admin.updatePlace', { placeId: 'synthetic' }), {
    OPENID: ALPHA,
  });
  assert.equal(operator.error.code, 'NOT_IMPLEMENTED');
});

test('JF01-A11 operator roles are injected, never granted locally', async () => {
  const { f } = world();
  const repository = createRepository({
    db: f.db,
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
  });
  const granted = createAccountAdapters({
    repository,
    clock,
    resolveOperatorRoles: async () => ['data_operator'],
  });
  assert.deepEqual(await granted.resolveOperatorRoles('account_x'), ['data_operator']);
  const failClosed = createAccountAdapters({ repository, clock });
  await assert.rejects(failClosed.resolveOperatorRoles('account_x'), {
    code: 'NOT_IMPLEMENTED',
  });
  assert.throws(() => createAccountAdapters({}), TypeError);
});

test('JF01-A12 the receipt seam verifies its own job and fails closed without a secret', async () => {
  const { adapters, f } = world();
  const token = adapters.issueCleanupReceipt({ jobId: 'cleanup_synthetic' });
  assert.equal(typeof token, 'string');
  assert.deepEqual(await adapters.resolveCleanupReceipt(token), {
    permission: 'cleanup_status',
    jobId: 'cleanup_synthetic',
  });
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  assert.equal(
    await adapters.resolveCleanupReceipt([parts[0], parts[1], 'tampered'].join('.')),
    null,
  );

  const repository = createRepository({
    db: f.db,
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
  });
  const unkeyed = createAccountAdapters({ repository, clock, receiptSecret: null, env: {} });
  assert.equal(unkeyed.issueCleanupReceipt({ jobId: 'cleanup_synthetic' }), null);
  assert.equal(await unkeyed.resolveCleanupReceipt(token), null);
});
