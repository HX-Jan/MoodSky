const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createSessionState, cloudSessionState } = require('../miniprogram/services/session-state');
const {
  LOGIN_KEY,
  forgetLogin,
  hasRememberedLogin,
} = require('../miniprogram/modules/account/login-memory');
const { prepareSharedPage } = require('../miniprogram/modules/share/app-share');
const { createRequest } = require('../miniprogram/services/api');

const root = path.resolve(__dirname, '..');
const A = 'scope_' + 'a'.repeat(64);
const B = 'scope_' + 'b'.repeat(64);
const content = 'SYNTHETIC private export';
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const stubPage = () => {
  const data = {};
  return {
    data,
    setData(patch) {
      Object.assign(data, patch);
    },
  };
};

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
        return { releaseProfile: 'production', explicitWechatLogin: true };
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

function mePage(state, platform) {
  const file = path.join(root, 'miniprogram/pages/me/index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../modules/system/runtime') {
        return { appRuntime: { getWorkStatus: () => ({ pending: false, draft: false }) } };
      }
      if (id === '../../config/environment.local') {
        return { releaseProfile: 'production' };
      }
      return local(id);
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

function profilePage(state, api, platform) {
  const file = path.join(root, 'miniprogram/pages/profile/index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../../services/api') {
        return api;
      }
      if (id === '../../config/environment.local') {
        return { releaseProfile: 'production' };
      }
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      return local(id);
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

async function accountFixture(options = {}) {
  const format = options.format || 'json';
  const extension = format === 'markdown' ? 'md' : 'json';
  const file = path.resolve(root, 'miniprogram/pages/account/index.js');
  const local = createRequire(file);
  const session = createSessionState();
  session.accept(A);
  const writes = [];
  const shares = [];
  const removed = [];
  const storage = new Map();
  let releaseDownload;
  const platform = {
    env: { USER_DATA_PATH: '/synthetic-local' },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getFileSystemManager: () => ({
      writeFile: (input) => writes.push(input),
      unlink: (input) => removed.push(input.filePath),
    }),
    shareFileMessage(input) {
      shares.push(input);
      input.fail({ errMsg: 'shareFileMessage:fail cancel' });
    },
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => (definition = value),
    wx: platform,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {
          releaseProfile: 'production',
          cloudEnabled: true,
          cloudEnvId: 'synthetic-only',
          trustedSessionEnabled: true,
        };
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: session };
      }
      if (id.endsWith('/modules/account/cloud-session')) {
        return { ensureCloudSession: async () => true };
      }
      if (id.endsWith('/services/api')) {
        return {
          createRequest,
          async call(request) {
            if (request.action === 'account.preferences') {
              return { ok: true, data: { cardTextPreview: false, decorationsEnabled: false } };
            }
            if (request.action === 'account.requestExport') {
              return {
                ok: true,
                data: { jobId: 'synthetic_file', format, state: 'ready' },
              };
            }
            if (request.action === 'account.downloadExport') {
              if (options.gateDownload) {
                return new Promise((resolve) => {
                  releaseDownload = resolve;
                });
              }
              return {
                ok: true,
                data: { jobId: 'synthetic_file', extension, content },
              };
            }
            throw new Error('Unexpected synthetic request: ' + request.action);
          },
        };
      }
      return local(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad();
  await flush();
  assert.equal(page.data.authenticated, true);
  page.onExport({ currentTarget: { dataset: { format } } });
  await flush();
  assert.equal(page.data.exportJob.state, 'ready');
  return {
    page,
    session,
    writes,
    shares,
    removed,
    storage,
    platform,
    releaseDownload: (response) => releaseDownload(response),
  };
}

test('W6-L a failed login attempt reports a retryable notice without binding a session or remembering the login', async () => {
  const state = createSessionState();
  const opened = [];
  const storage = new Map();
  const page = loadLogin({
    state,
    platform: {
      requirePrivacyAuthorize({ success }) {
        success();
      },
      reLaunch: (input) => opened.push(input.url),
      switchTab: (input) => opened.push(input.url),
      setStorageSync: (key, value) => storage.set(key, value),
    },
    login: {
      refresh: async () => false,
      getErrorCode: () => '',
      dispose() {},
    },
  });
  page.onLoad();
  page.onAgreement({ detail: { value: ['agree'] } });
  await page.onWechatLogin();
  assert.equal(state.capture(), null);
  assert.equal(page.data.wechatAuthenticated, false);
  assert.equal(page.data.wechatLoginBusy, false);
  assert.match(page.data.wechatLoginNotice, /微信登录未完成.*检查网络/);
  assert.deepEqual([...storage.keys()], []);
  assert.deepEqual(opened, []);
});

for (const code of ['NOT_IMPLEMENTED', 'CLOUD_NOT_CONFIGURED']) {
  test(`W6-L an unavailable login channel (${code}) keeps the guest state without a false success`, async () => {
    const state = createSessionState();
    const page = loadLogin({
      state,
      platform: {
        requirePrivacyAuthorize({ success }) {
          success();
        },
        reLaunch() {},
        setStorageSync() {},
      },
      login: {
        refresh: async () => false,
        getErrorCode: () => code,
        dispose() {},
      },
    });
    page.onLoad();
    page.onAgreement({ detail: { value: ['agree'] } });
    await page.onWechatLogin();
    assert.equal(state.capture(), null);
    assert.equal(page.data.wechatAuthenticated, false);
    assert.match(page.data.wechatLoginNotice, /微信登录暂时不可用/);
  });
}

test('W6-L a guest opens public share landings without login while a private detail only loads through the safe entry', () => {
  cloudSessionState.clear();
  const redirected = [];
  const memory = new Map();
  const platform = {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    navigateTo: (input) => redirected.push(input.url),
    redirectTo: (input) => redirected.push(input.url),
  };
  const config = { releaseProfile: 'production', explicitWechatLogin: true, cloudEnabled: true };

  const tasksPage = stubPage();
  assert.equal(
    prepareSharedPage(tasksPage, platform, config, 'pages/tasks/index', {
      fromShare: 'page',
      view: 'suggestions',
    }),
    false,
  );
  assert.deepEqual(redirected, []);
  assert.equal(tasksPage.data.shareSinglePage, undefined);

  const campus = stubPage();
  assert.equal(
    prepareSharedPage(campus, platform, config, 'pages/campus/index', { fromShare: 'page' }),
    true,
  );
  assert.equal(campus.data.shareSinglePage, true);
  assert.match(campus.data.sharePageTitle, /校园地点/);
  assert.deepEqual(redirected, []);

  const detail = stubPage();
  assert.equal(
    prepareSharedPage(detail, platform, config, 'pages/review/detail/index', {
      fromShare: 'page',
      date: '2026-11-01',
      id: 'PRIVATE_ID',
      text: 'PRIVATE_BODY',
    }),
    true,
  );
  assert.deepEqual(redirected, [
    '/pages/login/index?returnTo=' +
      encodeURIComponent('/pages/review/detail/index?fromShare=page&date=2026-11-01'),
  ]);
  assert.doesNotMatch(redirected[0], /PRIVATE|id=|text=|scope_/);
  assert.equal(hasRememberedLogin(platform), false);
  cloudSessionState.clear();
});

test('W6-L the private landing safe entry can still be left for home without logging in', async () => {
  const state = createSessionState();
  const opened = [];
  const page = loadLogin({
    state,
    platform: {
      requirePrivacyAuthorize({ fail }) {
        fail();
      },
      switchTab: (input) => opened.push(input.url),
      setStorageSync() {},
    },
    login: {
      refresh: async () => {
        state.accept(A);
      },
      getErrorCode: () => '',
      dispose() {},
    },
  });
  page.onLoad({
    returnTo: '/pages/review/detail/index?fromShare=page&date=2026-11-01',
  });
  page.onAgreement({ detail: { value: ['agree'] } });
  await page.onWechatLogin();
  assert.equal(state.capture(), null);
  page.onBrowse();
  assert.deepEqual(opened, ['/pages/today/index']);
});

test('W6-L skipping avatar and nickname keeps the default profile and unrelated functions usable', async (t) => {
  const state = createSessionState();
  state.accept(A);
  const memory = new Map();
  const me = mePage(state, {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
  });
  me.onLoad();
  me.loadWechatProfile = () => {};
  t.after(() => me.onUnload());
  me.onShow();
  assert.equal(me.data.wechatAuthenticated, true);
  assert.equal(me.data.profileNickname, '微信用户');
  assert.equal(me.data.profileAvatar, '/assets/jiaqi/user.png');

  const profile = profilePage(
    state,
    {
      createRequest(action, payload) {
        return { action, payload };
      },
      async call(request) {
        assert.equal(request.action, 'account.profile');
        return { ok: true, data: null };
      },
    },
    {},
  );
  profile.onLoad();
  await flush();
  assert.equal(profile.data.loaded, true);
  assert.equal(profile.data.nickname, '');
  assert.equal(profile.data.avatarData, '');
  assert.equal(profile.data.hasUnsavedChanges, false);
  assert.equal(profile.data.leaveWarning, '');
  profile.onUnload();
});

test('W6-L signing out clears the remembered flag, the visible export preview and private data', async () => {
  const f = await accountFixture();
  await f.page.onPreviewExport();
  assert.equal(f.page.data.exportPreview, content);
  assert.equal(f.page.data.exportPreviewTotal, 1);
  f.platform.setStorageSync(LOGIN_KEY, true);
  forgetLogin(f.platform);
  f.session.clear();
  assert.equal(f.page.data.exportPreview, '');
  assert.equal(f.page.data.exportPreviewTotal, 0);
  assert.equal(f.page._exportPreview, null);
  assert.equal(f.page.data.exportJob, null);
  assert.equal(f.page.data.authenticated, false);
  assert.equal(hasRememberedLogin(f.platform), false);
  assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC private export/);
  f.page.onUnload();
});

test('W6-L a late export download after sign-out delivers no file and no preview', async () => {
  const f = await accountFixture({ gateDownload: true });
  const saving = f.page.onSaveExport();
  await flush();
  assert.equal(f.writes.length, 0);
  forgetLogin(f.platform);
  f.session.clear();
  await flush();
  assert.equal(f.writes.length, 0);
  assert.equal(f.shares.length, 0);
  f.releaseDownload({ ok: true, data: { jobId: 'synthetic_file', extension: 'json', content } });
  await saving;
  await flush();
  assert.equal(f.writes.length, 0);
  assert.equal(f.shares.length, 0);
  assert.deepEqual(f.removed, []);
  assert.equal(f.page.data.exportPreview, '');
  assert.match(f.page.data.notice, /账号状态已变化/);
  assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC private export/);
  f.page.onUnload();
});

test('W6-L an account B session cannot restore account A export state after a switch', async () => {
  const f = await accountFixture({ gateDownload: true });
  const saving = f.page.onSaveExport();
  await flush();
  f.session.accept(B);
  f.releaseDownload({ ok: true, data: { jobId: 'synthetic_file', extension: 'json', content } });
  await saving;
  await flush();
  assert.equal(f.writes.length, 0);
  assert.equal(f.shares.length, 0);
  assert.equal(f.page.data.exportJob, null);
  assert.match(f.page.data.notice, /账号状态已变化/);
  assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC private export/);
  f.page.onUnload();
});
