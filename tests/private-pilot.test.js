// Native SDK with synthetic transport; these are not new real-cloud results.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createNativeJournalDatabase } = require('../tools/journal-storage/native-database');
const { createPilotEntry } = require('../tools/private-pilot');
const { settings, readPilotConfig, operatorFingerprint } = require('../tools/private-pilot/config');
const NOW = new Date('2026-10-25T04:00:00.000Z');
const context = (openid) => ({
  OPENID: openid,
  APPID: settings.appId,
  ENV: settings.environmentId,
  SOURCE: 'wx_client',
  identityFromCurrentInvocation: true,
});
const env = (extra = {}) => ({
  MOODSKY_PRIVATE_PILOT_ENABLED: 'true',
  MOODSKY_PILOT_ACCOUNT_INDEX_VERIFIED: 'true',
  MOODSKY_PILOT_OPERATOR_FINGERPRINT: operatorFingerprint('synthetic_a'),
  MOODSKY_PILOT_RECEIPT_KEY_BASE64: Buffer.alloc(32, 0x42).toString('base64'),
  MOODSKY_PILOT_TEST_DATE: '2026-10-25',
  MOODSKY_PILOT_EXPIRES_AT: '2026-10-25T08:00:00.000Z',
  ...extra,
});
const options = { nativeDatabase: true, taskStoreReads: true, conflictScope: 'written-documents' };
const seed = () =>
  Object.fromEntries(
    ['a', 'b', 'c', 'd'].map((letter) => [
      'task_templates:task_' + letter,
      {
        _id: 'task_' + letter,
        enabled: true,
        title: '合成任务' + letter,
        steps: ['仅测试'],
        tags: [],
        durationMin: 2,
      },
    ]),
  );
function client(nativeDb) {
  const state = { context: context('synthetic_a'), env: env(), opens: 0 };
  const main = createPilotEntry({
    readContext: () => state.context,
    readConfig: () => readPilotConfig(state.env, NOW),
    openDatabase: () => {
      state.opens++;
      return createNativeJournalDatabase(nativeDb, { taskHistoryEnabled: true });
    },
    now: () => NOW,
  });
  let serial = 0;
  return {
    state,
    main,
    call: (action, payload = {}, scope, requestId = 'req_pilot_' + ++serial) =>
      main({
        request: { apiVersion: '1', requestId, action, payload },
        ...(scope ? { sessionScope: scope } : {}),
      }),
  };
}

test('private pilot provisions only during a valid session handshake, then saves and replays seven-weather journal data', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const { call, state } = client(nativeDb);
      assert.equal(
        (await call('journal.get', { date: '2026-10-25' })).error.code,
        'UNAUTHENTICATED',
      );
      assert.equal(state.opens, 0);
      assert.equal(
        (await call('account.session', { unexpected: true })).error.code,
        'INVALID_INPUT',
      );
      assert.equal(state.opens, 0);
      const login = await call('account.session');
      assert.equal(login.ok, true, JSON.stringify(login));
      const scope = login.data.scope;
      assert.match(scope, /^scope_[a-f0-9]{64}$/);
      assert.doesNotMatch(JSON.stringify(login), /synthetic_a|openid|ownerId|accountId/);
      assert.equal(Object.keys(inspect()).filter((k) => k.startsWith('accounts:')).length, 1);
      const storedAccount = Object.entries(inspect()).find(([key]) =>
        key.startsWith('accounts:'),
      )[1];
      assert.equal(storedAccount.identityKind, 'restricted-pilot-hmac-v1');
      assert.match(storedAccount.openid, /^pilot_[a-f0-9]{64}$/);
      assert.notEqual(storedAccount.openid, 'synthetic_a');
      const payload = {
        date: '2026-10-25',
        weather: 'CUSTOM',
        weatherName: '合成彩虹',
        text: '合成云测试😀',
        tags: ['REST'],
        expectedVersion: 0,
      };
      const saved = await call('journal.upsert', payload, scope, 'req_pilot_save');
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal(
        (await call('journal.upsert', payload, scope, 'req_pilot_save')).data.entry.version,
        1,
      );
      let version = 1;
      for (const weather of ['SUNNY', 'PARTLY_CLOUDY', 'CLOUDY', 'RAINY', 'STORMY', 'TYPHOON']) {
        const result = await call(
          'journal.upsert',
          { date: payload.date, weather, text: payload.text, expectedVersion: version },
          scope,
        );
        assert.equal(result.ok, true, JSON.stringify(result));
        version = result.data.entry.version;
      }
      const archive = await call('review.monthArchive', { month: '2026-10' }, scope);
      assert.equal(archive.ok, true);
      assert.doesNotMatch(JSON.stringify(archive), /合成云测试|synthetic_a|openid|ownerId/);
    },
    options,
  );
});

test('private pilot reloads selected tasks beyond the public first three and preserves terminal states', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb }) => {
      const { call } = client(nativeDb),
        scope = (await call('account.session')).data.scope;
      assert.equal(
        (await call('tasks.transition', { taskId: 'task_d', transition: 'select' }, scope)).ok,
        true,
      );
      const mine = await call('tasks.mine', {}, scope);
      assert.equal(mine.ok, true, JSON.stringify(mine));
      assert.equal(mine.data.readOnly, false);
      assert.equal(mine.data.items.length, 3);
      assert.equal(mine.data.items[0].taskId, 'task_d');
      assert.equal(mine.data.items[0].state, 'selected');
      await call('tasks.transition', { taskId: 'task_d', transition: 'complete' }, scope);
      const history = await call('tasks.history', { from: '2026-10-25', to: '2026-10-25' }, scope);
      assert.equal(history.ok, true);
      assert.equal(history.data.items[0].state, 'completed');
      assert.equal(history.data.entries, undefined);
      assert.equal(
        (await call('tasks.transition', { taskId: 'task_d', transition: 'select' }, scope)).error
          .code,
        'CONFLICT',
      );
    },
    options,
  );
});

