// W4 JF04 - preferences contract through the production entry and the shipped
// account controller. Synthetic local doubles only: no real cloud or account.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production/index');
const {
  accountId,
  sessionScope,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const { createProductionAccounts } = require('../cloudfunctions/moodsky/production/accounts');
const { createProductionAccountController } = require('../miniprogram/modules/account/production');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const { DEFAULT_PREFERENCES } = require('../miniprogram/shared/constants');
const { databaseFixture } = require('./helpers/w2-database');

const CONFIG = {
  identityKey: Buffer.from('44'.repeat(32), 'hex'),
  sessionKey: Buffer.from('55'.repeat(32), 'hex'),
  receiptKey: Buffer.from('66'.repeat(32), 'hex'),
};
const OPENID = 'trusted_openid_preferences';
const NOW = () => new Date('2026-11-07T03:00:00.000Z');
const idFor = (openid) => accountId(CONFIG, openid);
const scopeFor = (openid) => sessionScope(CONFIG, idFor(openid));

function productionHarness() {
  const fixture = databaseFixture({});
  let sequence = 0;
  const makeEntry = () =>
    createProductionEntry({
      readIdentity: () => ({
        identityFromCurrentInvocation: true,
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID,
      }),
      readConfig: () => CONFIG,
      openDatabase: () => fixture.db,
      now: NOW,
    });
  let entry = makeEntry();
  const send = (action, payload = {}) =>
    entry({
      apiVersion: '1',
      requestId: 'req_week4_jf04_' + ++sequence,
      action,
      payload,
      ...(action === 'account.session' ? {} : { sessionScope: scopeFor(OPENID) }),
    });
  return { fixture, send, restart: () => (entry = makeEntry()) };
}

test('JF04-W4-01 production entry serves defaults, narrows fields, persists and re-reads', async () => {
  const f = productionHarness();
  assert.equal((await f.send('account.session')).ok, true);

  const defaults = await f.send('account.preferences', { operation: 'get' });
  assert.equal(defaults.ok, true, JSON.stringify(defaults));
  assert.deepEqual(defaults.data, { ...DEFAULT_PREFERENCES, updatedAt: null });

  const before = f.fixture.inspect();
  for (const payload of [
    { operation: 'set', cardTextPreview: 'yes' },
    { operation: 'set', cardTextPreview: true, nickname: 'x' },
    { operation: 'set' },
    { operation: 'get', decorationsEnabled: true },
  ]) {
    const rejected = await f.send('account.preferences', payload);
    assert.equal(rejected.ok, false, JSON.stringify(payload));
    assert.equal(rejected.error.code, 'INVALID_INPUT', JSON.stringify(payload));
  }
  assert.deepEqual(f.fixture.inspect(), before);

  const saved = await f.send('account.preferences', {
    operation: 'set',
    cardTextPreview: true,
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.deepEqual(saved.data, {
    cardTextPreview: true,
    decorationsEnabled: true,
    updatedAt: NOW().toISOString(),
  });
  const reread = await f.send('account.preferences', { operation: 'get' });
  assert.deepEqual(reread.data, saved.data);

  // "Restart": a fresh entry instance over the same storage reads the saved row.
  f.restart();
  assert.equal((await f.send('account.session')).ok, true);
  const afterRestart = await f.send('account.preferences', { operation: 'get' });
  assert.deepEqual(afterRestart.data, saved.data);
});

test('JF04-W4-02 the trusted preference writer rejects unknown keys before writing', async () => {
  const fixture = databaseFixture({});
  const accounts = createProductionAccounts({ db: fixture.db, config: CONFIG, now: NOW });
  const owner = await accounts.resolve(OPENID, true);
  assert.equal(owner.status, 'active');
  const stamp = NOW().toISOString();

  for (const patch of [
    { nickname: 'x' },
    { cardTextPreview: 'yes' },
    { cardTextPreview: true, profile: { nickname: 'x' } },
    {},
    null,
  ]) {
    assert.throws(() => accounts.store.updatePreferences(owner.id, patch, stamp), {
      code: 'INVALID_INPUT',
    });
  }
  assert.equal(fixture.inspect()['preferences:pref_' + owner.id], undefined);

  const saved = await accounts.store.updatePreferences(
    owner.id,
    { decorationsEnabled: false },
    stamp,
  );
  assert.equal(saved.cardTextPreview, false);
  assert.equal(saved.decorationsEnabled, false);
  const row = await accounts.store.getPreferences(owner.id);
  assert.equal(row.cardTextPreview, false);
  assert.equal(row.decorationsEnabled, false);
  const account = fixture.inspect()['accounts:' + owner.id];
  assert.equal(account.sourceRevisions.preferences, 1);
  assert.equal(account.exportEpoch, 1);
});

function controllerFixture(overrides = {}) {
  const storage = new Map();
  const session = createSessionState();
  session.accept('scope_' + 'a'.repeat(64));
  const patches = [];
  const sent = [];
  const service = {
    authenticate: async () => true,
    preferences: async () => ({
      ok: true,
      data: { cardTextPreview: false, decorationsEnabled: true },
    }),
    createPreferences: (payload) => createRequest('account.preferences', payload),
    createClose: () => createRequest('account.close', { confirm: 'CLOSE' }),
    submit: async (request) => {
      sent.push(request);
      return { ok: true, data: { cardTextPreview: true, decorationsEnabled: true } };
    },
    recoverClose: async () => {
      throw new Error('not used');
    },
    cleanupStatus: async () => {
      throw new Error('not used');
    },
    ...overrides,
  };
  const controller = createProductionAccountController({
    service,
    session,
    publish: (patch) => patches.push(patch),
    storage: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
    },
  });
  return { controller, session, sent, latest: () => patches.at(-1) };
}

test('JF04-W4-03 a failed save keeps the user selection and never claims cloud success', async () => {
  let fail = true;
  const f = controllerFixture({
    submit: async (request) => {
      f.sent.push(request);
      if (fail) {
        throw new AppError('NETWORK_ERROR', '连接未确认');
      }
      return {
        ok: true,
        data: { cardTextPreview: true, decorationsEnabled: true, updatedAt: NOW().toISOString() },
      };
    },
  });
  await f.controller.load();
  const saving = f.controller.savePreference('cardTextPreview', true);
  await Promise.resolve();
  // The unconfirmed write never becomes local truth: the switch still shows the
  // server value while the request stays queued for retry.
  assert.equal(f.latest().preferences.cardTextPreview, false);
  assert.equal(f.latest().pendingKind, 'preferences');
  await saving;

  assert.equal(f.latest().preferences.cardTextPreview, false);
  assert.equal(f.latest().preferences.decorationsEnabled, true);
  assert.equal(f.latest().pendingKind, 'preferences');
  assert.match(f.latest().notice, /尚未确认/);
  assert.doesNotMatch(f.latest().notice, /已保存到云端/);
  assert.equal(f.sent.length, 1);

  fail = false;
  const retriedId = f.sent[0].requestId;
  await f.controller.retry();
  // retry() replays the same request, so the user's choice is never re-asked.
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].requestId, retriedId);
  assert.deepEqual(f.latest().preferences, {
    cardTextPreview: true,
    decorationsEnabled: true,
    updatedAt: NOW().toISOString(),
  });
  assert.equal(f.latest().pendingKind, '');
  assert.equal(f.latest().notice, '偏好已保存到云端。');
});

