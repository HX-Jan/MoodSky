// W2 JF01 — provisioning through the trusted W2 repository (de4ed97).
// The repository owns account creation and its unique-index gate; these tests use
// a synthetic database with the same shape the W2 integration tests use.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const { createIdentityServices } = require('../cloudfunctions/moodsky/identity');
const { createAccountStore } = require('../cloudfunctions/moodsky/stores/account-store');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createAccountDomain } = require('../cloudfunctions/moodsky/domains/account');

const FIXED_NOW = new Date('2026-10-24T02:00:00.000Z');
const clock = () => FIXED_NOW;
const LAYOUT = 'deterministic-days-v1';

function syntheticDb({ rows = [], duplicateOnAdd = false } = {}) {
  const state = { rows: rows.map((row) => ({ ...row })), adds: 0, failedAdds: 0 };
  let serial = 0;
  const db = {
    config: { throwOnNotFound: false },
    runTransaction: async (run) => run({}),
    serverDate: () => FIXED_NOW,
    collection(name) {
      assert.equal(name, 'accounts');
      return {
        where(filter) {
          const matches = state.rows.filter((row) => row.openid === filter.openid);
          return {
            limit(size) {
              return { get: async () => ({ data: matches.slice(0, size) }) };
            },
          };
        },
        async add({ data }) {
          state.adds += 1;
          if (duplicateOnAdd || state.rows.some((row) => row.openid === data.openid)) {
            state.failedAdds += 1;
            throw new Error('DUPLICATE_KEY synthetic');
          }
          serial += 1;
          const row = { _id: 'account_' + serial, ...data };
          state.rows.push(row);
          return { _id: row._id };
        },
      };
    },
  };
  return { db, state };
}

function world({ rows = [], duplicateOnAdd = false, uniqueIndexReady = true } = {}) {
  const { db, state } = syntheticDb({ rows, duplicateOnAdd });
  const repository = createRepository({
    db,
    accountUniqueIndexReady: uniqueIndexReady,
    newAccountJournalLayout: LAYOUT,
    now: clock,
  });
  const store = createAccountStore();
  const identity = createIdentityServices({
    repository,
    store,
    clock,
    receiptSecret: 'local_test_secret',
  });
  return { repository, store, identity, state };
}

test('R01 first trusted entry provisions one account through the W2 repository', async () => {
  const { identity, state } = world();
  const created = await identity.resolveAccount('trusted_openid_alpha');
  assert.equal(created.status, 'active');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].openid, 'trusted_openid_alpha');
  assert.equal(state.rows[0].journalLayout, LAYOUT);
  assert.equal(state.rows[0].journalRevision, 0);
  assert.equal(state.rows[0].operationFence, 0);
  assert.equal(state.rows[0].exportEpoch, 0);
});

test('R02 a second entry reuses the same account and never adds a row', async () => {
  const { identity, state } = world();
  const first = await identity.resolveAccount('trusted_openid_alpha');
  const second = await identity.resolveAccount('trusted_openid_alpha');
  assert.deepEqual(second, first);
  assert.equal(state.adds, 1);
  assert.equal(state.rows.length, 1);
});

test('R03 without the unique-index gate provisioning fails closed instead of writing', async () => {
  const { identity, state } = world({ uniqueIndexReady: false });
  await assert.rejects(identity.resolveAccount('trusted_openid_alpha'), {
    code: 'NOT_IMPLEMENTED',
  });
  assert.equal(state.adds, 0);
  assert.equal(state.rows.length, 0);
});

test('R04 a disabled account stays disabled and is never reactivated', async () => {
  const { identity } = world({
    rows: [{ _id: 'account_disabled', openid: 'trusted_openid_alpha', status: 'disabled' }],
  });
  const resolved = await identity.resolveAccount('trusted_openid_alpha');
  assert.deepEqual(resolved, { id: 'account_disabled', status: 'disabled' });
});

test('R05 a lost creation race reads back the winner instead of failing', async () => {
  const { identity, state } = world({ duplicateOnAdd: true });
  // No winner row means the original error is rethrown, never hidden as "created":
  // the repository refuses to guess that a broad SDK failure was a duplicate.
  await assert.rejects(identity.resolveAccount('trusted_openid_alpha'), /DUPLICATE_KEY/);
  assert.equal(state.rows.length, 0);

  const seeded = world({
    rows: [{ _id: 'account_winner', openid: 'trusted_openid_alpha', status: 'active' }],
    duplicateOnAdd: true,
  });
  const raced = await seeded.identity.resolveAccount('trusted_openid_alpha');
  assert.deepEqual(raced, { id: 'account_winner', status: 'active' });
});

test('R06 an empty OPENID never reaches the repository', async () => {
  const { identity, state } = world();
  assert.equal(await identity.resolveAccount(''), null);
  assert.equal(await identity.resolveAccount(null), null);
  assert.equal(state.adds, 0);
});

test('R07 the router keeps the disabled gate on the repository-provisioned account', async () => {
  const { identity, store } = world({
    rows: [{ _id: 'account_disabled', openid: 'trusted_openid_alpha', status: 'disabled' }],
  });
  const router = createRouter({
    resolveAccount: identity.resolveAccount,
    domainHandlers: {
      account: createAccountDomain({ store, clock, issueCleanupReceipt: () => null }).handle,
    },
  });
  const result = await router(
    {
      apiVersion: '1',
      requestId: 'req_w2repo_disabled_001',
      action: 'account.preferences',
      payload: { operation: 'get' },
    },
    { OPENID: 'trusted_openid_alpha' },
  );
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
  assert.deepEqual(store.calls, []);
});

test('R08 an active repository-provisioned account can read its own preferences', async () => {
  const { identity, store } = world();
  const router = createRouter({
    resolveAccount: identity.resolveAccount,
    domainHandlers: {
      account: createAccountDomain({ store, clock, issueCleanupReceipt: () => null }).handle,
    },
  });
  const result = await router(
    {
      apiVersion: '1',
      requestId: 'req_w2repo_active_001',
      action: 'account.preferences',
      payload: { operation: 'get' },
    },
    { OPENID: 'trusted_openid_alpha' },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    cardTextPreview: false,
    decorationsEnabled: true,
    updatedAt: null,
  });
});
