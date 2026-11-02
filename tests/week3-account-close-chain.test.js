// W3 JF04 - executable close chain, restrictively-gated cleanup progress and the
// cleanup/export seams. Owner: Jiawei Fang (w3-account). Cleanup executor owner:
// Xiang Yu. Reviewer: Xiang Hong. Independent check: Qizhen Cai.
// Local synthetic database only: no cloud, no signing key, no cleanup worker and
// no export file. A pending job here is NOT evidence that anything was deleted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const { createCleanupService } = require('../cloudfunctions/moodsky/domains/cleanup');
const {
  createAccountAdapters,
  createAccountReaders,
} = require('../cloudfunctions/moodsky/services/account-adapters');
const { createAccountDomain } = require('../cloudfunctions/moodsky/services/account-candidate');
const { createAccountStore } = require('../cloudfunctions/moodsky/stores/account-store');
const {
  createAccountTransactions,
} = require('../cloudfunctions/moodsky/stores/account-transaction');
const { databaseFixture } = require('./helpers/w2-database');

const ALPHA = 'trusted_openid_alpha';
const BETA = 'trusted_openid_beta';
const ALPHA_ID = 'account_alpha';
const BETA_ID = 'account_beta';
const LAYOUT = 'deterministic-days-v1';
const FIXED_NOW = new Date('2026-10-29T02:00:00.000Z');
const clock = () => FIXED_NOW;
const RECEIPT_SECRET = 'local_test_secret';

const accountRow = (id, openid) => ({
  _id: id,
  openid,
  status: 'active',
  journalLayout: LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
});

const seed = () => ({
  ['accounts:' + ALPHA_ID]: accountRow(ALPHA_ID, ALPHA),
  ['accounts:' + BETA_ID]: accountRow(BETA_ID, BETA),
});

