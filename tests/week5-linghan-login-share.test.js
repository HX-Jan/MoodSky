const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createProductionAccountController } = require('../miniprogram/modules/account/production');
const { createAppShare, enableAppShare } = require('../miniprogram/modules/share/app-share');

const root = path.resolve(__dirname, '..');
const A = 'scope_' + 'a'.repeat(64);
const B = 'scope_' + 'b'.repeat(64);

function loadLogin({ state, login, platform }) {
  const file = path.join(root, 'miniprogram/pages/login/index.js');
  const localRequire = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(page) {
      definition = page;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../../config/environment.local') {
        return { releaseProfile: 'production' };
      }
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../modules/account/cloud-session') {
        return { createCloudSession: () => login };
      }
      return localRequire(id);
    },
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

function accountFixture(submit) {
  const session = createSessionState();
  session.accept(A);
  const patches = [];
  const controller = createProductionAccountController({
    session,
    publish: (patch) => patches.push(patch),
    storage: {
      getStorageSync() {},
      setStorageSync() {},
    },
    service: {
      authenticate: async () => true,
      preferences: async () => ({
        ok: true,
        data: { cardTextPreview: false, decorationsEnabled: true },
      }),
      createPreferences: (payload) => createRequest('account.preferences', payload),
      createExport: (format) => createRequest('account.requestExport', { format }),
      createClose: () => createRequest('account.close', { confirm: 'CLOSE' }),
      submit,
      exportStatus: async () => {
        throw new Error('not used');
      },
      download: async () => {
        throw new Error('not used');
      },
      recoverClose: async () => {
        throw new Error('not used');
      },
      cleanupStatus: async () => {
        throw new Error('not used');
      },
    },
  });
  return { controller, session, latest: () => patches.at(-1) };
}

test('W5-L W5-R03 keeps guest browsing available when privacy authorization is cancelled', async () => {
  const state = createSessionState();
  let refreshes = 0;
  const opened = [];
  const platform = {
    requirePrivacyAuthorize({ fail }) {
      fail();
    },
    switchTab(input) {
      opened.push(input.url);
    },
    setStorageSync() {},
  };
  const page = loadLogin({
    state,
    platform,
    login: {
      refresh: async () => {
        refreshes++;
      },
      getErrorCode: () => '',
      dispose() {},
    },
  });
  page.onLoad();
  page.onAgreement({ detail: { value: ['agree'] } });
  await page.onWechatLogin();
  assert.equal(refreshes, 0);
  assert.equal(state.capture(), null);
  assert.match(page.data.wechatLoginNotice, /稍后再登录/);
  page.onBrowse();
  assert.deepEqual(opened, ['/pages/today/index']);
});

test('W5-L W5-R03 returns a successful login only to a sanitized original page', async () => {
  const state = createSessionState();
  const opened = [];
  const platform = {
    requirePrivacyAuthorize({ success }) {
      success();
    },
    reLaunch(input) {
      opened.push(input.url);
    },
    setStorageSync() {},
  };
  const login = {
    async refresh() {
      state.accept(A);
    },
    getErrorCode: () => '',
    dispose() {},
  };
  const page = loadLogin({ state, login, platform });
  page.onLoad({
    returnTo: '/pages/review/detail/index?date=2026-11-01&id=PRIVATE&text=PRIVATE_BODY',
  });
  page.onAgreement({ detail: { value: ['agree'] } });
  await page.onWechatLogin();
  assert.equal(page.data.wechatAuthenticated, true);
  assert.deepEqual(opened, ['/pages/review/detail/index?fromShare=page&date=2026-11-01']);
  assert.doesNotMatch(opened[0], /PRIVATE|(?:[?&])(id|text)=/);
});

test('W5-L W5-R03 does not restore a disabled account or report a false login success', async () => {
  const state = createSessionState();
  const opened = [];
  const page = loadLogin({
    state,
    platform: {
      requirePrivacyAuthorize({ success }) {
        success();
      },
      switchTab(input) {
        opened.push(input.url);
      },
      setStorageSync() {},
    },
    login: {
      refresh: async () => false,
      getErrorCode: () => 'ACCOUNT_DISABLED',
      dispose() {},
    },
  });
  page.onLoad();
  page.onAgreement({ detail: { value: ['agree'] } });
  await page.onWechatLogin();
  assert.equal(state.capture(), null);
  assert.equal(page.data.wechatAuthenticated, false);
  assert.match(page.data.wechatLoginNotice, /账号已注销/);
  assert.deepEqual(opened, []);
});

