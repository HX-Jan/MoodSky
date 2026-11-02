const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdapters } = require('../cloudfunctions/moodsky/adapters');
const { createRouter } = require('../cloudfunctions/moodsky/router');

function fixture({ status = 'active', grant = null, missing = false, fail = false } = {}) {
  const reads = [];
  const cloud = {
    database: () => ({
      collection: (name) => ({
        where: (filter) => ({
          limit: (limit) => ({
            get: async () => {
              reads.push({ name, filter, limit });
              if (fail) {
                throw new Error('private database detail');
              }
              const rows =
                name === 'accounts'
                  ? missing
                    ? []
                    : [{ _id: 'account_test', status }]
                  : grant
                    ? [{ accountId: 'account_test', ...grant }]
                    : [];
              return { data: rows.filter((row) => name === 'accounts' || row.enabled === true) };
            },
          }),
        }),
      }),
    }),
  };
  const adapters = createAdapters(cloud);
  const route = createRouter(adapters);
  return {
    reads,
    adapters,
    call: (payload = {}, context = { OPENID: 'trusted_test' }) =>
      route(
        {
          apiVersion: '1',
          requestId: 'req_adapter_001',
          action: 'admin.updatePlace',
          payload,
        },
        context,
      ),
  };
}

test('identity adapters require trusted identity and an existing internal account', async () => {
  const f = fixture();
  assert.equal((await f.call({}, {})).error.code, 'UNAUTHENTICATED');
  assert.deepEqual(f.reads, []);
  assert.equal((await fixture({ missing: true }).call()).error.code, 'UNAUTHENTICATED');
  assert.equal(await f.adapters.resolveAccount(''), null);
  assert.deepEqual(await f.adapters.resolveOperatorRoles(''), []);
});

test('ordinary and malformed grants cannot maintain campus data', async () => {
  for (const grant of [
    null,
    { role: 'moderator', enabled: true },
    { roles: ['data_operator'], enabled: true },
    { role: 'data_operator', enabled: false },
  ]) {
    const f = fixture({ grant });
    assert.equal((await f.call()).error.code, 'FORBIDDEN');
    assert.deepEqual(f.reads[1], {
      name: 'operator_roles',
      filter: { accountId: 'account_test', enabled: true },
      limit: 1,
    });
  }
});

test('singular enabled role passes the gate but business remains NOT_IMPLEMENTED', async () => {
  const f = fixture({ grant: { role: 'data_operator', enabled: true } });
  assert.deepEqual(await f.adapters.resolveOperatorRoles('account_test'), ['data_operator']);
  const result = await f.call();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_IMPLEMENTED');
});

test('disabled account is rejected before consulting its role', async () => {
  const f = fixture({ status: 'disabled', grant: { role: 'data_operator', enabled: true } });
  assert.equal((await f.call()).error.code, 'ACCOUNT_DISABLED');
  assert.deepEqual(f.reads, [{ name: 'accounts', filter: { openid: 'trusted_test' }, limit: 1 }]);
});

test('client role spoofing is rejected before any trusted database read', async () => {
  const f = fixture();
  for (const payload of [
    { role: 'data_operator' },
    { roles: ['data_operator'] },
    { ownerId: 'other' },
  ]) {
    assert.equal((await f.call(payload)).error.code, 'INVALID_REQUEST');
  }
  assert.deepEqual(f.reads, []);
});

test('adapter database failures return a scrubbed error', async () => {
  const result = await fixture({ fail: true }).call();
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /private database detail|trusted_test/);
});
