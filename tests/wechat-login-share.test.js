// Actual page, API and production entry with synthetic transport and database only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createCloudSession } = require('../miniprogram/modules/account/cloud-session');
const { createRequest } = require('../miniprogram/services/api');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { databaseFixture } = require('./helpers/w2-database');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const { createAppShare, enableAppShare } = require('../miniprogram/modules/share/app-share');
const root = path.resolve(__dirname, '..');
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function loadPage(name, overrides = {}, platform = {}) {
  const file = path.join(root, 'miniprogram', name + '.js');
  const localRequire = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (page) => {
      definition = page;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    require: (id) => overrides[id] || localRequire(id),
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    updates: 0,
    setData(patch) {
      Object.assign(this.data, patch);
      this.updates++;
    },
  };
}
function productionApi(platform, state) {
  const file = path.join(root, 'miniprogram/services/api.js');
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module,
    setTimeout,
    clearTimeout,
    wx: platform,
    require(id) {
      if (id === '../config/environment.local') {
        return {
          cloudEnabled: true,
          cloudEnvId: ENV_ID,
          cloudFunctionName: 'moodsky-release',
          releaseProfile: 'production',
          trustedSessionEnabled: true,
        };
      }
      if (id === './session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../modules/account/cloud-session') {
        return { ensureCloudSession: async () => Boolean(state.capture()) };
      }
      return localRequire(id);
    },
  });
  return module.exports;
}
function client(db, who, { beforeCall, state = createSessionState() } = {}) {
  const sent = [];
  const identity = {
    APPID: APP_ID,
    ENV: ENV_ID,
    SOURCE: 'wx_client',
    OPENID: who,
    identityFromCurrentInvocation: true,
  };
  const entry = createProductionEntry({
    readIdentity: () => identity,
    readConfig: () => config,
    openDatabase: () => db,
    now: () => new Date('2026-11-01T04:00:00.000Z'),
  });
  const api = productionApi(
    {
      cloud: {
        async callFunction(input) {
          sent.push(input);
          if (beforeCall) {
            await beforeCall(input);
          }
          return { result: await entry(input.data) };
        },
      },
    },
    state,
  );
  const page = loadPage(
    'pages/login/index',
    {
      '../../config/environment.local': { releaseProfile: 'production' },
      '../../services/session-state': { cloudSessionState: state },
      '../../modules/account/cloud-session': {
        createCloudSession: () =>
          createCloudSession({
            state,
            authenticate: () => api.call(createRequest('account.session')),
          }),
      },
    },
    {
      getStorageSync() {
        throw Error('Login must not use local demo identities or cached credentials');
      },
      switchTab() {},
      setStorageSync() {},
    },
  );
  page.onLoad();
  page.onAgreement({ detail: { value: ['agree'] } });
  return {
    page,
    state,
    sent,
    identity,
    api,
    call: (action, payload) => api.call(createRequest(action, payload)),
  };
}

test('WeChat login page reaches the production handshake; separate users save separate records after opening a shared app', async () => {
  const { db } = databaseFixture();
  const a = client(db, 'synthetic_sender'),
    b = client(db, 'synthetic_recipient');
  assert.equal(a.page.data.wechatAuthenticated, false);
  assert.equal(a.sent.length, 0);
  await a.page.onWechatLogin();
  assert.equal(a.page.data.wechatAuthenticated, true);
  assert.equal(a.sent[0].data.action, 'account.session');
  assert.deepEqual(a.sent[0].data.payload, {});
  assert.equal(a.sent[0].data.sessionScope, undefined);
  await b.page.onWechatLogin();
  assert.equal(b.page.data.wechatAuthenticated, true);
  assert.notEqual(a.state.capture().scope, b.state.capture().scope);
  await a.call('journal.upsert', {
    date: '2026-11-01',
    weather: 'SUNNY',
    tags: [],
    text: 'synthetic sender private text',
    expectedVersion: 0,
  });
  const own = await a.call('journal.get', { date: '2026-11-01' });
  const other = await b.call('journal.get', { date: '2026-11-01' });
  assert.match(JSON.stringify(own.data), /synthetic sender private text/);
  assert.doesNotMatch(JSON.stringify(other.data), /synthetic sender private text/);
  assert.doesNotMatch(
    JSON.stringify(a.page.data),
    /synthetic_sender|scope_[a-f0-9]+|openid|session_key/,
  );
  a.page.onUnload();
  b.page.onUnload();
});

test('repeated login taps send one request and revalidation preserves the current account scope', async () => {
  const gate = deferred();
  const f = client(databaseFixture().db, 'synthetic_user', { beforeCall: () => gate.promise });
  const first = f.page.onWechatLogin();
  await f.page.onWechatLogin();
  assert.equal(f.sent.length, 1);
  assert.equal(f.page.data.wechatLoginBusy, true);
  gate.resolve();
  await first;
  const binding = f.state.capture();
  await f.page.onWechatLogin();
  assert.equal(f.state.capture(), binding);
  assert.equal(f.page.data.wechatLoginBusy, false);
  f.page.onUnload();
});

