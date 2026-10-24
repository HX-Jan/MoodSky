// W2 JF04 - account.close and the receipt-gated account.cleanupStatus.
// Owner: Jiawei Fang (w2-account). Cleanup executor owner: Xiang Yu.
// Reviewer: Xiang Hong. Independent check: Qizhen Cai.
// Local doubles only: no real signing key, no cloud call and no cleanup worker.
// The cleanup state deliberately stays pending - nothing here claims completion.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const {
  createIdentityServices,
  RECEIPT_TTL_SECONDS,
} = require('../cloudfunctions/moodsky/identity');
const { createAccountStore } = require('../cloudfunctions/moodsky/stores/account-store');
const { createAccountDomain } = require('../cloudfunctions/moodsky/domains/account');
const { ACCOUNT_STATUS } = require('../miniprogram/shared/constants');

const ALPHA = 'trusted_openid_alpha';
const BETA = 'trusted_openid_beta';
const FIXED_NOW = new Date('2026-10-24T02:00:00.000Z');

const envelope = (action, payload, requestId) => ({
  apiVersion: '1',
  requestId,
  action,
  payload,
});

function createRoute({
  store = createAccountStore(),
  clock = () => FIXED_NOW,
  receiptSecret = 'local_test_secret',
  env = {},
} = {}) {
  const identity = createIdentityServices({ store, clock, receiptSecret, env });
  const router = createRouter(
    {
      resolveAccount: identity.resolveAccount,
      resolveOperatorRoles: identity.resolveOperatorRoles,
      resolveCleanupReceipt: identity.resolveCleanupReceipt,
    },
    {
      account: createAccountDomain({
        store,
        clock,
        issueCleanupReceipt: identity.issueCleanupReceipt,
      }),
    },
  );
  return {
    store,
    callAction: (action, payload, context, requestId) =>
      router(envelope(action, payload, requestId), context),
    callClose: (payload, context = { OPENID: ALPHA }, requestId = 'req_week2_close_001') =>
      router(envelope('account.close', payload, requestId), context),
    callStatus: (payload, context = {}, requestId = 'req_week2_status_001') =>
      router(envelope('account.cleanupStatus', payload, requestId), context),
  };
}

// Wraps the memory store so exactly one status write fails, which is the
// recoverable boundary this test is about.
function createFailingStore(store) {
  let remaining = 1;
  const wrapped = Object.create(store);
  wrapped.setAccountStatus = async (...args) => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error('synthetic write failure');
    }
    return store.setAccountStatus(...args);
  };
  return wrapped;
}

// Wraps the memory store so exactly one cleanup-job insert fails, which is the
// other recoverable boundary: nothing is written and the account stays active.
function createJobFailingStore(store) {
  let remaining = 1;
  const wrapped = Object.create(store);
  wrapped.insertCleanupJob = async (job) => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error('synthetic job write failure');
    }
    return store.insertCleanupJob(job);
  };
  return wrapped;
}

test('JF04-C01 close requires an explicit confirm word and rejects unknown fields', async () => {
  for (const payload of [
    {},
    { confirm: 'close' },
    { confirm: 'DELETE' },
    { confirm: 'CLOSE', jobId: 'cleanup_x' },
  ]) {
    const route = createRoute();
    const result = await route.callClose(payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(payload));
    assert.equal(route.store.rows.cleanupJobs.length, 0);
    assert.equal(route.store.rows.accounts[0].status, ACCOUNT_STATUS.ACTIVE);
  }
});

