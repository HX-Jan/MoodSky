// W3 JF03 - preferences contract between the shipped client request builder and
// the trusted server candidate. Local doubles only: no cloud, no real account.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createIdentityServices } = require('../cloudfunctions/moodsky/identity');
const { createAccountStore } = require('../cloudfunctions/moodsky/stores/account-store');
const { createAccountDomain } = require('../cloudfunctions/moodsky/services/account-candidate');
const accountService = require('../miniprogram/modules/account/service');

const FIXED_NOW = new Date('2026-10-30T02:00:00.000Z');
const clock = () => FIXED_NOW;
const ALPHA = 'trusted_openid_alpha';
const BETA = 'trusted_openid_beta';

function world({ seed } = {}) {
  const store = createAccountStore({
    seed: seed || {
      accounts: [
        { openid: ALPHA, status: 'active' },
        { openid: BETA, status: 'active' },
      ],
    },
  });
  const identity = createIdentityServices({ store, clock, receiptSecret: 'local_test_secret' });
  const domain = createAccountDomain({ store, clock, issueCleanupReceipt: () => null });
  const router = createRouter({
    resolveAccount: identity.resolveAccount,
    resolveOperatorRoles: identity.resolveOperatorRoles,
    resolveCleanupReceipt: identity.resolveCleanupReceipt,
    domainHandlers: { account: domain.handle },
  });
  return { store, router };
}

// The request is built by the real client helper so the contract covers the
// shipped apiVersion/requestId/envelope, not a hand-written imitation.
const send = (router, openid, payload) =>
  router(accountService.createPreferencesRequest(payload), { OPENID: openid });

test('P01 a fresh trusted account reads the shared defaults through the client envelope', async () => {
  const { router } = world();
  const result = await send(router, ALPHA, { operation: 'get' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data, {
    cardTextPreview: false,
    decorationsEnabled: true,
    updatedAt: null,
  });
});

test('P02 a partial set persists and the next read echoes the stored value', async () => {
  const { router, store } = world();
  const saved = await send(router, ALPHA, { operation: 'set', cardTextPreview: true });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.data.cardTextPreview, true);
  assert.equal(saved.data.decorationsEnabled, true);
  const read = await send(router, ALPHA, { operation: 'get' });
  assert.equal(read.data.cardTextPreview, true);
  assert.equal(store.rows.preferences.length, 1);
});

test('P03 the response reflects only the field that actually landed', async () => {
  const { router, store } = world();
  const result = await send(router, ALPHA, { operation: 'set', decorationsEnabled: false });
  assert.equal(result.data.cardTextPreview, false);
  assert.equal(result.data.decorationsEnabled, false);
  const row = store.rows.preferences[0];
  assert.equal(row.cardTextPreview, false);
  assert.equal(row.decorationsEnabled, false);
});

test('P04 invalid shapes are rejected before anything is stored', async () => {
  const { router, store } = world();
  for (const payload of [
    {},
    { operation: 'delete' },
    { operation: 'set' },
    { operation: 'set', cardTextPreview: 'yes' },
    { operation: 'set', decorationsEnabled: 1 },
    { operation: 'set', cardTextPreview: true, nickname: 'x' },
  ]) {
    const result = await send(router, ALPHA, payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(payload));
  }
  assert.deepEqual(store.rows.preferences, []);
});

test('P05 a disabled account cannot read or write preferences', async () => {
  const { router } = world({
    seed: { accounts: [{ openid: ALPHA, status: 'disabled' }] },
  });
  for (const payload of [{ operation: 'get' }, { operation: 'set', cardTextPreview: true }]) {
    const result = await send(router, ALPHA, payload);
    assert.equal(result.error.code, 'ACCOUNT_DISABLED');
  }
});

test('P06 two trusted accounts never see each other preferences', async () => {
  const { router } = world();
  await send(router, ALPHA, { operation: 'set', cardTextPreview: true });
  await send(router, BETA, { operation: 'set', decorationsEnabled: false });
  const alpha = await send(router, ALPHA, { operation: 'get' });
  const beta = await send(router, BETA, { operation: 'get' });
  assert.deepEqual([alpha.data.cardTextPreview, alpha.data.decorationsEnabled], [true, true]);
  assert.deepEqual([beta.data.cardTextPreview, beta.data.decorationsEnabled], [false, false]);
});

test('P07 the client request id is echoed and identity fields never build a request', async () => {
  const { router } = world();
  const request = accountService.createPreferencesRequest({ operation: 'get' });
  const result = await router(request, { OPENID: ALPHA });
  assert.equal(result.requestId, request.requestId);
  assert.equal(request.apiVersion, '1');
  assert.throws(
    () => accountService.createPreferencesRequest({ operation: 'get', ownerId: 'other' }),
    { code: 'INVALID_REQUEST' },
  );
});

test('P08 the client close and progress helpers match the server contract', async () => {
  const { router } = world();
  const close = accountService.createClosureRequest();
  assert.equal(close.action, 'account.close');
  assert.equal(close.payload.confirm, 'CLOSE');
  const closed = await router(close, { OPENID: ALPHA });
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.data.accountStatus, 'disabled');
  assert.equal(closed.data.cleanup.state, 'pending');

  // cleanupStatus() dispatches through api.call, which needs a cloud environment.
  // Capture the request it would send instead of performing a network call.
  const api = require('../miniprogram/services/api');
  const originalCall = api.call;
  let captured = null;
  api.call = async (request) => {
    captured = request;
    return { ok: true, data: {} };
  };
  try {
    await accountService.cleanupStatus(closed.data.cleanup.jobId, closed.data.receipt);
  } finally {
    api.call = originalCall;
  }
  assert.equal(captured.action, 'account.cleanupStatus');
  assert.equal(captured.payload.jobId, closed.data.cleanup.jobId);
  assert.equal(captured.payload.receipt, closed.data.receipt);
});
