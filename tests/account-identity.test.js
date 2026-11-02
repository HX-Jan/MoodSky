// W1 JF01 + JF03 — trusted WeChat identity to internal account, local doubles only.
// Owner: Jiawei Fang. Reviewer: Xiang Hong. Independent check: Qizhen Cai.
// This file never touches the cloud: real-cloud results stay recorded as unperformed.
// First-login provisioning is exercised as a local rule proposal, not deployed code.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { ACCOUNT_STATUS } = require('../miniprogram/shared/constants');

const PRIVATE_ACTION = 'account.preferences';
const RECEIPT_ACTION = 'account.cleanupStatus';
const TRUSTED = { OPENID: 'trusted_openid_alpha' };

const request = (action, payload = {}) => ({
  apiVersion: '1',
  requestId: 'req_account_identity_001',
  action,
  payload,
});

// Lets two awaited store calls interleave, so the duplicate-key fallback is really exercised.
const tick = () => Promise.resolve();

// accounts double: mirrors the declared uniq_openid key, so a duplicate insert fails
// the same way a real unique index would instead of silently adding a second row.
function createAccountStore(seed = []) {
  const rows = seed.map((row, index) => ({ _id: `account_seed_${index + 1}`, ...row }));
  const calls = [];
  return {
    rows,
    calls,
    async findByOpenid(openid) {
      calls.push({ op: 'find', openid });
      await tick();
      return rows.find((row) => row.openid === openid) ?? null;
    },
    async insert({ openid, status }) {
      calls.push({ op: 'insert', openid });
      await tick();
      if (rows.some((row) => row.openid === openid)) {
        const error = new Error('duplicate key uniq_openid');
        error.code = 'DUPLICATE_KEY';
        throw error;
      }
      const row = { _id: `account_${rows.length + 1}`, openid, status };
      rows.push(row);
      return row;
    },
  };
}

// First-login rule under test: find-or-create on the trusted openid only; a unique-key
// collision is read back instead of surfacing as an error.
function createAccountResolution(store, { provision = true } = {}) {
  return async function resolveAccount(openid) {
    if (typeof openid !== 'string' || openid.length === 0) {
      return null;
    }
    const existing = await store.findByOpenid(openid);
    if (existing) {
      return { id: existing._id, status: existing.status };
    }
    if (!provision) {
      return null;
    }
    try {
      const created = await store.insert({ openid, status: ACCOUNT_STATUS.ACTIVE });
      return { id: created._id, status: created.status };
    } catch (error) {
      if (error.code !== 'DUPLICATE_KEY') {
        throw error;
      }
      const raced = await store.findByOpenid(openid);
      return raced ? { id: raced._id, status: raced.status } : null;
    }
  };
}

function createRoute({ store = createAccountStore(), provision = true, receipt } = {}) {
  const adapters = {
    resolveAccount: createAccountResolution(store, { provision }),
    resolveCleanupReceipt: async (value) =>
      receipt && value === receipt.token ? { permission: receipt.permission } : null,
  };
  return {
    store,
    adapters,
    call: (action, payload = {}, context = TRUSTED) =>
      createRouter(adapters)(request(action, payload), context),
  };
}

test('JF01-A01 first trusted entry provisions one account and a repeat entry reuses it', async () => {
  const route = createRoute();
  const first = await route.call(PRIVATE_ACTION);
  // The account domain is still a stub: reaching it proves the identity gate passed.
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'NOT_IMPLEMENTED');
  assert.equal(route.store.rows.length, 1);
  assert.equal(route.store.rows[0].openid, TRUSTED.OPENID);
  assert.equal(route.store.rows[0].status, ACCOUNT_STATUS.ACTIVE);

  const second = await route.call(PRIVATE_ACTION);
  assert.equal(second.error.code, 'NOT_IMPLEMENTED');
  assert.equal(route.store.rows.length, 1);

  const firstIdentity = await route.adapters.resolveAccount(TRUSTED.OPENID);
  const secondIdentity = await route.adapters.resolveAccount(TRUSTED.OPENID);
  assert.equal(firstIdentity.id, secondIdentity.id);
});

