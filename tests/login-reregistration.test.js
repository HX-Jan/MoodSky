const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createCloudSession } = require('../miniprogram/modules/account/cloud-session');
const { AppError } = require('../miniprogram/shared/result');
const OLD = 'scope_' + 'a'.repeat(64);
const FRESH = 'scope_' + 'c'.repeat(64);
const OTHER = 'scope_' + 'b'.repeat(64);
const reply = (scope) => ({
  ok: true,
  data: { authenticated: true, scope, capabilities: ['journal', 'review', 'tasks'] },
});

function fixture(options = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/login/index.js');
  const localRequire = createRequire(file);
  const state = createSessionState();
  const calls = [],
    modals = [],
    navigations = [];
  const platform = {
    showModal(input) {
      modals.push(input);
      input.success({ confirm: options.confirm !== false });
    },
    requirePrivacyAuthorize(input) {
      options.cancelPrivacy ? input.fail() : input.success();
    },
    switchTab(input) {
      navigations.push(input.url);
    },
    setStorageSync() {},
  };
  const api = {
    createRequest,
    async call(request) {
      calls.push(request);
      if (request.action === 'account.registration') {
        return options.status
          ? options.status(request)
          : { ok: true, data: { canRegister: true, previousScope: OLD } };
      }
      return options.register ? options.register(request) : reply(FRESH);
    },
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../../config/environment.local') {
        return { releaseProfile: 'production' };
      }
      if (id === '../../services/api') {
        return api;
      }
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../modules/account/cloud-session') {
        return {
          createCloudSession: (settings = {}) =>
            createCloudSession({
              state,
              authenticate: async () => {
                throw new AppError('ACCOUNT_DISABLED', 'Synthetic disabled');
              },
              ...settings,
            }),
        };
      }
      return localRequire(id);
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
  page.onAgreement({ detail: { value: ['agree'] } });
  return { page, calls, modals, navigations, platform, state, options };
}
const prepares = async (f) => {
  await f.page.onWechatLogin();
  assert.equal(f.page.data.registrationAvailable, true);
  assert.equal(f.state.capture(), null);
  assert.equal(f.calls.filter((r) => r.action === 'account.register').length, 0);
};

test('disabled login offers explicit fresh registration; cancelling creates no account and guest browsing remains available', async () => {
  const f = fixture({ confirm: false });
  await prepares(f);
  await f.page.onWechatLogin();
  assert.equal(f.modals.length, 1);
  assert.equal(f.calls.filter((r) => r.action === 'account.register').length, 0);
  assert.equal(f.page.data.wechatLoginBusy, false);
  assert.match(f.page.data.wechatLoginNotice, /已取消/);
  f.page.onBrowse();
  assert.deepEqual(f.navigations, ['/pages/today/index']);
});

test('confirmed registration accepts only its validated fresh scope and navigates after service confirmation', async () => {
  const f = fixture();
  await prepares(f);
  await f.page.onWechatLogin();
  assert.match(f.modals[0].content, /空账号/);
  assert.match(f.modals[0].content, /不会恢复/);
  const registration = f.calls.find((r) => r.action === 'account.register');
  assert.deepEqual(registration.payload, { confirm: 'REGISTER', previousScope: OLD });
  assert.equal(f.state.capture().scope, FRESH);
  assert.equal(f.page.data.registrationAvailable, false);
  assert.equal(f.page.data.wechatLoginBusy, false);
  assert.equal(f.page.data.wechatAuthenticated, true);
  assert.deepEqual(f.navigations, ['/pages/me/index']);
});

test('unknown registration result retries the identical request and input without creating another confirmation', async () => {
  let attempts = 0;
  const f = fixture({
    register: async () => {
      if (++attempts === 1) {
        throw new AppError('NETWORK_ERROR', 'Synthetic lost response');
      }
      return reply(FRESH);
    },
  });
  await prepares(f);
  await f.page.onWechatLogin();
  assert.equal(f.page.data.registrationPending, true);
  assert.equal(f.state.capture(), null);
  assert.deepEqual(f.navigations, []);
  await f.page.onWechatLogin();
  const requests = f.calls.filter((r) => r.action === 'account.register');
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.equal(f.modals.length, 1);
  assert.equal(f.state.capture().scope, FRESH);
});

test('withdrawing agreement or cancelling platform privacy authorization never submits registration', async () => {
  const f = fixture();
  await prepares(f);
  f.page.onAgreement({ detail: { value: [] } });
  await f.page.onWechatLogin();
  assert.equal(f.modals.length, 0);
  f.page.onAgreement({ detail: { value: ['agree'] } });
  f.options.cancelPrivacy = true;
  await f.page.onWechatLogin();
  assert.equal(f.calls.filter((r) => r.action === 'account.register').length, 0);
  assert.equal(f.page.data.wechatLoginBusy, false);
  assert.equal(f.state.capture(), null);
});

test('continuous taps during confirmation send one registration request', async () => {
  const f = fixture();
  await prepares(f);
  let confirm;
  f.platform.showModal = (input) => {
    confirm = input.success;
  };
  const first = f.page.onWechatLogin();
  await f.page.onWechatLogin();
  await f.page.onWechatLogin();
  assert.equal(f.calls.filter((r) => r.action === 'account.register').length, 0);
  confirm({ confirm: true });
  await first;
  assert.equal(f.calls.filter((r) => r.action === 'account.register').length, 1);
});

test('leaving the page and switching accounts blocks a late registration response', async () => {
  let release;
  const f = fixture({
    register: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await prepares(f);
  const pending = f.page.onWechatLogin();
  while (!release) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  f.page.onHide();
  f.state.accept(OTHER);
  release(reply(FRESH));
  await pending;
  assert.equal(f.state.capture().scope, OTHER);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.page.data.registrationAvailable, false);
});

test('a late discovery response after an account switch cannot offer the old account registration', async () => {
  let release;
  const f = fixture({
    status: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = f.page.onWechatLogin();
  while (!release) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  f.state.accept(OTHER);
  release({ ok: true, data: { canRegister: true, previousScope: OLD } });
  await pending;
  assert.equal(f.page.data.registrationAvailable, false);
  assert.equal(f.page.data.wechatLoginBusy, false);
  assert.equal(f.state.capture().scope, OTHER);
});

test('an older server or an invalid registration response cannot produce a false registration success', async () => {
  const old = fixture({
    status: () => {
      throw new AppError('ACTION_NOT_FOUND', 'Synthetic old server');
    },
  });
  await old.page.onWechatLogin();
  assert.equal(old.page.data.registrationAvailable, false);
  assert.equal(old.state.capture(), null);
  assert.deepEqual(old.navigations, []);
  const malformed = fixture({ register: () => ({ ok: true, data: {} }) });
  await prepares(malformed);
  await malformed.page.onWechatLogin();
  assert.equal(malformed.state.capture(), null);
  assert.deepEqual(malformed.navigations, []);
});
