// Actual Page + API transport + session restoration + production entry.
// Native phone authorization and database/network access are synthetic only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { databaseFixture } = require('./helpers/w2-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { readServerConfig, APP_ID, ENV_ID } = require('../cloudfunctions/moodsky/production/config');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { forgetLogin } = require('../miniprogram/modules/account/login-memory');
const PHONE_KEY = 'moodsky-phone-session-v1';
const root = path.resolve(__dirname, '..');

function world() {
  const f = databaseFixture();
  let clock = new Date('2026-11-26T04:00:00Z');
  let exchanges = 0;
  const settings = {
    storage: 'server-deployment-config-v1',
    appId: APP_ID,
    environmentId: ENV_ID,
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_PHONE_LOGIN_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  };
  const entry = createProductionEntry({
    readIdentity: () => ({
      APPID: APP_ID,
      ENV: ENV_ID,
      OPENID: 'synthetic_phone_adapter',
      SOURCE: 'wx_client',
      identityFromCurrentInvocation: true,
    }),
    readConfig: () => readServerConfig({}, () => settings),
    openDatabase: () => f.db,
    now: () => clock,
    exchangePhone: async (code) => {
      exchanges++;
      assert.ok(['primary', 'other'].includes(code));
      return {
        errCode: 0,
        phoneInfo: {
          countryCode: '86',
          purePhoneNumber: code === 'primary' ? '13800000001' : '13800000002',
        },
      };
    },
  });
  return {
    ...f,
    entry,
    settings,
    exchanges: () => exchanges,
    expire: () => {
      clock = new Date(clock.getTime() + 8 * 86400000);
    },
  };
}

function client(server, storage = new Map(), { confirm = true, phoneLoginEnabled = true } = {}) {
  const state = createSessionState(),
    sent = [],
    navigations = [],
    modals = [];
  const environment = {
    cloudEnabled: true,
    cloudEnvId: ENV_ID,
    cloudFunctionName: 'moodsky-release',
    trustedSessionEnabled: true,
    releaseProfile: 'production',
    explicitWechatLogin: true,
    phoneLoginEnabled,
  };
  const platform = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    switchTab: ({ url }) => navigations.push(url),
    requirePrivacyAuthorize: ({ success }) => success(),
    showModal: (options) => {
      modals.push(options);
      options.success({ confirm });
    },
    cloud: {
      callFunction: async (input) => {
        assert.equal(input.name, 'moodsky-release');
        assert.equal(input.config.env, ENV_ID);
        sent.push(input.data);
        return { result: await server.entry(input.data) };
      },
    },
  };
  let definition;
  function load(relative, override) {
    const filename = path.join(root, 'miniprogram', relative);
    const localRequire = createRequire(filename),
      module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module,
      exports: module.exports,
      wx: platform,
      setTimeout,
      clearTimeout,
      Page: (value) => {
        definition = value;
      },
      require: (id) => override(id) || localRequire(id),
    });
    return module.exports;
  }
  const api = load('services/api.js', (id) => {
    if (id === '../config/environment.local') {
      return environment;
    }
    if (id === './session-state') {
      return { cloudSessionState: state };
    }
    if (id === '../modules/account/cloud-session') {
      return session;
    }
  });
  const session = load(
    'modules/account/cloud-session.js',
    (id) =>
      ({
        '../../config/environment.local': environment,
        '../../services/api': api,
        '../../services/session-state': { cloudSessionState: state },
      })[id],
  );
  load(
    'pages/login/index.js',
    (id) =>
      ({
        '../../config/environment.local': environment,
        '../../services/api': api,
        '../../services/session-state': { cloudSessionState: state },
        '../../modules/account/cloud-session': session,
      })[id],
  );
  const page = {
    ...definition,
    data: globalThis.structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad();
  page.onAgreement({ detail: { value: ['agree'] } });
  return { page, api, session, state, storage, sent, navigations, modals, platform };
}
const request = (c, action, payload = {}) => c.api.call(createRequest(action, payload));
const signIn = (c, code = 'primary') => c.page.onPhoneLogin({ detail: { code } });

test('WeChat-only release automatically registers once, restores the same account and never exchanges a phone code', async () => {
  const server = world();
  server.settings.MOODSKY_PHONE_LOGIN_ENABLED = 'false';
  const c = client(server, new Map(), { phoneLoginEnabled: false });
  assert.equal(c.page.data.phoneLoginEnabled, false);
  c.page.onAgreement({ detail: { value: [] } });
  await c.page.onWechatLogin();
  assert.equal(c.sent.length, 0);
  c.page.onAgreement({ detail: { value: ['agree'] } });
  await c.page.onWechatLogin();
  assert.equal(c.page.data.wechatAuthenticated, true);
  assert.equal(c.sent[0].action, 'account.session');
  const scope = c.state.capture().scope;
  await request(c, 'journal.upsert', {
    date: '2026-11-26',
    weather: 'SUNNY',
    tags: [],
    text: 'SYNTHETIC WECHAT ACCOUNT',
    expectedVersion: 0,
  });
  const reopened = client(server, c.storage, { phoneLoginEnabled: false });
  assert.equal(await reopened.session.ensureCloudSession(), true);
  assert.equal(reopened.state.capture().scope, scope);
  assert.equal(
    (await request(reopened, 'journal.get', { date: '2026-11-26' })).data.entry.text,
    'SYNTHETIC WECHAT ACCOUNT',
  );
  assert.equal(server.exchanges(), 0);
  assert.equal(c.storage.has(PHONE_KEY), false);
  assert.equal(Object.values(server.inspect()).filter((row) => row.status === 'active').length, 1);
});

