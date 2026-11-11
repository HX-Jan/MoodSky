// W4 JF01 - production account resolution boundaries (Jiawei Fang).
// Synthetic local doubles only: no real WeChat login, no real cloud function.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production/index');
const {
  accountId,
  sessionScope,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const {
  createProductionAccounts,
  IDENTITY_KIND,
} = require('../cloudfunctions/moodsky/production/accounts');
const { databaseFixture } = require('./helpers/w2-database');

const CONFIG = {
  identityKey: Buffer.from('11'.repeat(32), 'hex'),
  sessionKey: Buffer.from('22'.repeat(32), 'hex'),
  receiptKey: Buffer.from('33'.repeat(32), 'hex'),
};
const ALPHA = 'trusted_openid_alpha';
const BETA = 'trusted_openid_beta';
const NOW = () => new Date('2026-11-07T02:00:00.000Z');
const idFor = (openid) => accountId(CONFIG, openid);
const scopeFor = (openid) => sessionScope(CONFIG, idFor(openid));

function harness({ seed = {} } = {}) {
  const fixture = databaseFixture(seed);
  let openid = ALPHA;
  let sequence = 0;
  const entry = createProductionEntry({
    readIdentity: () => ({
      identityFromCurrentInvocation: true,
      APPID: APP_ID,
      ENV: ENV_ID,
      SOURCE: 'wx_client',
      OPENID: openid,
    }),
    readConfig: () => CONFIG,
    openDatabase: () => fixture.db,
    now: NOW,
  });
  const send = (action, payload = {}, options = {}) => {
    const who = options.openid || openid;
    openid = who;
    return entry({
      apiVersion: '1',
      requestId: options.requestId || 'req_week4_jf01_' + ++sequence,
      action,
      payload,
      ...(options.scope ? { sessionScope: options.scope } : {}),
    });
  };
  return { fixture, send, idFor, scopeFor, use: (value) => (openid = value) };
}

test('JF01-W4-01 first entry before session is UNAUTHENTICATED and provisions nothing', async () => {
  const f = harness();
  const denied = await f.send(
    'account.preferences',
    { operation: 'get' },
    { scope: f.scopeFor(ALPHA) },
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'UNAUTHENTICATED');
  assert.match(denied.error.message, /账号尚未就绪/);
  assert.deepEqual(Object.keys(f.fixture.inspect()), []);
  const session = await f.send('account.session');
  assert.equal(session.ok, true, JSON.stringify(session));
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.scope, f.scopeFor(ALPHA));
  assert.deepEqual(session.data.capabilities, [
    'journal',
    'review',
    'tasks',
    'preferences',
    'export',
    'close',
  ]);
  const rows = f.fixture.inspect();
  assert.deepEqual(Object.keys(rows), ['accounts:' + f.idFor(ALPHA)]);
});

test('JF01-W4-02 repeated and concurrent logins reuse one active row and one scope', async () => {
  const f = harness();
  const [first, second] = await Promise.all([f.send('account.session'), f.send('account.session')]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(first.data.scope, second.data.scope);
  const rows = f.fixture.inspect();
  assert.deepEqual(Object.keys(rows), ['accounts:' + f.idFor(ALPHA)]);
  const row = rows['accounts:' + f.idFor(ALPHA)];
  assert.equal(row.status, 'active');
  assert.equal(row.identityKind, IDENTITY_KIND);
  // The raw OPENID is never stored; the deterministic account id is the only mapping.
  assert.equal(row.openid, f.idFor(ALPHA));
  assert.equal(JSON.stringify(rows).includes(ALPHA), false);
  assert.equal(row.journalLayout, 'deterministic-days-v1');
  assert.equal(row.taskLayout, 'deterministic-tasks-v1');
  assert.equal(row.journalRevision, 0);
  assert.equal(row.operationFence, 0);
  assert.equal(row.exportEpoch, 0);
  assert.deepEqual(row.sourceRevisions, {
    journals: 0,
    favorites: 0,
    tasks: 0,
    preferences: 0,
    decorations: 0,
  });
});

test("JF01-W4-03 one OPENID cannot read another account's preferences", async () => {
  const f = harness();
  assert.equal((await f.send('account.session', {}, { openid: BETA })).ok, true);
  const betaSaved = await f.send(
    'account.preferences',
    { operation: 'set', cardTextPreview: true },
    { openid: BETA, scope: f.scopeFor(BETA) },
  );
  assert.equal(betaSaved.ok, true, JSON.stringify(betaSaved));
  assert.equal((await f.send('account.session', {}, { openid: ALPHA })).ok, true);

  // A valid A session cannot borrow B's session scope.
  const crossScope = await f.send(
    'account.preferences',
    { operation: 'get' },
    { openid: ALPHA, scope: f.scopeFor(BETA) },
  );
  assert.equal(crossScope.ok, false);
  assert.equal(crossScope.error.code, 'UNAUTHENTICATED');
  assert.match(crossScope.error.message, /登录范围已变化/);

  // A still reads its own defaults, never B's saved value.
  const alphaRead = await f.send(
    'account.preferences',
    { operation: 'get' },
    { openid: ALPHA, scope: f.scopeFor(ALPHA) },
  );
  assert.equal(alphaRead.ok, true, JSON.stringify(alphaRead));
  assert.deepEqual(alphaRead.data, {
    cardTextPreview: false,
    decorationsEnabled: true,
    updatedAt: null,
  });
  assert.equal(f.fixture.inspect()['preferences:pref_' + f.idFor(BETA)].cardTextPreview, true);

  // A payload can never name the account or the owner.
  const injected = await f.send(
    'account.preferences',
    { operation: 'get', accountId: f.idFor(BETA) },
    { openid: ALPHA, scope: f.scopeFor(ALPHA) },
  );
  assert.equal(injected.ok, false);
  assert.equal(injected.error.code, 'INVALID_REQUEST');
});

test('JF01-W4-04 a disabled identity is refused before any action and is never re-provisioned', async () => {
  const f = harness();
  assert.equal((await f.send('account.session')).ok, true);
  const id = f.idFor(ALPHA);
  const created = f.fixture.inspect()['accounts:' + id];
  f.fixture.put('accounts', { ...created, status: 'disabled' });

  for (const action of ['account.session', 'account.preferences']) {
    const result = await f.send(
      action,
      action === 'account.preferences' ? { operation: 'get' } : {},
      { scope: f.scopeFor(ALPHA) },
    );
    assert.equal(result.ok, false, action);
    assert.equal(result.error.code, 'ACCOUNT_DISABLED', action);
  }
  const rows = f.fixture.inspect();
  assert.deepEqual(Object.keys(rows), ['accounts:' + id]);
  assert.equal(rows['accounts:' + id].status, 'disabled');
  assert.equal(rows['accounts:' + id].createdAt, created.createdAt);

  // The resolver itself reports the disabled status instead of rebuilding the row.
  const accounts = createProductionAccounts({ db: f.fixture.db, config: CONFIG, now: NOW });
  assert.deepEqual(await accounts.resolve(ALPHA), { id, status: 'disabled' });
  assert.deepEqual(await accounts.resolve(ALPHA, true), { id, status: 'disabled' });
});
