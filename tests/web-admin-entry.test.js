const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWebAdminEntry,
  createWebAdminServices,
  readConfig,
  readWebSubject,
} = require('../cloudfunctions/moodsky/web-admin');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { ENV_ID } = require('../cloudfunctions/moodsky/production/config');
const { createMemoryRepositories } = require('./support/campus-repository');
require('../admin/auth');
const { createClient } = globalThis.MoodSkyAdminAuth;
const request = (action = 'admin.listPlaces', payload = {}) => ({
  apiVersion: '1',
  requestId: 'web_admin_test_001',
  action,
  payload,
});
const configEnv = (extra = {}) => ({
  MOODSKY_WEB_ADMIN_ENABLED: 'true',
  MOODSKY_WEB_ADMIN_ENV: ENV_ID,
  MOODSKY_WEB_ADMIN_BINDINGS: JSON.stringify([
    { uid: 'synthetic_uid', accountId: 'synthetic_account' },
  ]),
  ...extra,
});
const context = (extra = {}) => ({
  namespace: ENV_ID,
  environment: JSON.stringify({
    TCB_UUID: 'synthetic_uid',
    TCB_ENV: ENV_ID,
    TCB_SOURCE: 'web_client',
    TCB_ISANONYMOUS_USER: 'false',
    ...extra,
  }),
});
function fixture({
  account = { id: 'synthetic_account', status: 'active' },
  roles = ['data_operator'],
  enabled = true,
  writes = false,
} = {}) {
  let opened = 0,
    roleReads = 0;
  const seen = [];
  const repositories = createMemoryRepositories({
    places: [
      {
        _id: 'synthetic_doc',
        placeId: 'synthetic_place',
        name: '合成测试地点',
        campus: '合成校区',
        enabled: true,
        isSynthetic: true,
        source: 'Synthetic fixture only',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  });
  const entry = createWebAdminEntry({
    readConfig: () =>
      enabled ? readConfig(configEnv({ MOODSKY_WEB_ADMIN_WRITES_ENABLED: String(writes) })) : null,
    now: () => Date.parse('2026-11-07T04:00:00.000Z'),
    openServices: () => {
      opened++;
      return {
        resolveAccountById: async (id) => {
          seen.push(id);
          return account;
        },
        resolveOperatorRoles: async (id) => {
          roleReads++;
          assert.equal(id, account.id);
          return roles;
        },
        repositories,
      };
    },
  });
  return {
    entry,
    repositories,
    seen,
    get opened() {
      return opened;
    },
    get roleReads() {
      return roleReads;
    },
  };
}
test('Web admin config is opt-in, requires target environment and an unambiguous server binding', () => {
  assert.equal(readConfig({}), null);
  for (const extra of [
    { MOODSKY_WEB_ADMIN_ENABLED: '1' },
    { MOODSKY_WEB_ADMIN_ENV: 'wrong' },
    { MOODSKY_WEB_ADMIN_BINDINGS: '{' },
    { MOODSKY_WEB_ADMIN_BINDINGS: '{}' },
    { MOODSKY_WEB_ADMIN_BINDINGS: '[]' },
    ...[
      [{ uid: 'u', accountId: 'a', role: 'data_operator' }],
      [
        { uid: 'u', accountId: 'a' },
        { uid: 'u', accountId: 'b' },
      ],
      [
        { uid: 'u', accountId: 'a' },
        { uid: 'v', accountId: 'a' },
      ],
      [{ uid: {}, accountId: 'a' }],
      [{ uid: 'u', accountId: '../a' }],
      Array.from({ length: 21 }, (_, i) => ({ uid: 'u' + i, accountId: 'a' + i })),
    ].map((rows) => ({ MOODSKY_WEB_ADMIN_BINDINGS: JSON.stringify(rows) })),
  ]) {
    assert.equal(readConfig(configEnv(extra)), null);
  }
  const config = readConfig(configEnv());
  assert.equal(config.writes, false);
  assert.equal(config.bindings.get('synthetic_uid'), 'synthetic_account');
});
test('current-invocation Web context accepts JSON and legacy fields without process fallbacks', () => {
  assert.deepEqual(readWebSubject(context(), ENV_ID), {
    uid: 'synthetic_uid',
    envId: ENV_ID,
    source: 'web_client',
  });
  const legacy = {
    namespace: ENV_ID,
    environ: 'TCB_UUID=synthetic_uid;TCB_SOURCE=web_client;TCB_ISANONYMOUS_USER=false',
  };
  assert.equal(readWebSubject(legacy, ENV_ID).uid, 'synthetic_uid');
  const old = process.env.TCB_UUID;
  process.env.TCB_UUID = 'synthetic_uid';
  try {
    assert.equal(readWebSubject({ namespace: ENV_ID }, ENV_ID), null);
  } finally {
    if (old === undefined) {
      delete process.env.TCB_UUID;
    } else {
      process.env.TCB_UUID = old;
    }
  }
});
test('wrong/anonymous/malformed/cross-environment identities fail closed', async () => {
  for (const bad of [
    {},
    { environment: '{' },
    { environment: '[]' },
    context({ TCB_UUID: '' }),
    context({ TCB_SOURCE: 'wx_client' }),
    context({ TCB_ISANONYMOUS_USER: 'true' }),
    context({ TCB_ISANONYMOUS_USER: undefined }),
    context({ TCB_ENV: 'wrong' }),
    context({ SCF_NAMESPACE: 'wrong' }),
    { ...context(), namespace: 'wrong' },
    {
      namespace: ENV_ID,
      environ: 'TCB_UUID=u;TCB_UUID=v;TCB_SOURCE=web_client;TCB_ISANONYMOUS_USER=false',
    },
  ]) {
    const f = fixture();
    assert.equal((await f.entry(request(), bad)).error.code, 'UNAUTHENTICATED');
    assert.equal(f.opened, 0);
  }
});
test('disabled config and health never open services or disclose bindings', async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.entry(request(), context())).error.code, 'NOT_IMPLEMENTED');
  const result = await f.entry(request('system.health'), {});
  assert.deepEqual(result.data, {
    stage: 'web-admin-candidate',
    configured: false,
    readOnly: true,
  });
  assert.equal(
    (await f.entry(request('system.health', { uid: 'bad' }), {})).error.code,
    'INVALID_INPUT',
  );
  assert.equal(f.opened, 0);
});
test('all non-admin business domains are rejected before identity or data access', async () => {
  for (const action of ['journal.get', 'account.session', 'tasks.history', 'campus.listPlaces']) {
    const f = fixture();
    assert.equal((await f.entry(request(action), context())).error.code, 'FORBIDDEN');
    assert.equal(f.opened, 0);
  }
});
test('unmapped Web identity cannot provision accounts or self-grant access', async () => {
  const f = fixture();
  const result = await f.entry(
    {
      ...request(),
      userInfo: { uid: 'synthetic_uid', role: 'data_operator' },
      tcbContext: context(),
    },
    context({ TCB_UUID: 'other' }),
  );
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.equal(f.opened, 0);
  assert.equal(
    (await f.entry({ ...request(), userInfo: { uid: 'synthetic_uid' } }, {})).error.code,
    'UNAUTHENTICATED',
  );
});
test('unknown account and disabled account are rejected before the role lookup', async () => {
  for (const [account, code] of [
    [null, 'UNAUTHENTICATED'],
    [{ id: 'synthetic_account', status: 'disabled' }, 'ACCOUNT_DISABLED'],
  ]) {
    const f = fixture({ account });
    assert.equal((await f.entry(request(), context())).error.code, code);
    assert.equal(f.roleReads, 0);
  }
});
test('successful SDK identity with no server data_operator role cannot list materials', async () => {
  const f = fixture({ roles: ['moderator'] });
  assert.equal((await f.entry(request(), context())).error.code, 'FORBIDDEN');
  assert.equal(f.repositories._state.writeLog.length, 0);
});
test('mapped active operator reads existing handlers, and every request rereads account/role', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const result = await f.entry(request('admin.listPlaces', { page: 1, pageSize: 1 }), context());
    assert.equal(result.ok, true);
    assert.equal(result.data.items[0].placeId, 'synthetic_place');
  }
  assert.deepEqual(f.seen, ['synthetic_account', 'synthetic_account']);
  assert.equal(f.roleReads, 2);
  assert.equal(f.repositories._state.writeLog.length, 0);
});
test('server write switch defaults to closed even with a valid operator identity', async () => {
  const f = fixture();
  assert.equal(
    (await f.entry(request('admin.updatePlace', { placeId: 'synthetic_place' }), context())).error
      .code,
    'NOT_IMPLEMENTED',
  );
  assert.equal(f.opened, 0);
  assert.equal(f.repositories._state.writeLog.length, 0);
});
test('separately enabled candidate uses original place validation, write and readback', async () => {
  const f = fixture({ writes: true });
  const result = await f.entry(
    request('admin.updatePlace', {
      placeId: 'synthetic_place',
      expectedUpdatedAt: '2026-11-01T00:00:00.000Z',
      changes: { name: '修改后的合成地点' },
    }),
    context(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.saved, true);
  assert.equal(result.data.verified, true);
  assert.equal(result.data.place.name, '修改后的合成地点');
  assert.equal(f.repositories._state.writeLog.length, 1);
});
test('payload and top-level forged identity fields are never used as server context', async () => {
  const f = fixture();
  for (const key of ['role', 'accountId', 'OPENID']) {
    assert.equal(
      (await f.entry(request('admin.listPlaces', { [key]: 'forged' }), context())).error.code,
      'INVALID_REQUEST',
    );
  }
  assert.equal(
    (await f.entry({ ...request(), webSubject: { uid: 'synthetic_uid' } }, {})).error.code,
    'INVALID_REQUEST',
  );
  assert.equal(f.opened, 0);
});
test('service errors return a correlated generic error without private details', async () => {
  const entry = createWebAdminEntry({
    readConfig: () => readConfig(configEnv()),
    openServices: () => {
      throw new Error('synthetic private detail');
    },
  });
  const result = await entry(request(), context());
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.equal(result.requestId, 'web_admin_test_001');
  assert.equal(JSON.stringify(result).includes('synthetic private'), false);
});
test('default router cannot accept Web subjects and does not confuse them with OPENID', async () => {
  let wxReads = 0;
  const router = createRouter({
    resolveAccount: async () => {
      wxReads++;
      return { id: 'a', status: 'active' };
    },
  });
  assert.equal(
    (await router(request(), { webSubject: { uid: 'synthetic_uid' } })).error.code,
    'UNAUTHENTICATED',
  );
  const opted = createRouter({
    resolveWebAccount: async () => assert.fail('ambiguous identity must not resolve'),
  });
  assert.equal(
    (await opted(request(), { OPENID: 'wx', webSubject: {} })).error.code,
    'UNAUTHENTICATED',
  );
  assert.equal(wxReads, 0);
});
test('native account/role adapters query mapped internal document and enabled server grant only', async () => {
  const calls = [];
  const cloud = {
    database: () => ({
      collection(name) {
        assert.ok(['accounts', 'operator_roles'].includes(name));
        return name === 'accounts'
          ? {
              doc(id) {
                calls.push([name, id]);
                return {
                  get: async () => ({
                    data: { _id: id, status: 'active', openid: 'synthetic-not-exported' },
                  }),
                };
              },
            }
          : {
              where(query) {
                calls.push([name, query]);
                return {
                  limit(n) {
                    assert.equal(n, 1);
                    return {
                      get: async () => ({ data: [{ enabled: true, role: 'data_operator' }] }),
                    };
                  },
                };
              },
            };
      },
    }),
  };
  const services = createWebAdminServices(cloud);
  assert.deepEqual(await services.resolveAccountById('synthetic_account'), {
    id: 'synthetic_account',
    status: 'active',
  });
  assert.deepEqual(await services.resolveOperatorRoles('synthetic_account'), ['data_operator']);
  assert.deepEqual(calls, [
    ['accounts', 'synthetic_account'],
    ['operator_roles', { accountId: 'synthetic_account', enabled: true }],
  ]);
});
test('browser chooses only reviewed function names while identity-free business envelopes stay unchanged', async () => {
  const calls = [];
  const sdk = {
    init: () => ({
      auth: {},
      callFunction: async (input) => {
        calls.push(input);
        return { result: { apiVersion: '1', requestId: input.data.requestId, ok: true, data: {} } };
      },
    }),
  };
  await createClient({
    cloudbase: sdk,
    config: { envId: 'synthetic', functionName: 'moodsky-web-admin' },
  }).call('admin.listPlaces', {});
  assert.equal(calls[0].name, 'moodsky-web-admin');
  assert.deepEqual(Object.keys(calls[0].data).sort(), [
    'action',
    'apiVersion',
    'payload',
    'requestId',
  ]);
  await assert.rejects(
    createClient({ cloudbase: sdk, config: { envId: 'synthetic', functionName: 'other' } }).call(
      'admin.listPlaces',
      {},
    ),
    { code: 'INVALID_FUNCTION_CONFIG' },
  );
  assert.equal(calls.length, 1);
});

test('browser transport reaches the separate entry and preserves server role denial', async () => {
  for (const allowed of [true, false]) {
    const f = fixture({ roles: allowed ? ['data_operator'] : [] });
    const sdk = {
      init: () => ({
        auth: {},
        callFunction: async ({ name, data }) => {
          assert.equal(name, 'moodsky-web-admin');
          assert.deepEqual(Object.keys(data).sort(), [
            'action',
            'apiVersion',
            'payload',
            'requestId',
          ]);
          return { result: await f.entry(data, context()) };
        },
      }),
    };
    const client = createClient({
      cloudbase: sdk,
      config: { envId: 'synthetic', functionName: 'moodsky-web-admin' },
    });
    if (allowed) {
      const result = await client.call('admin.listPlaces', { page: 1, pageSize: 1 });
      assert.equal(result.data.items[0].placeId, 'synthetic_place');
    } else {
      await assert.rejects(client.call('admin.listPlaces', {}), { code: 'FORBIDDEN' });
    }
    assert.equal(f.repositories._state.writeLog.length, 0);
  }
});

test('context diagnostics are server-only opt-in, retain strict health payload and never open services', async () => {
  const make = (diagnostics) =>
    createWebAdminEntry({
      readConfig: () => null,
      contextDiagnostics: diagnostics,
      openServices: () =>
        assert.fail('health diagnostics must not access accounts, roles or repositories'),
    });
  const normal = await make(false)(request('system.health'), context());
  assert.equal(Object.hasOwn(normal.data, 'contextDiagnostics'), false);
  const enabled = await make(true)(request('system.health'), context());
  assert.deepEqual(enabled.data.contextDiagnostics, {
    envelope: 'json',
    uid: 'valid_format',
    source: 'web_client',
    anonymousMarker: 'false_string',
    environment: 'match',
    accepted: true,
  });
  const clientAttempt = await make(false)(
    request('system.health', { contextDiagnostics: true }),
    context(),
  );
  assert.equal(clientAttempt.error.code, 'INVALID_INPUT');
  const nonBoolean = await make('true')(request('system.health'), context());
  assert.equal(Object.hasOwn(nonBoolean.data, 'contextDiagnostics'), false);
});

test('diagnostics explain current-context field shape without disclosing platform values or accepting alternate formats', async () => {
  const entry = createWebAdminEntry({
    readConfig: () => null,
    contextDiagnostics: true,
    openServices: () => assert.fail('diagnostic reads no data'),
  });
  const input = context({
    TCB_UUID: 'synthetic_sensitive_subject',
    TCB_SOURCE: 'synthetic_sensitive_source',
    TCB_ENV: 'synthetic_sensitive_environment',
    TCB_ISANONYMOUS_USER: false,
  });
  const result = await entry(request('system.health'), input);
  assert.deepEqual(result.data.contextDiagnostics, {
    envelope: 'json',
    uid: 'valid_format',
    source: 'other',
    anonymousMarker: 'false_boolean',
    environment: 'mismatch',
    accepted: false,
  });
  const text = JSON.stringify(result);
  for (const secret of [
    'synthetic_sensitive_subject',
    'synthetic_sensitive_source',
    'synthetic_sensitive_environment',
  ]) {
    assert.equal(text.includes(secret), false);
  }
  assert.equal(readWebSubject(input, ENV_ID), null);
});

test('diagnostic mode has no process identity fallback and rejects malformed or ambiguous envelopes', async () => {
  const entry = createWebAdminEntry({
    readConfig: () => null,
    contextDiagnostics: true,
    openServices: () => assert.fail(),
  });
  const old = process.env.TCB_UUID;
  process.env.TCB_UUID = 'synthetic_sensitive_subject';
  try {
    for (const bad of [
      {},
      { environment: '{' },
      { environment: '[]' },
      { environ: 'TCB_UUID=a;TCB_UUID=b' },
    ]) {
      const result = await entry(request('system.health'), bad);
      assert.equal(result.data.contextDiagnostics.envelope, 'unavailable');
      assert.equal(result.data.contextDiagnostics.uid, 'missing');
      assert.equal(result.data.contextDiagnostics.accepted, false);
      assert.equal(JSON.stringify(result).includes('synthetic_sensitive_subject'), false);
    }
  } finally {
    if (old === undefined) {
      delete process.env.TCB_UUID;
    } else {
      process.env.TCB_UUID = old;
    }
  }
});
