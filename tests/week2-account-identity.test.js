// W2 JF01 - trusted WeChat identity to internal account, formal entry + first login.
// Owner: Jiawei Fang (w2-account). Reviewer: Xiang Hong. Independent check: Qizhen Cai.
// Local doubles only: every account row below is synthetic and no cloud call is made.
// The cloud-shaped store is a stub that imitates the wx-server-sdk call shape; it is
// NOT evidence that real-cloud provisioning or uniq_openid was verified.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createIdentityServices } = require('../cloudfunctions/moodsky/identity');
const { createAccountStore } = require('../cloudfunctions/moodsky/stores/account-store');
const { createAccountDomain } = require('../cloudfunctions/moodsky/domains/account');
const { ACCOUNT_STATUS, DEFAULT_PREFERENCES } = require('../miniprogram/shared/constants');

const repo = path.resolve(__dirname, '..');
const TRUSTED = { OPENID: 'trusted_openid_alpha' };
const FIXED_NOW = new Date('2026-10-24T02:00:00.000Z');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const request = (action, payload = {}, requestId = 'req_week2_identity_001') => ({
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
  resolveOperatorRoles,
} = {}) {
  const identity = createIdentityServices({
    store,
    clock,
    receiptSecret,
    env,
    resolveOperatorRoles,
  });
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
    clock,
    identity,
    call: (action, payload, context = TRUSTED) => router(request(action, payload), context),
  };
}

// Minimal database stub for the cloud implementation of the account store. It
// mirrors where().limit().get(), add({ data }) and doc().get()/update() and
// enforces the declared unique keys by throwing a duplicate-key error.
function createCloudDatabase({ unique = {} } = {}) {
  const tables = new Map();
  const rowsOf = (name) => {
    if (!tables.has(name)) {
      tables.set(name, []);
    }
    return tables.get(name);
  };
  const matches = (row, filter) =>
    Object.entries(filter).every(([key, value]) => row[key] === value);
  const keysFor = (name) => unique[name] || [];
  let sequence = 0;
  return {
    tables,
    rows: (name) => rowsOf(name),
    database() {
      return {
        collection: (name) => ({
          where: (filter) => ({
            limit: (limit) => ({
              get: async () => {
                await tick();
                return {
                  data: rowsOf(name)
                    .filter((row) => matches(row, filter))
                    .slice(0, limit)
                    .map((row) => ({ ...row })),
                };
              },
            }),
          }),
          add: async ({ data }) => {
            await tick();
            for (const keys of keysFor(name)) {
              if (rowsOf(name).some((row) => keys.every((key) => row[key] === data[key]))) {
                throw new Error('E11000 duplicate key error');
              }
            }
            sequence += 1;
            const row = { _id: name + '_' + sequence, ...data };
            rowsOf(name).push(row);
            return { _id: row._id };
          },
          doc: (id) => ({
            get: async () => {
              await tick();
              const row = rowsOf(name).find((item) => item._id === id);
              return { data: row ? { ...row } : null };
            },
            update: async ({ data }) => {
              await tick();
              const row = rowsOf(name).find((item) => item._id === id);
              if (row) {
                Object.assign(row, data);
              }
              return { stats: { updated: row ? 1 : 0 } };
            },
          }),
        }),
      };
    },
  };
}

function loadEntry({ context = TRUSTED, database }) {
  const exports = {};
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'synthetic-dynamic-env',
    init() {},
    getWXContext() {
      return context;
    },
    database: database.database,
  };
  const localRequire = createRequire(path.join(repo, 'cloudfunctions/moodsky/index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(repo, 'cloudfunctions/moodsky/index.js'), 'utf8'), {
    exports,
    require(name) {
      return name === 'wx-server-sdk' ? sdk : localRequire(name);
    },
    console,
  });
  return { main: exports.main, database };
}

test('JF01-W01 first trusted entry provisions one active account and a repeat entry reuses it', async () => {
  const route = createRoute();
  const first = await route.call('account.preferences', { operation: 'get' });
  assert.equal(first.ok, true);
  assert.deepEqual(first.data, { ...DEFAULT_PREFERENCES, updatedAt: null });
  assert.equal(route.store.rows.accounts.length, 1);
  const account = route.store.rows.accounts[0];
  assert.equal(account.openid, TRUSTED.OPENID);
  assert.equal(account.status, ACCOUNT_STATUS.ACTIVE);

  const second = await route.call('account.preferences', { operation: 'get' });
  assert.equal(second.ok, true);
  assert.equal(route.store.rows.accounts.length, 1);

  const identityA = await route.identity.resolveAccount(TRUSTED.OPENID);
  const identityB = await route.identity.resolveAccount(TRUSTED.OPENID);
  assert.equal(identityA.id, account.id);
  assert.equal(identityA.id, identityB.id);
});

test('JF01-W02 missing trusted identity is rejected before any account read', async () => {
  const route = createRoute();
  const result = await route.call('account.preferences', { operation: 'get' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.deepEqual(route.store.calls, []);
  assert.equal(route.store.rows.accounts.length, 0);
});

test('JF01-W03 concurrent first entries over a cloud-shaped store leave exactly one account', async () => {
  const database = createCloudDatabase({ unique: { accounts: [['openid']] } });
  const store = createAccountStore({ cloud: { database: database.database } });
  const identity = createIdentityServices({ store, clock: () => FIXED_NOW });
  const results = await Promise.all(
    Array.from({ length: 3 }, () => identity.resolveAccount('openid_first_login_race')),
  );
  for (const result of results) {
    assert.equal(typeof result.id, 'string');
    assert.equal(result.id, results[0].id);
    assert.equal(result.status, ACCOUNT_STATUS.ACTIVE);
  }
  const accounts = database.rows('accounts');
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].openid, 'openid_first_login_race');
});