test('account changes and old request scopes cannot write to the newly selected owner', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const { call, state } = client(nativeDb),
        scopeA = (await call('account.session')).data.scope;
      state.context = context('synthetic_b');
      const before = state.opens;
      assert.equal((await call('tasks.mine', {}, scopeA)).error.code, 'FORBIDDEN');
      assert.equal(state.opens, before);
      state.env = env({ MOODSKY_PILOT_OPERATOR_FINGERPRINT: operatorFingerprint('synthetic_b') });
      const scopeB = (await call('account.session')).data.scope;
      assert.notEqual(scopeA, scopeB);
      const original = inspect();
      const result = await call(
        'tasks.transition',
        { taskId: 'task_a', transition: 'complete' },
        scopeA,
        'req_old_owner_retry',
      );
      assert.equal(result.error.code, 'UNAUTHENTICATED');
      assert.deepEqual(inspect(), original);
      assert.equal(
        (await call('tasks.history', { from: '2026-10-25', to: '2026-10-25' }, scopeB)).data.items
          .length,
        0,
      );
    },
    options,
  );
});

test('disabled, expired, malformed and missing pilot configuration never opens the database', async () => {
  const variants = [
    { MOODSKY_PRIVATE_PILOT_ENABLED: 'false' },
    { MOODSKY_PILOT_ACCOUNT_INDEX_VERIFIED: 'false' },
    { MOODSKY_PILOT_RECEIPT_KEY_BASE64: 'not-a-key' },
    { MOODSKY_PILOT_OPERATOR_FINGERPRINT: 'bad' },
    { MOODSKY_PILOT_EXPIRES_AT: '2026-10-25T03:00:00.000Z' },
    { MOODSKY_PILOT_EXPIRES_AT: '2026-10-27T04:00:00.000Z' },
    { MOODSKY_PILOT_TEST_DATE: '2026-10-24' },
  ];
  for (const extra of variants) {
    const c = readPilotConfig(env(extra), NOW);
    assert.equal(c, null);
    const main = createPilotEntry({
      readContext: () => context('synthetic_a'),
      readConfig: () => c,
      openDatabase() {
        throw Error('Must stay closed');
      },
    });
    const result = await main({
      request: {
        apiVersion: '1',
        requestId: 'req_pilot_closed',
        action: 'account.session',
        payload: {},
      },
    });
    assert.equal(result.error.code, 'NOT_IMPLEMENTED');
  }
});

test('unexpected transport and identity metadata cannot unlock a configured pilot', async () => {
  const main = createPilotEntry({
    readContext: () => context('another_operator'),
    readConfig: () => readPilotConfig(env(), NOW),
    openDatabase() {
      throw Error('Must stay closed');
    },
  });
  const request = {
    apiVersion: '1',
    requestId: 'req_transport_001',
    action: 'account.session',
    payload: {},
  };
  assert.equal((await main({ ...request })).error.code, 'INVALID_REQUEST');
  assert.equal(
    (
      await main({
        request,
        userInfo: { OPENID: 'synthetic_a' },
        tcbContext: context('synthetic_a'),
      })
    ).error.code,
    'FORBIDDEN',
  );
  assert.equal(
    (await main({ request, sessionScope: ['scope_' + 'a'.repeat(64)] })).error.code,
    'INVALID_REQUEST',
  );
});

test('pilot refuses unrelated writes, other dates and nonsynthetic input before database access', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb }) => {
      const { call, state } = client(nativeDb),
        scope = (await call('account.session')).data.scope;
      const before = state.opens;
      for (const [action, payload, code] of [
        ['account.close', {}, 'NOT_IMPLEMENTED'],
        ['review.decorations', { month: '2026-10', operation: 'set' }, 'NOT_IMPLEMENTED'],
        [
          'journal.upsert',
          { date: '2026-10-24', weather: 'SUNNY', expectedVersion: 0 },
          'INVALID_INPUT',
        ],
        [
          'journal.upsert',
          { date: '2026-10-25', weather: 'SUNNY', text: 'private real input', expectedVersion: 0 },
          'INVALID_INPUT',
        ],
      ]) {
        assert.equal((await call(action, payload, scope)).error.code, code);
      }
      assert.equal(state.opens, before);
    },
    options,
  );
});

test('pilot identity never reuses or migrates the real account for the same WeChat caller', async () => {
  const real = {
    _id: 'real_account',
    openid: 'synthetic_a',
    status: 'active',
    journalLayout: 'legacy-retained',
  };
  await withOfflineWxDatabase(
    { ...seed(), 'accounts:real_account': real },
    async ({ nativeDb, inspect }) => {
      const { call } = client(nativeDb);
      const session = await call('account.session');
      assert.equal(session.ok, true, JSON.stringify(session));
      assert.deepEqual(inspect()['accounts:real_account'], real);
      const accounts = Object.entries(inspect())
        .filter(([key]) => key.startsWith('accounts:'))
        .map(([, row]) => row);
      assert.equal(accounts.length, 2);
      assert.equal(
        accounts.find((row) => row._id !== 'real_account').identityKind,
        'restricted-pilot-hmac-v1',
      );
    },
    options,
  );
});
