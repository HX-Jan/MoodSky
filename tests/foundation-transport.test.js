const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const { createRouter } = require(path.join(repo, 'cloudfunctions/moodsky/router'));
const source = fs.readFileSync(path.join(repo, 'cloudfunctions/moodsky/index.js'), 'utf8');
const request = (action = 'system.health', payload = {}) => ({
  apiVersion: '1',
  requestId: 'req_foundation_candidate_001',
  action,
  payload,
});
function fixture(context = {}, adapters = {}) {
  const observations = {
    initialized: 0,
    contextReads: 0,
    accountLookups: [],
    unexpectedRequires: [],
    logs: [],
  };
  const exports = {};
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'synthetic-dynamic-env',
    init(options) {
      assert.equal(options.env, 'synthetic-dynamic-env');
      observations.initialized++;
    },
    getWXContext() {
      observations.contextReads++;
      return context;
    },
  };
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'wx-server-sdk') {
        return sdk;
      }
      if (name === './router') {
        return {
          createRouter: () =>
            createRouter({
              resolveAccount: async (openid) => {
                observations.accountLookups.push(openid);
                return { id: 'synthetic-internal-a', status: 'active' };
              },
              ...adapters,
            }),
        };
      }
      observations.unexpectedRequires.push(name);
      // The offline candidate genuinely has no business modules, so this is a
      // missing module (the only wiring failure index.js may fall back on).
      const missing = new Error('Cannot find module ' + name);
      missing.code = 'MODULE_NOT_FOUND';
      throw missing;
    },
    console: {
      log(...items) {
        observations.logs.push(items);
      },
      error(...items) {
        observations.logs.push(items);
      },
    },
  });
  return { main: exports.main, observations };
}
test('health accepts each known metadata combination without querying accounts', async () => {
  for (const extras of [
    {},
    { userInfo: { OPENID: 'synthetic-forged' } },
    { tcbContext: { OPENID: 'synthetic-forged' } },
    { userInfo: null, tcbContext: [] },
  ]) {
    const f = fixture();
    const result = await f.main({ ...request(), ...extras });
    assert.equal(result.ok, true);
    assert.equal(result.data.app, 'MoodSky');
    assert.equal(result.requestId, request().requestId);
    assert.equal(f.observations.accountLookups.length, 0);
  }
});
test('other top-level fields remain rejected', async () => {
  for (const key of ['ownerId', 'uid', 'context', 'OPENID', 'role', 'unexpected']) {
    const f = fixture();
    const result = await f.main({
      ...request(),
      userInfo: {},
      tcbContext: {},
      [key]: 'synthetic-value',
    });
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(f.observations.accountLookups.length, 0);
  }
});
test('invalid envelope types retain strict rejection', async () => {
  for (const event of [null, [], 0, 'synthetic-string', true]) {
    const result = await fixture().main(event);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(result.requestId, null);
  }
});
test('metadata cannot provide a missing envelope or overwrite an explicit action', async () => {
  const f = fixture();
  const meta = { userInfo: { ...request() }, tcbContext: { ...request() } };
  assert.equal((await f.main(meta)).error.code, 'INVALID_REQUEST');
  assert.equal(
    (await f.main({ ...request('nonexistent.action'), ...meta })).error.code,
    'ACTION_NOT_FOUND',
  );
});
test('metadata identity cannot authorize private actions without trusted context', async () => {
  const f = fixture();
  const result = await f.main({
    ...request('journal.get', { date: '2026-10-15' }),
    userInfo: { OPENID: 'synthetic-forged' },
    tcbContext: { OPENID: 'synthetic-forged', roles: ['data_operator'] },
  });
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.deepEqual(f.observations.accountLookups, []);
});
test('private lookups use only SDK context and business stubs remain unimplemented', async () => {
  const f = fixture({ OPENID: 'synthetic-trusted' });
  const result = await f.main({
    ...request('journal.get', { date: '2026-10-15' }),
    userInfo: { OPENID: 'synthetic-forged' },
    tcbContext: { OPENID: 'synthetic-forged' },
  });
  assert.equal(result.error.code, 'NOT_IMPLEMENTED');
  assert.deepEqual(f.observations.accountLookups, ['synthetic-trusted']);
});
test('reserved identity fields in payload remain rejected before lookup', async () => {
  for (const key of ['ownerId', 'owner', 'openid', 'OPENID', 'role', 'roles', 'accountId']) {
    const f = fixture({ OPENID: 'synthetic-trusted' });
    const result = await f.main({
      ...request('journal.get', { [key]: 'synthetic-value' }),
      tcbContext: {},
    });
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal(f.observations.accountLookups.length, 0);
  }
});
test('disabled accounts and ordinary students retain private and operator gates', async () => {
  const disabled = fixture(
    { OPENID: 'synthetic-trusted' },
    { resolveAccount: async () => ({ id: 'synthetic-a', status: 'disabled' }) },
  );
  assert.equal(
    (await disabled.main({ ...request('journal.get'), userInfo: {} })).error.code,
    'ACCOUNT_DISABLED',
  );
  const student = fixture(
    { OPENID: 'synthetic-trusted' },
    { resolveOperatorRoles: async () => [] },
  );
  assert.equal(
    (
      await student.main({
        ...request('admin.updatePlace'),
        tcbContext: { roles: ['data_operator'] },
      })
    ).error.code,
    'FORBIDDEN',
  );
});
test('candidate does not mutate frozen input or emit metadata and trusted context', async () => {
  const f = fixture({ OPENID: 'synthetic-private-trusted' });
  const event = Object.freeze({
    ...request(),
    payload: Object.freeze({}),
    userInfo: Object.freeze({ OPENID: 'synthetic-private-forged' }),
    tcbContext: Object.freeze({ secret: 'synthetic-private-value' }),
  });
  const before = JSON.stringify(event);
  const result = await f.main(event);
  assert.equal(JSON.stringify(event), before);
  assert(!JSON.stringify(result).includes('synthetic-private'));
  assert.deepEqual(f.observations.logs, []);
  assert.deepEqual(f.observations.unexpectedRequires, []);
});
test('SDK initializes once and trusted context is read on every call', async () => {
  const f = fixture();
  await f.main(request());
  await f.main({ ...request(), tcbContext: {} });
  assert.equal(f.observations.initialized, 1);
  assert.equal(f.observations.contextReads, 2);
});
test('version and request correlation checks remain active', async () => {
  const f = fixture();
  assert.equal(
    (await f.main({ ...request(), apiVersion: '2', userInfo: {} })).error.code,
    'API_VERSION_UNSUPPORTED',
  );
  const result = await f.main({
    ...request(),
    requestId: 'bad\nsecret',
    tcbContext: {},
  });
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert.equal(result.requestId, null);
  assert(!JSON.stringify(result).includes('bad\nsecret'));
});