test('failed login is retryable without displaying a successful or demo login', async () => {
  let fail = true;
  const f = client(databaseFixture().db, 'synthetic_user', {
    beforeCall: () => {
      if (fail) {
        throw Error('synthetic network failure');
      }
    },
  });
  await f.page.onWechatLogin();
  assert.equal(f.page.data.wechatAuthenticated, false);
  assert.equal(f.state.capture(), null);
  assert.match(f.page.data.wechatLoginNotice, /检查网络后重试/);
  fail = false;
  await f.page.onWechatLogin();
  assert.equal(f.page.data.wechatAuthenticated, true);
  f.state.clear();
  assert.equal(f.state.capture(), null);
  f.page.onUnload();
});

test('a closed WeChat account cannot log in again and the login page displays its disabled status', async () => {
  const f = client(databaseFixture().db, 'synthetic_closed_user');
  await f.page.onWechatLogin();
  await f.call('account.close', { confirm: 'CLOSE' });
  await f.page.onWechatLogin();
  assert.equal(f.page.data.wechatAuthenticated, false);
  assert.match(f.page.data.wechatLoginNotice, /已注销/);
  assert.equal(f.state.capture(), null);
  f.page.onUnload();
});

for (const event of ['onHide', 'onUnload']) {
  test('a late login cannot change identity or update a page after ' + event, async () => {
    const gate = deferred();
    const f = client(databaseFixture().db, 'synthetic_late', { beforeCall: () => gate.promise });
    const pending = f.page.onWechatLogin();
    f.page[event]();
    const count = f.page.updates;
    gate.resolve();
    await pending;
    assert.equal(f.page.updates, count);
    assert.equal(f.state.capture(), null);
    f.page.onUnload();
  });
}

test('a newer shared session wins over a late login result without a false signed-out badge', async () => {
  const gate = deferred();
  const f = client(databaseFixture().db, 'synthetic_old', { beforeCall: () => gate.promise });
  const pending = f.page.onWechatLogin();
  const newer = f.state.accept('scope_' + 'b'.repeat(64));
  gate.resolve();
  await pending;
  assert.equal(f.state.capture(), newer);
  assert.equal(f.page.data.wechatAuthenticated, true);
  f.page.onUnload();
});

test('every registered page shares its own route and a local image without private page content', () => {
  const app = require('../miniprogram/app.json');
  for (const name of app.pages) {
    const page = loadPage(name);
    const message = page.onShareAppMessage.call(
      {
        data: {
          text: 'PRIVATE',
          accountId: 'PRIVATE',
          receipt: 'PRIVATE',
          date: 'PRIVATE',
          weatherName: 'PRIVATE',
        },
      },
      { from: 'button', target: { dataset: { path: '/pages/review/detail/index?id=PRIVATE' } } },
    );
    assert.equal(message.path.split('?')[0], '/' + name, name);
    assert.equal(message.imageUrl, '/assets/jiaqi/PARTLY_CLOUDY.png', name);
    assert.ok(fs.existsSync(path.join(root, 'miniprogram', message.imageUrl)));
    assert.doesNotMatch(JSON.stringify(message), /PRIVATE|receipt|scope_|accountId|date=/);
    const timeline = page.onShareTimeline.call({ data: {} }, { query: 'PRIVATE' });
    assert.match(timeline.query, /fromShare=page/);
    assert.equal(timeline.imageUrl, message.imageUrl);
    assert.equal(timeline.path, undefined);
  }
});

test('share menus expose both native actions without hiding timeline and unavailable menus do not break page use', () => {
  const shown = [],
    hidden = [];
  const platform = {
    showShareMenu: (input) => shown.push(input),
    hideShareMenu: (input) => hidden.push(input),
  };
  enableAppShare(platform, { timeline: true });
  enableAppShare(platform);
  assert.deepEqual(
    shown.map((x) => x.menus),
    [
      ['shareAppMessage', 'shareTimeline'],
      ['shareAppMessage', 'shareTimeline'],
    ],
  );
  assert.equal(hidden.length, 0);
  assert.doesNotThrow(() => enableAppShare({}));
  assert.doesNotThrow(() =>
    enableAppShare({
      showShareMenu() {
        throw Error('Unsupported');
      },
    }),
  );
  const first = createAppShare().onShareAppMessage();
  first.path = '/pages/review/detail/index?id=PRIVATE';
  assert.equal(createAppShare().onShareAppMessage().path, '/pages/today/index?fromShare=page');
});

test('the sign-in page binds login and production Me keeps native sharing', () => {
  const source = fs
    .readFileSync(path.join(root, 'miniprogram/pages/me/index.wxml'), 'utf8')
    .split('<view class="page" wx:if="{{isPilot}}">')[0];
  const login = fs.readFileSync(path.join(root, 'miniprogram/pages/login/index.wxml'), 'utf8');
  assert.match(
    login,
    /bindtap="onWechatLogin"[^>]+loading="\{\{wechatLoginBusy\}\}"[^>]+disabled="\{\{wechatLoginBusy\}\}"/,
  );
  assert.match(source, /<button[^>]+open-type="share"/);
  assert.doesNotMatch(login, /getUserProfile|getPhoneNumber/);
});