function guardTransactions(db) {
  const guardCollection = (collection) =>
    new Proxy(collection, {
      get(target, property) {
        if (property === 'where') {
          return () => {
            throw new Error('where() is not supported inside a cloud transaction');
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const guardTransaction = (tx) =>
    new Proxy(tx, {
      get(target, property) {
        if (property === 'collection') {
          return (name) => guardCollection(target.collection(name));
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  return {
    ...db,
    runTransaction: (work) => db.runTransaction((tx) => work(guardTransaction(tx))),
  };
}

function createWorld({ fail, forbidWhere = false, accountRows } = {}) {
  const initial = accountRows || seed();
  const f = databaseFixture(initial, { fail });
  const repository = createRepository({
    db: f.db,
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
  });
  const readers = createAccountReaders({ db: f.db });
  // Present only so the W2 constructor contract is unchanged; the W3 close path
  // must never write through it, which the tests assert with store.calls.
  const store = createAccountStore();
  const adapters = createAccountAdapters({
    repository,
    store,
    clock,
    receiptSecret: RECEIPT_SECRET,
    readAccount: readers.readAccount,
  });
  const domain = createAccountDomain({
    store,
    clock,
    issueCleanupReceipt: adapters.issueCleanupReceipt,
    transactions: createAccountTransactions(forbidWhere ? guardTransactions(f.db) : f.db),
    readCleanupJob: readers.readCleanupJob,
  });
  const router = createRouter({
    resolveAccount: adapters.resolveAccount,
    resolveOperatorRoles: adapters.resolveOperatorRoles,
    resolveCleanupReceipt: adapters.resolveCleanupReceipt,
    domainHandlers: { account: domain.handle },
  });
  const rows = (collection) =>
    Object.entries(f.inspect())
      .filter(([key]) => key.startsWith(collection + ':'))
      .map(([, row]) => row);
  const row = (collection, id) => f.inspect()[collection + ':' + id] || null;
  const call = (action, payload, context = { OPENID: ALPHA }, requestId = 'req_w3_jf04_001') =>
    router({ apiVersion: '1', requestId, action, payload }, context);
  return { f, store, adapters, domain, router, rows, row, call };
}

test('JF04-C01 close writes a guard-ready job and disables the account in one transaction', async () => {
  const world = createWorld();
  const result = await world.call('account.close', { confirm: 'CLOSE' });
  assert.equal(result.ok, true, JSON.stringify(result));
  const jobId = result.data.cleanup.jobId;
  assert.match(jobId, /^[a-f0-9]{32}$/);
  assert.equal(result.data.cleanup.state, 'pending');
  assert.equal(result.data.accountStatus, 'disabled');
  assert.equal(typeof result.data.receipt, 'string');
  assert.equal(result.data.sessionRevoked, false);
  assert.equal(result.data.privateActionsDenied, true);

  const job = world.row('cleanup_jobs', jobId);
  assert.equal(job.ownerId, ALPHA_ID);
  assert.equal(job.state, 'pending');
  // The three fields domains/cleanup.js guards on.
  assert.equal(job.exportAccessRevoked, true);
  assert.deepEqual(job.progress, {});
  assert.equal(job.createdAt, FIXED_NOW.toISOString());

  const account = world.row('accounts', ALPHA_ID);
  assert.equal(account.status, 'disabled');
  // Both lifecycle fences advance in the same commit (domains/export.js reads them).
  assert.equal(account.operationFence, 1);
  assert.equal(account.exportEpoch, 1);
  // The transactional path did not fall back to the W2 store.
  assert.deepEqual(world.store.calls, []);
  assert.deepEqual(world.rows('cleanup_jobs').length, 1);
});

test('JF04-C02 cleanupStatus reports only the receipt-bound pending job', async () => {
  const world = createWorld();
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const status = await world.call(
      'account.cleanupStatus',
      { jobId, receipt: closed.data.receipt },
      {},
      'req_w3_jf04_status_00' + attempt,
    );
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.data.jobId, jobId);
    assert.equal(status.data.state, 'pending');
    // No fabricated counters and no percentage while nothing has been deleted.
    assert.deepEqual(status.data.progress, {});
    assert.doesNotMatch(JSON.stringify(status), /completed|percentage|totalDeleted/);
  }
});

test('JF04-C03 the close-written job satisfies the domains/cleanup.js guard', async () => {
  const world = createWorld();
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  const service = createCleanupService({ db: world.f.db });
  // preferences is a guard-checked collection that is not blocked by the journal
  // layout note; zero rows deleted proves the guard accepted the job, not that a
  // cleanup ran. (The journal collection stays NOT_IMPLEMENTED on this layout.)
  const deleted = await service.cleanupByOwnerId('preferences', ALPHA_ID, {
    jobId: closed.data.cleanup.jobId,
    batchSize: 1,
  });
  assert.equal(deleted, 0);
  await assert.rejects(
    service.cleanupByOwnerId('journals', ALPHA_ID, {
      jobId: closed.data.cleanup.jobId,
      batchSize: 1,
    }),
    { code: 'NOT_IMPLEMENTED' },
  );
});

test('JF04-C04 a repeated close opens no second job', async () => {
  const world = createWorld();
  const first = await world.call('account.close', { confirm: 'CLOSE' });
  assert.equal(first.ok, true);
  const second = await world.call(
    'account.close',
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_w3_jf04_002',
  );
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'ACCOUNT_DISABLED');
  assert.equal(world.rows('cleanup_jobs').length, 1);
  assert.equal(world.rows('cleanup_jobs')[0]._id, first.data.cleanup.jobId);
  assert.equal(world.row('accounts', ALPHA_ID).status, 'disabled');
});

test('JF04-C05 a failed disable rolls the job back and leaves the account active', async () => {
  let failures = 1;
  const world = createWorld({
    fail: ({ operation, collection }) => {
      if (operation === 'update' && collection === 'accounts' && failures > 0) {
        failures -= 1;
        return true;
      }
      return false;
    },
  });
  const failed = await world.call('account.close', { confirm: 'CLOSE' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'CONFLICT');
  // Rolled back together: no job, active account, no half-closed state.
  assert.deepEqual(world.rows('cleanup_jobs'), []);
  const account = world.row('accounts', ALPHA_ID);
  assert.equal(account.status, 'active');
  assert.equal(account.operationFence, 0);
  assert.equal(account.exportEpoch, 0);

  const retry = await world.call(
    'account.close',
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_w3_jf04_retry_001',
  );
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(world.rows('cleanup_jobs').length, 1);
  assert.equal(world.row('accounts', ALPHA_ID).status, 'disabled');
});

test('JF04-C06 a failed job write rolls back before the account is disabled', async () => {
  let failures = 1;
  const world = createWorld({
    fail: ({ operation, collection }) => {
      if (operation === 'set' && collection === 'cleanup_jobs' && failures > 0) {
        failures -= 1;
        return true;
      }
      return false;
    },
  });
  const failed = await world.call('account.close', { confirm: 'CLOSE' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'CONFLICT');
  assert.equal(world.row('accounts', ALPHA_ID).status, 'active');
  assert.deepEqual(world.rows('cleanup_jobs'), []);

  const retry = await world.call(
    'account.close',
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_w3_jf04_retry_002',
  );
  assert.equal(retry.ok, true, JSON.stringify(retry));
  const job = world.rows('cleanup_jobs')[0];
  assert.equal(job.state, 'pending');
  assert.equal(job.exportAccessRevoked, true);
});

test('JF04-C07 without transactions the store path marks the job failed instead of rolling back', async () => {
  const store = createAccountStore({
    seed: { accounts: [{ id: ALPHA_ID, openid: ALPHA, status: 'active' }] },
  });
  let failures = 1;
  const wrapped = Object.create(store);
  wrapped.setAccountStatus = async (...args) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('synthetic disable failure');
    }
    return store.setAccountStatus(...args);
  };
  const domain = createAccountDomain({
    store: wrapped,
    clock,
    issueCleanupReceipt: () => null,
  });
  const request = (requestId) => ({
    action: 'account.close',
    payload: { confirm: 'CLOSE' },
    actor: { accountId: ALPHA_ID },
    requestId,
  });
  await assert.rejects(domain.handle(request('req_w3_jf04_store_001')), {
    code: 'CONFLICT',
    message: '注销暂未完成，请重试。',
  });
  // The W2 compensation: the account is still active and its job is marked failed.
  assert.equal(store.rows.accounts[0].status, 'active');
  assert.equal(store.rows.cleanupJobs.length, 1);
  assert.equal(store.rows.cleanupJobs[0].state, 'failed');

  const retry = await domain.handle(request('req_w3_jf04_store_002'));
  assert.equal(retry.accountStatus, 'disabled');
  assert.equal(store.rows.accounts[0].status, 'disabled');
  const open = store.rows.cleanupJobs.filter((job) =>
    ['pending', 'processing'].includes(job.state),
  );
  assert.equal(open.length, 1);
});

test('JF04-C08 a receipt only reads its own job and never leaks another one', async () => {
  const world = createWorld();
  const alpha = await world.call('account.close', { confirm: 'CLOSE' }, { OPENID: ALPHA });
  const beta = await world.call(
    'account.close',
    { confirm: 'CLOSE' },
    { OPENID: BETA },
    'req_w3_jf04_beta_001',
  );
  assert.equal(alpha.ok, true);
  assert.equal(beta.ok, true);
  assert.notEqual(alpha.data.cleanup.jobId, beta.data.cleanup.jobId);

  const crossed = await world.call(
    'account.cleanupStatus',
    { jobId: beta.data.cleanup.jobId, receipt: alpha.data.receipt },
    {},
    'req_w3_jf04_cross_001',
  );
  assert.equal(crossed.ok, false);
  assert.equal(crossed.error.code, 'FORBIDDEN');
  assert.equal(crossed.data, undefined);
  assert.doesNotMatch(JSON.stringify(crossed), new RegExp(beta.data.cleanup.jobId));

  const reversed = await world.call(
    'account.cleanupStatus',
    { jobId: alpha.data.cleanup.jobId, receipt: beta.data.receipt },
    {},
    'req_w3_jf04_cross_002',
  );
  assert.equal(reversed.error.code, 'FORBIDDEN');

  // Without any receipt the action is refused before the job is read.
  const bare = await world.call(
    'account.cleanupStatus',
    { jobId: alpha.data.cleanup.jobId },
    {},
    'req_w3_jf04_cross_003',
  );
  assert.equal(bare.error.code, 'FORBIDDEN');
});

test('JF04-C09 a receipt is never a login and a disabled account refuses private writes', async () => {
  const world = createWorld();
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  const receipt = closed.data.receipt;

  // The receipt never authenticates a private action, even with a valid jobId.
  const asLogin = await world.call(
    'account.preferences',
    { operation: 'get', receipt },
    {},
    'req_w3_jf04_login_001',
  );
  assert.equal(asLogin.error.code, 'UNAUTHENTICATED');

  for (const [action, payload] of [
    ['account.preferences', { operation: 'set', cardTextPreview: true }],
    ['journal.get', { date: '2026-10-29' }],
    ['tasks.mine', {}],
  ]) {
    const denied = await world.call(action, payload, { OPENID: ALPHA }, 'req_w3_jf04_deny_001');
    assert.equal(denied.ok, false, action);
    assert.equal(denied.error.code, 'ACCOUNT_DISABLED', action);
  }
  // Nothing private was written after the disable.
  assert.deepEqual(world.store.rows.preferences, []);
  assert.equal(world.row('accounts', ALPHA_ID).status, 'disabled');
});

test('JF04-C10 a stored completed row is reported as stored, an unknown state fails closed', async () => {
  const completed = createWorld();
  const closed = await completed.call('account.close', { confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  completed.f.put('cleanup_jobs', {
    _id: jobId,
    ownerId: ALPHA_ID,
    state: 'completed',
    exportAccessRevoked: true,
    progress: {},
  });
  const status = await completed.call(
    'account.cleanupStatus',
    { jobId, receipt: closed.data.receipt },
    {},
    'req_w3_jf04_state_001',
  );
  // The row exists and says completed: report that fact, never a percentage and
  // never a count this environment did not delete.
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.data.state, 'completed');
  assert.deepEqual(status.data.progress, {});
  assert.doesNotMatch(JSON.stringify(status), /percentage|totalDeleted|percent/);

  const unknown = createWorld();
  const closedUnknown = await unknown.call('account.close', { confirm: 'CLOSE' });
  unknown.f.put('cleanup_jobs', {
    _id: closedUnknown.data.cleanup.jobId,
    ownerId: ALPHA_ID,
    state: 'expired',
    exportAccessRevoked: true,
    progress: {},
  });
  const rejected = await unknown.call(
    'account.cleanupStatus',
    { jobId: closedUnknown.data.cleanup.jobId, receipt: closedUnknown.data.receipt },
    {},
    'req_w3_jf04_state_002',
  );
  assert.equal(rejected.error.code, 'CONFLICT');
  assert.equal(rejected.data, undefined);
});

test('JF04-C11 the stored per-collection progress is reported instead of an empty map', async () => {
  const world = createWorld();
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  world.f.put('cleanup_jobs', {
    _id: jobId,
    ownerId: ALPHA_ID,
    state: 'processing',
    exportAccessRevoked: true,
    progress: { task_history: 7, preferences: 2 },
  });
  const status = await world.call(
    'account.cleanupStatus',
    { jobId, receipt: closed.data.receipt },
    {},
    'req_w3_jf04_progress_001',
  );
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.deepEqual(status.data.progress, { task_history: 7, preferences: 2 });
});

test('JF04-C12 close never queries with where() inside the cloud transaction', async () => {
  // The local fixture tolerates where() in a transaction; the cloud platform does
  // not. This world throws if the close path ever issues one again.
  const world = createWorld({ forbidWhere: true });
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(world.row('accounts', ALPHA_ID).status, 'disabled');
  assert.equal(world.rows('cleanup_jobs').length, 1);
});

test('JF04-C13 a legacy account without a journal layout cannot be closed yet', async () => {
  const legacy = accountRow(ALPHA_ID, ALPHA);
  delete legacy.journalLayout;
  const world = createWorld({ accountRows: { ['accounts:' + ALPHA_ID]: legacy } });
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  assert.equal(closed.ok, false);
  assert.equal(closed.error.code, 'NOT_IMPLEMENTED');
  assert.equal(world.row('accounts', ALPHA_ID).status, 'active');
  assert.equal(world.rows('cleanup_jobs').length, 0);
});

test('JF04-C14 a retried close never overwrites a job the executor already advanced', async () => {
  const world = createWorld();
  // First close creates the deterministic job slot and disables the account.
  const closed = await world.call('account.close', { confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  // Simulate an executor that advanced the ledger, plus a recovery path that put
  // the account back to active (the router would otherwise answer ACCOUNT_DISABLED).
  world.f.put('cleanup_jobs', {
    _id: jobId,
    ownerId: ALPHA_ID,
    state: 'completed',
    exportAccessRevoked: true,
    progress: { task_history: 3 },
  });
  const account = world.row('accounts', ALPHA_ID);
  world.f.put('accounts', { ...account, status: 'active' });
  const outcome = await world.domain
    .handle({
      action: 'account.close',
      payload: { confirm: 'CLOSE' },
      actor: { accountId: ALPHA_ID },
      requestId: 'req_w3_jf04_advanced_job_001',
    })
    .then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, code: error.code }),
    );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'CONFLICT');
  const stored = world.f.inspect()['cleanup_jobs:' + jobId];
  assert.equal(stored.state, 'completed');
  assert.deepEqual(stored.progress, { task_history: 3 });
  assert.equal(world.row('accounts', ALPHA_ID).status, 'active');
});
