// W2 JF03 - account.preferences (W1 proposal P1: payload.operation = get | set).
// Owner: Jiawei Fang (w2-account). Reviewer: Xiang Hong. Field owners: Linghan Chen.
// Every value below is a synthetic local double; no real account or cloud row is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createIdentityServices } = require('../cloudfunctions/moodsky/identity');
const { createAccountStore } = require('../cloudfunctions/moodsky/stores/account-store');
const { createAccountDomain } = require('../cloudfunctions/moodsky/services/account-candidate');
const { ACCOUNT_STATUS, DEFAULT_PREFERENCES } = require('../miniprogram/shared/constants');

const ALPHA = 'trusted_openid_alpha';
const BETA = 'trusted_openid_beta';
const FIXED_NOW = new Date('2026-10-24T02:00:00.000Z');
const PRIVATE_ACTION = 'account.preferences';

const request = (payload = {}, requestId = 'req_week2_preferences_001') => ({
  apiVersion: '1',
  requestId,
  action: PRIVATE_ACTION,
  payload,
});

function createRoute({ store = createAccountStore(), clock = () => FIXED_NOW } = {}) {
  const identity = createIdentityServices({ store, clock, receiptSecret: 'local_test_secret' });
  const router = createRouter({
    resolveAccount: identity.resolveAccount,
    resolveOperatorRoles: identity.resolveOperatorRoles,
    resolveCleanupReceipt: identity.resolveCleanupReceipt,
    domainHandlers: {
      account: createAccountDomain({
        store,
        clock,
        issueCleanupReceipt: identity.issueCleanupReceipt,
      }).handle,
    },
  });
  return {
    store,
    call: (payload, openid = ALPHA) => router(request(payload), { OPENID: openid }),
  };
}