test('JF04-C02 close disables the account, opens one pending job and returns a receipt', async () => {
  const route = createRoute();
  const result = await route.callClose({ confirm: 'CLOSE' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(Object.keys(result.data).sort(), [
    'accountStatus',
    'cleanup',
    'privateActionsDenied',
    'receipt',
    'sessionRevocation',
    'sessionRevoked',
  ]);
  assert.equal(result.data.accountStatus, ACCOUNT_STATUS.DISABLED);
  // No session/token table exists, so no token is revoked: the contract must not
  // claim one was. What holds is that every private action is refused.
  assert.equal(result.data.sessionRevoked, false);
  assert.equal(result.data.sessionRevocation, 'not_implemented');
  assert.equal(result.data.privateActionsDenied, true);
  assert.equal(typeof result.data.receipt, 'string');
  assert.ok(result.data.receipt.length > 0);
  assert.equal(result.data.cleanup.state, 'pending');

  const account = route.store.rows.accounts[0];
  const job = route.store.rows.cleanupJobs[0];
  assert.equal(account.status, ACCOUNT_STATUS.DISABLED);
  assert.equal(route.store.rows.cleanupJobs.length, 1);
  assert.equal(job.id, result.data.cleanup.jobId);
  assert.equal(job.state, 'pending');
  // The job owner comes from the router actor, not from the payload.
  assert.equal(job.ownerId, account.id);
});

test('JF04-C03 a repeated close is refused as a disabled account and opens no second job', async () => {
  const route = createRoute();
  const first = await route.callClose({ confirm: 'CLOSE' });
  assert.equal(first.ok, true);
  const second = await route.callClose(
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_week2_close_002',
  );
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'ACCOUNT_DISABLED');
  assert.equal(route.store.rows.cleanupJobs.length, 1);
  assert.equal(route.store.rows.cleanupJobs[0].id, first.data.cleanup.jobId);
  assert.equal(route.store.rows.requestReceipts.length, 1);
});

test('JF04-C04 a failed disable marks the job failed, keeps the account active and is retryable', async () => {
  const store = createAccountStore();
  const route = createRoute({ store: createFailingStore(store) });
  const failed = await route.callClose({ confirm: 'CLOSE' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'CONFLICT');
  assert.equal(store.rows.accounts[0].status, ACCOUNT_STATUS.ACTIVE);
  assert.equal(store.rows.cleanupJobs.length, 1);
  assert.equal(store.rows.cleanupJobs[0].state, 'failed');
  assert.equal(store.rows.requestReceipts.length, 0);

  const retry = await route.callClose(
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_week2_close_retry_001',
  );
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(store.rows.accounts[0].status, ACCOUNT_STATUS.DISABLED);
  const open = store.rows.cleanupJobs.filter(
    (job) => job.state === 'pending' || job.state === 'processing',
  );
  // Invariant: a disabled account always has exactly one recoverable job.
  assert.equal(open.length, 1);
  assert.equal(open[0].id, retry.data.cleanup.jobId);
  assert.equal(store.rows.cleanupJobs.length, 2);
  assert.equal(store.rows.cleanupJobs[0].state, 'failed');
});

test('JF04-C05 without a signing secret close issues no receipt and progress stays forbidden', async () => {
  // null (not undefined) keeps the empty-env override; the factory default would
  // otherwise supply a secret and hide the fail-closed branch.
  const route = createRoute({ receiptSecret: null, env: {} });
  const closed = await route.callClose({ confirm: 'CLOSE' });
  assert.equal(closed.ok, true);
  assert.equal(closed.data.receipt, null);
  const jobId = closed.data.cleanup.jobId;
  const denied = await route.callStatus({ jobId, receipt: 'v1.synthetic.signature' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'FORBIDDEN');
});

test('JF04-C06 a valid receipt reads only its own job and never the account', async () => {
  const route = createRoute();
  const closed = await route.callClose({ confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  const before = route.store.calls.length;
  const status = await route.callStatus({ jobId, receipt: closed.data.receipt });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.deepEqual(Object.keys(status.data).sort(), ['createdAt', 'jobId', 'state', 'updatedAt']);
  assert.equal(status.data.jobId, jobId);
  assert.equal(status.data.state, 'pending');
  assert.equal(status.data.createdAt, FIXED_NOW.toISOString());
  const after = route.store.calls.slice(before).map((call) => call.op);
  assert.deepEqual(after, ['getCleanupJob']);
});

test('JF04-C07 progress without a receipt is forbidden and never touches the store', async () => {
  const route = createRoute();
  const result = await route.callStatus({ jobId: 'cleanup_1' });
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.deepEqual(route.store.calls, []);
});

test('JF04-C08 a receipt issued for another permission is refused', async () => {
  const store = createAccountStore({
    seed: { accounts: [{ openid: ALPHA, status: ACCOUNT_STATUS.ACTIVE }] },
  });
  const router = createRouter(
    {
      resolveAccount: async () => ({ id: 'account_synthetic', status: ACCOUNT_STATUS.ACTIVE }),
      resolveCleanupReceipt: async () => ({ permission: 'export_download', jobId: 'cleanup_1' }),
    },
    {
      account: createAccountDomain({
        store,
        clock: () => FIXED_NOW,
        issueCleanupReceipt: () => 'synthetic',
      }),
    },
  );
  const result = await router(
    envelope('account.cleanupStatus', { jobId: 'cleanup_1', receipt: 'x' }, 'req_week2_perm_001'),
    {},
  );
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.deepEqual(store.calls, []);
});

test('JF04-C09 a tampered receipt is refused while the original still works', async () => {
  const route = createRoute();
  const closed = await route.callClose({ confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  const token = closed.data.receipt;
  const parts = token.split('.');
  assert.equal(parts.length, 3);

  assert.equal((await route.callStatus({ jobId, receipt: token })).ok, true);

  const lastCharacter = parts[2].slice(-1);
  const flipped = lastCharacter === 'A' ? 'B' : 'A';
  const badSignature = [parts[0], parts[1], parts[2].slice(0, -1) + flipped].join('.');
  assert.equal((await route.callStatus({ jobId, receipt: badSignature })).error.code, 'FORBIDDEN');

  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  claims.j = 'cleanup_someone_else';
  const forgedSegment = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const forgedPayload = [parts[0], forgedSegment, parts[2]].join('.');
  assert.equal((await route.callStatus({ jobId, receipt: forgedPayload })).error.code, 'FORBIDDEN');
});

test('JF04-C10 an expired receipt is refused', async () => {
  let now = new Date(FIXED_NOW.getTime());
  const route = createRoute({ clock: () => now });
  const closed = await route.callClose({ confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  assert.equal((await route.callStatus({ jobId, receipt: closed.data.receipt })).ok, true);
  now = new Date(now.getTime() + RECEIPT_TTL_SECONDS * 1000);
  assert.equal(
    (await route.callStatus({ jobId, receipt: closed.data.receipt })).error.code,
    'FORBIDDEN',
  );
});

test('JF04-C11 a receipt for another job is refused without leaking that job', async () => {
  const route = createRoute();
  const alpha = await route.callClose(
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_week2_close_a01',
  );
  const beta = await route.callClose({ confirm: 'CLOSE' }, { OPENID: BETA }, 'req_week2_close_b01');
  assert.equal(alpha.ok, true);
  assert.equal(beta.ok, true);
  const alphaJob = alpha.data.cleanup.jobId;
  const betaJob = beta.data.cleanup.jobId;
  assert.notEqual(alphaJob, betaJob);

  const mismatched = await route.callStatus({ jobId: betaJob, receipt: alpha.data.receipt });
  assert.equal(mismatched.error.code, 'FORBIDDEN');
  assert.equal(mismatched.data, undefined);
  assert.doesNotMatch(JSON.stringify(mismatched), /cleanup_[0-9]|pending|disabled/);
});

test('JF04-C12 a receipt is never a login and never revives the disabled account', async () => {
  const route = createRoute();
  const closed = await route.callClose({ confirm: 'CLOSE' });
  const receipt = closed.data.receipt;
  for (const action of [
    'account.preferences',
    'account.requestExport',
    'journal.get',
    'account.close',
  ]) {
    const result = await route.callAction(action, { receipt }, {}, 'req_week2_receipt_login_001');
    assert.equal(result.error.code, 'UNAUTHENTICATED', action);
  }
  const revived = await route.callClose(
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_week2_close_revive_01',
  );
  assert.equal(revived.error.code, 'ACCOUNT_DISABLED');
});

test('JF04-C13 the export entries stay unimplemented for an active account', async () => {
  const route = createRoute();
  for (const action of [
    'account.requestExport',
    'account.exportStatus',
    'account.downloadExport',
  ]) {
    const result = await route.callAction(action, {}, { OPENID: ALPHA }, 'req_week2_export_001');
    assert.equal(result.error.code, 'NOT_IMPLEMENTED', action);
  }
});

test('JF04-C14 cleanup is never reported as completed while the executor is unwired', async () => {
  const route = createRoute();
  const closed = await route.callClose({ confirm: 'CLOSE' });
  const jobId = closed.data.cleanup.jobId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const status = await route.callStatus({ jobId, receipt: closed.data.receipt });
    assert.equal(status.ok, true);
    assert.equal(status.data.state, 'pending');
    assert.doesNotMatch(JSON.stringify(status), /completed/);
  }
  assert.equal(route.store.rows.cleanupJobs[0].state, 'pending');
});

test('JF04-C15 the domain replays one close request id instead of opening a second job', async () => {
  // Domain-level: the router answers a repeat close with ACCOUNT_DISABLED first,
  // so this exercises the replay branch the recovery path will use.
  const store = createAccountStore({
    seed: { accounts: [{ openid: ALPHA, status: ACCOUNT_STATUS.ACTIVE }] },
  });
  const clock = () => FIXED_NOW;
  const identity = createIdentityServices({ store, clock, receiptSecret: 'local_test_secret' });
  const domain = createAccountDomain({
    store,
    clock,
    issueCleanupReceipt: identity.issueCleanupReceipt,
  });
  const accountId = store.rows.accounts[0].id;
  const call = () =>
    domain.handle({
      action: 'account.close',
      payload: { confirm: 'CLOSE' },
      actor: { accountId },
      requestId: 'req_week2_close_replay_001',
    });
  const first = await call();
  const second = await call();
  assert.deepEqual(second, first);
  assert.equal(store.rows.cleanupJobs.length, 1);
});

test('JF04-C16 a failed cleanup-job insert stays retryable and leaves the account active', async () => {
  const store = createAccountStore();
  const route = createRoute({ store: createJobFailingStore(store) });
  const failed = await route.callClose({ confirm: 'CLOSE' });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'CONFLICT');
  assert.equal(failed.error.message, '注销暂未完成，请重试。');
  // Nothing was written: no job, no receipt, and the account was never disabled.
  assert.equal(store.rows.accounts[0].status, ACCOUNT_STATUS.ACTIVE);
  assert.equal(store.rows.cleanupJobs.length, 0);
  assert.equal(store.rows.requestReceipts.length, 0);
  assert.equal(store.calls.filter((call) => call.op === 'setAccountStatus').length, 0);

  const retry = await route.callClose(
    { confirm: 'CLOSE' },
    { OPENID: ALPHA },
    'req_week2_close_job_retry_01',
  );
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(store.rows.accounts[0].status, ACCOUNT_STATUS.DISABLED);
  assert.equal(store.rows.cleanupJobs.length, 1);
  assert.equal(store.rows.cleanupJobs[0].state, 'pending');
});