test('JF01-A02 missing trusted identity is rejected before any account read', async () => {
  const route = createRoute();
  const result = await route.call(PRIVATE_ACTION, {}, {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.deepEqual(route.store.calls, []);
  assert.equal(route.store.rows.length, 0);
});

test('JF01-A03 concurrent first entries leave exactly one account behind', async () => {
  const route = createRoute();
  const results = await Promise.all(Array.from({ length: 5 }, () => route.call(PRIVATE_ACTION)));
  for (const result of results) {
    assert.equal(result.error.code, 'NOT_IMPLEMENTED');
  }
  // Five inserts were attempted; the unique key rejected four and each was read back.
  assert.equal(route.store.calls.filter((call) => call.op === 'insert').length, 5);
  assert.equal(route.store.rows.length, 1);
});

test('JF01-A04 a disabled account stays disabled and is never rebuilt as active', async () => {
  const store = createAccountStore([{ openid: TRUSTED.OPENID, status: ACCOUNT_STATUS.DISABLED }]);
  const route = createRoute({ store });
  const result = await route.call(PRIVATE_ACTION);
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
  assert.equal(route.store.rows.length, 1);
  assert.equal(route.store.rows[0].status, ACCOUNT_STATUS.DISABLED);
  assert.equal(route.store.calls.filter((call) => call.op === 'insert').length, 0);
});

test('JF01-A05 without first-login provisioning the gate answers UNAUTHENTICATED', async () => {
  // This is a local read-only proposal. The shipped default adapter remains unwired.
  const route = createRoute({ provision: false });
  const result = await route.call(PRIVATE_ACTION);
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.equal(result.error.message, '账号尚未就绪。');
  assert.equal(route.store.rows.length, 0);
});

test('JF01-A06 payload identity fields are rejected before any account read', async () => {
  const spoofs = [
    { ownerId: 'someone_else' },
    { accountId: 'someone_else' },
    { owner: 'someone_else' },
    { openid: 'spoofed_openid' },
    { OPENID: 'spoofed_openid' },
    { role: 'data_operator' },
    { roles: ['data_operator'] },
  ];
  for (const payload of spoofs) {
    const route = createRoute();
    const result = await route.call(PRIVATE_ACTION, payload);
    assert.equal(result.error.code, 'INVALID_REQUEST', JSON.stringify(payload));
    assert.deepEqual(route.store.calls, []);
  }
});

test('JF01-A07 an account row without an internal id cannot become an actor', async () => {
  const route = createRoute();
  route.adapters.resolveAccount = async () => ({ id: '', status: ACCOUNT_STATUS.ACTIVE });
  const result = await route.call(PRIVATE_ACTION);
  assert.equal(result.error.code, 'UNAUTHENTICATED');
});

test('JF01-A08 the shipped entry keeps trusted private requests NOT_IMPLEMENTED without wired adapters', async () => {
  const result = await createRouter()(request(PRIVATE_ACTION), TRUSTED);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_IMPLEMENTED');
});

test('JF03-B01 cleanup progress without a receipt is forbidden, not a login prompt', async () => {
  const route = createRoute();
  const result = await route.call(RECEIPT_ACTION, { jobId: 'cleanup_synthetic_1' }, {});
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.equal(route.store.rows.length, 0);
  assert.deepEqual(route.store.calls, []);
});

test('JF03-B02 a restricted cleanup_status receipt passes the gate without any login', async () => {
  const route = createRoute({
    receipt: { token: 'synthetic_receipt_alpha', permission: 'cleanup_status' },
  });
  const result = await route.call(
    RECEIPT_ACTION,
    { jobId: 'cleanup_synthetic_1', receipt: 'synthetic_receipt_alpha' },
    {},
  );
  assert.equal(result.error.code, 'NOT_IMPLEMENTED');
  assert.deepEqual(route.store.calls, []);
});

test('JF03-B03 a receipt issued for another permission is refused', async () => {
  const route = createRoute({
    receipt: { token: 'synthetic_receipt_beta', permission: 'export_download' },
  });
  const result = await route.call(
    RECEIPT_ACTION,
    { jobId: 'cleanup_synthetic_1', receipt: 'synthetic_receipt_beta' },
    {},
  );
  assert.equal(result.error.code, 'FORBIDDEN');
});

test('JF03-B04 a receipt never acts as a login and never revives a disabled account', async () => {
  const route = createRoute({
    receipt: { token: 'synthetic_receipt_alpha', permission: 'cleanup_status' },
  });
  const asLogin = await route.call(PRIVATE_ACTION, { receipt: 'synthetic_receipt_alpha' }, {});
  assert.equal(asLogin.error.code, 'UNAUTHENTICATED');

  const store = createAccountStore([{ openid: TRUSTED.OPENID, status: ACCOUNT_STATUS.DISABLED }]);
  const disabled = createRoute({
    store,
    receipt: { token: 'synthetic_receipt_alpha', permission: 'cleanup_status' },
  });
  const result = await disabled.call(
    PRIVATE_ACTION,
    { receipt: 'synthetic_receipt_alpha' },
    TRUSTED,
  );
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
});