test('W5-L W5-R05 enables friend and timeline sharing without private fields', () => {
  const menus = [];
  enableAppShare({ showShareMenu: (input) => menus.push(input.menus) });
  assert.deepEqual(menus, [['shareAppMessage', 'shareTimeline']]);

  const share = createAppShare({ route: 'pages/review/detail/index' });
  const page = {
    data: {
      date: '2026-11-01',
      text: 'PRIVATE_BODY',
      accountId: 'PRIVATE_ACCOUNT',
      recordId: 'PRIVATE_RECORD',
      receipt: 'PRIVATE_RECEIPT',
      sessionScope: 'PRIVATE_SESSION',
      exportToken: 'PRIVATE_EXPORT',
    },
    options: {
      id: 'PRIVATE_RECORD',
      receipt: 'PRIVATE_RECEIPT',
    },
  };
  const friend = share.onShareAppMessage.call(page);
  const timeline = share.onShareTimeline.call(page);
  const serialized = JSON.stringify({ friend, timeline });
  assert.match(friend.path, /fromShare=page&date=2026-11-01/);
  assert.match(timeline.query, /fromShare=page&date=2026-11-01/);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_BODY|PRIVATE_ACCOUNT|PRIVATE_RECORD|PRIVATE_RECEIPT|PRIVATE_SESSION|PRIVATE_EXPORT/,
  );
});

test('W5-L W5-R05 keeps scene 1154 static without cloud, runtime, or recovery requests', () => {
  const file = path.join(root, 'miniprogram/app.js');
  const localRequire = createRequire(file);
  const calls = { start: 0, refresh: 0, cloud: 0, recovery: 0 };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    App(app) {
      definition = app;
    },
    wx: {
      cloud: {
        init() {
          calls.cloud++;
        },
      },
    },
    require(id) {
      if (id === './config/environment.local') {
        return { cloudEnabled: true, cloudEnvId: 'synthetic-cloud' };
      }
      if (id === './modules/system/runtime') {
        return {
          appRuntime: {
            start: () => calls.start++,
            refreshNetwork: () => calls.refresh++,
          },
        };
      }
      if (id === './modules/system/navigation') {
        return { goHome: () => calls.recovery++ };
      }
      return localRequire(id);
    },
  });
  definition.onLaunch({ scene: 1154 });
  definition.onShow({ scene: 1154 });
  definition.onPageNotFound();
  assert.deepEqual(calls, { start: 0, refresh: 0, cloud: 0, recovery: 0 });
});

for (const [name, response] of [
  ['contradictory', { ok: true, data: { cardTextPreview: false, decorationsEnabled: true } }],
  ['incomplete', { ok: true, data: { cardTextPreview: true } }],
]) {
  test(`W5-L W5-R10 rejects a ${name} preference receipt without a false success`, async () => {
    const fixture = accountFixture(async () => response);
    await fixture.controller.load();
    await fixture.controller.savePreference('cardTextPreview', true);
    assert.equal(fixture.latest().pendingKind, 'preferences');
    assert.match(fixture.latest().notice, /偏好保存结果尚未确认/);
    assert.doesNotMatch(fixture.latest().notice, /偏好已保存到云端/);
  });
}

test('W5-L W5-R03 rejects account A late private response after account B signs in', async () => {
  let release;
  const fixture = accountFixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await fixture.controller.load();
  const pending = fixture.controller.savePreference('cardTextPreview', true);
  await Promise.resolve();
  fixture.session.accept(B);
  assert.deepEqual(fixture.latest().preferences, {});
  assert.equal(fixture.latest().authenticated, false);
  release({ ok: true, data: { cardTextPreview: true, decorationsEnabled: true } });
  await pending;
  assert.deepEqual(fixture.latest().preferences, {});
  assert.match(fixture.latest().notice, /账号状态已变化/);
});