test('JF03-P01 get without a stored row returns the shared defaults and writes nothing', async () => {
  const route = createRoute();
  const result = await route.call({ operation: 'get' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { ...DEFAULT_PREFERENCES, updatedAt: null });
  assert.equal(route.store.rows.preferences.length, 0);
  assert.equal(route.store.calls.filter((call) => call.op === 'updatePreferences').length, 0);
});

test('JF03-P02 set stores both booleans and a later get returns the saved values', async () => {
  const route = createRoute();
  const saved = await route.call({
    operation: 'set',
    cardTextPreview: true,
    decorationsEnabled: false,
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data, {
    cardTextPreview: true,
    decorationsEnabled: false,
    updatedAt: FIXED_NOW.toISOString(),
  });
  const read = await route.call({ operation: 'get' });
  assert.deepEqual(read.data, saved.data);
  assert.equal(route.store.rows.preferences.length, 1);
  assert.equal(route.store.rows.preferences[0].cardTextPreview, true);
  assert.equal(route.store.rows.preferences[0].decorationsEnabled, false);
});

test('JF03-P03 a partial set keeps the other field at its default', async () => {
  const route = createRoute();
  const saved = await route.call({ operation: 'set', cardTextPreview: true });
  assert.equal(saved.data.cardTextPreview, true);
  assert.equal(saved.data.decorationsEnabled, DEFAULT_PREFERENCES.decorationsEnabled);
  const later = await route.call({ operation: 'set', decorationsEnabled: false });
  assert.equal(later.data.cardTextPreview, true);
  assert.equal(later.data.decorationsEnabled, false);
});

test('JF03-P04 invalid preference input is rejected and never stored', async () => {
  const cases = [
    {},
    { operation: 'update' },
    { operation: 'set' },
    { operation: 'set', decorationsEnabled: 'false' },
    { operation: 'set', cardTextPreview: 0 },
    { operation: 'set', cardTextPreview: null },
    { operation: 'set', decorationsEnabled: [] },
    { operation: 'get', decorationsEnabled: true },
    { operation: 'get', theme: 'dark' },
    { operation: 'set', cardTextPreview: true, motionEnabled: true },
  ];
  for (const payload of cases) {
    const route = createRoute();
    const result = await route.call(payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(payload));
    assert.equal(route.store.rows.preferences.length, 0, JSON.stringify(payload));
    assert.equal(route.store.calls.filter((call) => call.op === 'updatePreferences').length, 0);
  }
});

test('JF03-P05 preferences are stored per account id, never from the payload', async () => {
  const route = createRoute();
  const alpha = await route.call({ operation: 'set', cardTextPreview: true }, ALPHA);
  assert.equal(alpha.ok, true);
  const beta = await route.call({ operation: 'get' }, BETA);
  assert.deepEqual(beta.data, { ...DEFAULT_PREFERENCES, updatedAt: null });

  const accounts = route.store.rows.accounts;
  assert.equal(accounts.length, 2);
  const alphaId = accounts.find((row) => row.openid === ALPHA).id;
  const betaId = accounts.find((row) => row.openid === BETA).id;
  assert.notEqual(alphaId, betaId);
  assert.equal(route.store.rows.preferences.length, 1);
  assert.equal(route.store.rows.preferences[0].ownerId, alphaId);
  assert.equal(route.store.rows.preferences[0].cardTextPreview, true);

  // A payload-supplied account id is a reserved identity field: rejected, not honoured.
  const spoof = await route.call({ operation: 'get', accountId: betaId }, ALPHA);
  assert.equal(spoof.error.code, 'INVALID_REQUEST');
});

test('JF03-P06 a disabled account is refused before any preference row is read', async () => {
  const store = createAccountStore({
    seed: { accounts: [{ openid: ALPHA, status: ACCOUNT_STATUS.DISABLED }] },
  });
  const route = createRoute({ store });
  const result = await route.call({ operation: 'get' });
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
  assert.equal(store.calls.filter((call) => call.op === 'getPreferences').length, 0);
});

test('JF03-P07 updatedAt follows the injected clock instead of the wall clock', async () => {
  let now = new Date('2026-10-24T02:00:00.000Z');
  const route = createRoute({ clock: () => now });
  const first = await route.call({ operation: 'set', cardTextPreview: true });
  assert.equal(first.data.updatedAt, '2026-10-24T02:00:00.000Z');
  now = new Date('2026-10-24T03:30:00.000Z');
  const second = await route.call({ operation: 'set', decorationsEnabled: false });
  assert.equal(second.data.updatedAt, '2026-10-24T03:30:00.000Z');
  assert.equal(route.store.rows.preferences.length, 1);
});

test('JF03-P08 two concurrent partial sets keep both fields and never misreport a value', async () => {
  const route = createRoute();
  // Both calls start before either write lands: a read-modify-write of the whole
  // row would drop one of the two fields.
  const [preview, decorations] = await Promise.all([
    route.call({ operation: 'set', cardTextPreview: true }),
    route.call({ operation: 'set', decorationsEnabled: false }),
  ]);
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(decorations.ok, true, JSON.stringify(decorations));

  const stored = route.store.rows.preferences[0];
  assert.equal(route.store.rows.preferences.length, 1);
  assert.equal(stored.cardTextPreview, true);
  assert.equal(stored.decorationsEnabled, false);

  // A response must never report a value the database did not keep. The field each
  // call actually wrote is asserted against the stored row...
  assert.equal(preview.data.cardTextPreview, stored.cardTextPreview);
  assert.equal(decorations.data.decorationsEnabled, stored.decorationsEnabled);
  // ...and the two responses combined (one written field from each) equal the row.
  // The other field of each response is the snapshot taken when that write landed,
  // so it is deliberately not compared with a value a later write may have changed.
  assert.deepEqual(
    {
      cardTextPreview: preview.data.cardTextPreview,
      decorationsEnabled: decorations.data.decorationsEnabled,
    },
    {
      cardTextPreview: stored.cardTextPreview,
      decorationsEnabled: stored.decorationsEnabled,
    },
  );

  const read = await route.call({ operation: 'get' });
  assert.deepEqual(read.data, {
    cardTextPreview: stored.cardTextPreview,
    decorationsEnabled: stored.decorationsEnabled,
    updatedAt: stored.updatedAt,
  });
});