test('continuing an already restored account does not silently switch its identity when the phone entry is hidden', async () => {
  const server = world(),
    previous = client(server);
  await signIn(previous);
  const oldScope = previous.state.capture().scope;
  const reopened = client(server, previous.storage, { phoneLoginEnabled: false });
  assert.equal(await reopened.session.ensureCloudSession(), true);
  reopened.page.onShow();
  const calls = reopened.sent.length;
  await reopened.page.onWechatLogin();
  assert.equal(reopened.state.capture().scope, oldScope);
  assert.equal(reopened.sent.length, calls);
  assert.deepEqual(reopened.navigations, ['/pages/me/index']);
  assert.equal(Object.values(server.inspect()).filter((row) => row.status === 'active').length, 1);
});

test('actual phone Page signs in through transport, persists the credential and restores only the selected account', async () => {
  const server = world();
  const a = client(server);
  await signIn(a);
  assert.equal(a.page.data.wechatAuthenticated, true);
  assert.equal(a.state.capture().phoneLabel, '138****0001');
  assert.ok(a.storage.get(PHONE_KEY));
  assert.deepEqual(a.navigations, ['/pages/me/index']);
  const scope = a.state.capture().scope;
  await request(a, 'journal.upsert', {
    date: '2026-11-26',
    weather: 'SUNNY',
    tags: [],
    text: 'SYNTHETIC ADAPTER A',
    expectedVersion: 0,
  });
  const reopened = client(server, a.storage);
  assert.equal(await reopened.session.ensureCloudSession(), true);
  assert.equal(reopened.state.capture().scope, scope);
  assert.equal(
    (await request(reopened, 'journal.get', { date: '2026-11-26' })).data.entry.text,
    'SYNTHETIC ADAPTER A',
  );
  const b = client(server);
  await signIn(b, 'other');
  assert.notEqual(b.state.capture().scope, scope);
  assert.equal((await request(b, 'journal.get', { date: '2026-11-26' })).data.entry, null);
  assert.equal(server.exchanges(), 2);
});

test('actual phone Page confirms empty re-registration and persists the new generation without restoring old data', async () => {
  const server = world(),
    a = client(server);
  await signIn(a);
  const old = a.state.capture();
  await request(a, 'journal.upsert', {
    date: '2026-11-26',
    weather: 'SUNNY',
    tags: [],
    text: 'SYNTHETIC DELETED',
    expectedVersion: 0,
  });
  await request(a, 'account.close', { confirm: 'CLOSE' });
  forgetLogin(a.platform);
  a.state.clear();
  const fresh = client(server, a.storage);
  await signIn(fresh);
  assert.equal(fresh.modals[0].title, '重新注册');
  assert.notEqual(fresh.state.capture().scope, old.scope);
  assert.ok(fresh.storage.get(PHONE_KEY));
  assert.equal((await request(fresh, 'journal.get', { date: '2026-11-26' })).data.entry, null);
  const reopened = client(server, fresh.storage);
  assert.equal(await reopened.session.ensureCloudSession(), true);
  assert.equal(reopened.state.capture().scope, fresh.state.capture().scope);
  assert.equal(
    (await server.entry({ ...createRequest('account.session'), phoneSession: old.phoneSession }))
      .error.code,
    'ACCOUNT_DISABLED',
  );
});

test('a remembered expired phone credential cannot block explicit WeChat account re-registration', async () => {
  const server = world(),
    c = client(server);
  const legacy = await c.api
    .createApiClient(
      c.platform,
      {
        cloudEnabled: true,
        cloudEnvId: ENV_ID,
        cloudFunctionName: 'moodsky-release',
        releaseProfile: 'production',
      },
      { sessionState: c.state, ignorePhoneSession: true },
    )
    .call(createRequest('account.session'));
  c.state.accept(legacy.data.scope);
  await request(c, 'account.close', { confirm: 'CLOSE' });
  c.state.clear();
  const phone = await server.entry(
    createRequest('account.phoneLogin', { mode: 'login', code: 'other' }),
  );
  c.storage.set(PHONE_KEY, phone.data.phoneSession);
  server.expire();
  const reopened = client(server, c.storage);
  await reopened.page.onWechatLogin();
  assert.equal(reopened.page.data.registrationAvailable, true);
  await reopened.page.onWechatLogin();
  assert.equal(reopened.page.data.wechatAuthenticated, true);
  assert.notEqual(reopened.state.capture().scope, legacy.data.scope);
  assert.equal(reopened.state.capture().phoneSession, undefined);
  assert.equal(reopened.storage.has(PHONE_KEY), false);
  assert.equal(
    reopened.sent.some((r) => r.phoneSession !== undefined),
    false,
  );
});

test('health reports the effective phone switch and disabled server never exchanges a code or creates an account', async () => {
  const server = world(),
    c = client(server);
  assert.equal((await request(c, 'system.health')).data.phoneLoginEnabled, true);
  server.settings.MOODSKY_PHONE_LOGIN_ENABLED = 'false';
  assert.equal((await request(c, 'system.health')).data.phoneLoginEnabled, false);
  await signIn(c);
  assert.equal(c.state.capture(), null);
  assert.match(c.page.data.wechatLoginNotice, /手机号登录暂不可用/);
  assert.equal(server.exchanges(), 0);
  assert.deepEqual(server.inspect(), {});
});