test('JF04-W4-04 a partial server echo is INVALID_RESPONSE, not a saved preference', async () => {
  const f = controllerFixture({
    submit: async () => ({ ok: true, data: { cardTextPreview: true } }),
  });
  await f.controller.load();
  await f.controller.savePreference('cardTextPreview', true);
  assert.equal(f.latest().authenticated, true);
  assert.equal(f.latest().preferences.cardTextPreview, false);
  assert.equal(f.latest().pendingKind, 'preferences');
  assert.match(f.latest().notice, /尚未确认/);
  assert.doesNotMatch(f.latest().notice, /已保存到云端/);
});

test('JF04-W4-06 a receipt that echoes a different value is not treated as saved', async () => {
  const f = controllerFixture({
    submit: async () => ({
      ok: true,
      // Both keys are present and boolean, but cardTextPreview comes back false
      // while the request submitted true: the write is unconfirmed.
      data: { cardTextPreview: false, decorationsEnabled: true },
    }),
  });
  await f.controller.load();
  await f.controller.savePreference('cardTextPreview', true);
  assert.equal(f.latest().authenticated, true);
  assert.equal(f.latest().preferences.cardTextPreview, false);
  assert.equal(f.latest().pendingKind, 'preferences');
  assert.match(f.latest().notice, /尚未确认/);
  assert.doesNotMatch(f.latest().notice, /已保存到云端/);
});

test('JF04-W4-05 an invalidated session clears private choices and reports the server code', async () => {
  const f = controllerFixture({
    submit: async () => {
      throw new AppError('ACCOUNT_DISABLED', '账号已停用。');
    },
  });
  await f.controller.load();
  await f.controller.savePreference('decorationsEnabled', false);
  assert.equal(f.session.capture(), null);
  assert.equal(f.latest().authenticated, false);
  assert.deepEqual(f.latest().preferences, {});
  assert.equal(f.latest().pendingKind, '');
  assert.match(f.latest().notice, /账号状态已变化/);
});