test('JF01-W04 a disabled account is refused and is never rebuilt as active', async () => {
  const store = createAccountStore({
    seed: { accounts: [{ openid: TRUSTED.OPENID, status: ACCOUNT_STATUS.DISABLED }] },
  });
  const route = createRoute({ store });
  const result = await route.call('account.preferences', { operation: 'get' });
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
  assert.equal(store.rows.accounts.length, 1);
  assert.equal(store.rows.accounts[0].status, ACCOUNT_STATUS.DISABLED);
  assert.equal(store.calls.filter((call) => call.op === 'insertAccount').length, 0);
});

test('JF01-W05 payload identity fields are rejected before any account read', async () => {
  for (const payload of [
    { ownerId: 'someone_else' },
    { owner: 'someone_else' },
    { openid: 'spoofed_openid' },
    { OPENID: 'spoofed_openid' },
    { role: 'data_operator' },
    { roles: ['data_operator'] },
    { accountId: 'someone_else' },
  ]) {
    const route = createRoute();
    const result = await route.call('account.preferences', { operation: 'get', ...payload });
    assert.equal(result.error.code, 'INVALID_REQUEST', JSON.stringify(payload));
    assert.deepEqual(route.store.calls, []);
  }
  const close = createRoute();
  assert.equal(
    (await close.call('account.close', { confirm: 'CLOSE', ownerId: 'someone_else' })).error.code,
    'INVALID_REQUEST',
  );
  assert.deepEqual(close.store.calls, []);
});

test('JF01-W06 an account row without an internal id cannot become an actor', async () => {
  const calls = [];
  const store = {
    async findAccountByOpenid(openid) {
      calls.push(openid);
      return { id: '', openid, status: ACCOUNT_STATUS.ACTIVE };
    },
    async insertAccount() {
      throw new Error('must not provision a second row');
    },
  };
  const identity = createIdentityServices({ store, clock: () => FIXED_NOW });
  const router = createRouter({ resolveAccount: identity.resolveAccount });
  const result = await router(request('account.preferences', { operation: 'get' }), TRUSTED);
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.deepEqual(calls, [TRUSTED.OPENID]);

  const empty = createIdentityServices({ store, clock: () => FIXED_NOW });
  assert.equal(await empty.resolveAccount(''), null);
  assert.deepEqual(calls, [TRUSTED.OPENID]);
});

test('JF01-W07 operator roles keep the adapters.js seam instead of being granted locally', async () => {
  const unconfigured = createRoute();
  assert.equal((await unconfigured.call('admin.updatePlace', {})).error.code, 'NOT_IMPLEMENTED');

  const student = createRoute({ resolveOperatorRoles: async () => [] });
  assert.equal((await student.call('admin.updatePlace', {})).error.code, 'FORBIDDEN');
});

test('JF01-W08 the shipped entry resolves the account from trusted context only', async () => {
  const database = createCloudDatabase({
    unique: { accounts: [['openid']], preferences: [['ownerId']] },
  });
  const entry = loadEntry({ database });
  const payload = { operation: 'get' };
  const first = await entry.main(request('account.preferences', payload, 'req_week2_entry_001'));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.data, { ...DEFAULT_PREFERENCES, updatedAt: null });
  assert.equal(database.rows('accounts').length, 1);
  assert.equal(database.rows('accounts')[0].openid, TRUSTED.OPENID);

  const second = await entry.main(request('account.preferences', payload, 'req_week2_entry_002'));
  assert.equal(second.ok, true);
  assert.equal(database.rows('accounts').length, 1);

  const anonymousDb = createCloudDatabase({ unique: { accounts: [['openid']] } });
  const anonymous = loadEntry({ context: {}, database: anonymousDb });
  const denied = await anonymous.main(
    request('account.preferences', payload, 'req_week2_entry_003'),
  );
  assert.equal(denied.error.code, 'UNAUTHENTICATED');
  assert.equal(anonymousDb.rows('accounts').length, 0);
});

test('JF01-W09 a unique-key race with an empty read-back fails closed and adds no row', async () => {
  const store = createAccountStore();
  const racing = Object.create(store);
  const reads = [];
  let inserts = 0;
  // The read-back window after a unique-key conflict: the other writer's row is
  // still invisible, so the conflict must fail closed instead of inventing one.
  racing.findAccountByOpenid = async (openid) => {
    reads.push(openid);
    return null;
  };
  racing.insertAccount = async () => {
    inserts += 1;
    const error = new Error('Unique key conflict.');
    error.code = 'DUPLICATE_KEY';
    throw error;
  };
  const route = createRoute({ store: racing });
  const result = await route.call('account.preferences', { operation: 'get' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.equal(result.error.message, '账号尚未就绪。');
  assert.equal(inserts, 1);
  assert.deepEqual(reads, [TRUSTED.OPENID, TRUSTED.OPENID]);
  assert.equal(store.rows.accounts.length, 0);
  assert.equal(store.calls.length, 0);
});
