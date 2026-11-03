const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createAppRuntime, workStatus } = require('../miniprogram/modules/system/runtime');
const { goHome, backOrHome } = require('../miniprogram/modules/system/navigation');
const root = path.resolve(__dirname, '..');
function fixture(pages = []) {
  const events = {},
    initialReads = [],
    modals = [],
    toasts = [];
  let applied = 0,
    subscriptions = 0;
  const manager = {
    onCheckForUpdate: (fn) => {
      events.check = fn;
    },
    onUpdateReady: (fn) => {
      events.ready = fn;
    },
    onUpdateFailed: (fn) => {
      events.failed = fn;
    },
    applyUpdate: () => applied++,
  };
  const platform = {
    onNetworkStatusChange: (fn) => {
      subscriptions++;
      events.network = fn;
    },
    getNetworkType: (input) => initialReads.push(input),
    getUpdateManager: () => manager,
    showModal: (input) => modals.push(input),
    showToast: (input) => toasts.push(input.title),
  };
  const runtime = createAppRuntime({ pages: () => pages });
  runtime.start(platform);
  return {
    runtime,
    platform,
    events,
    initialReads,
    modals,
    toasts,
    applied: () => applied,
    subscriptions: () => subscriptions,
  };
}
test('network status rejects stale reads, reports recovery and never dispatches business writes', () => {
  const f = fixture();
  const seen = [];
  const unsubscribe = f.runtime.subscribe((state) => seen.push(state.online));
  f.runtime.start(f.platform);
  assert.equal(f.subscriptions(), 1);
  f.events.network({ isConnected: false });
  f.initialReads[0].success({ networkType: 'wifi' });
  assert.equal(f.runtime.snapshot().online, false);
  f.runtime.refreshNetwork();
  f.initialReads[1].success({ networkType: 'wifi' });
  assert.equal(f.runtime.snapshot().recovered, true);
  f.runtime.dismissRecovery();
  assert.equal(f.runtime.snapshot().recovered, false);
  unsubscribe();
  const count = seen.length;
  f.events.network({ isConnected: false });
  assert.equal(seen.length, count);
  assert.equal(f.modals.length, 0);
});
test('automatic update checks report current, download and failure without fake manual checks or restart', () => {
  const f = fixture();
  f.events.check({ hasUpdate: false });
  f.runtime.showUpdateStatus();
  assert.match(f.toasts.at(-1), /本次启动检查/);
  f.events.check({ hasUpdate: true });
  f.runtime.showUpdateStatus();
  assert.match(f.toasts.at(-1), /下载/);
  f.events.failed();
  f.runtime.showUpdateStatus();
  assert.match(f.toasts.at(-1), /失败/);
  assert.equal(f.applied(), 0);
});
test('a ready update waits for explicit confirmation, supports cancel and prevents double restart', () => {
  const f = fixture();
  f.events.ready();
  assert.equal(f.modals.length, 0);
  f.runtime.applyUpdate();
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 1);
  f.modals[0].success({ confirm: false });
  f.modals[0].complete();
  assert.equal(f.applied(), 0);
  f.runtime.applyUpdate();
  f.modals[1].success({ confirm: true });
  f.modals[1].complete();
  f.runtime.applyUpdate();
  assert.equal(f.applied(), 1);
  assert.equal(f.modals.length, 2);
});

test('an update confirmation that throws can be retried without restarting or escaping the handler', () => {
  const f = fixture();
  f.events.ready();
  let fail = true;
  f.platform.showModal = (input) => {
    if (fail) {
      throw new Error('SYNTHETIC native dialog failure');
    }
    f.modals.push(input);
  };
  assert.doesNotThrow(() => f.runtime.applyUpdate());
  assert.equal(f.applied(), 0);
  assert.equal(f.runtime.snapshot().update, 'ready');
  assert.match(f.toasts.at(-1), /暂时无法打开更新确认/);
  fail = false;
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 1);
  f.modals[0].success({ confirm: true });
  f.modals[0].complete();
  assert.equal(f.applied(), 1);
});

test('a failed update dialog releases its own lock and late completion cannot unlock a newer dialog', () => {
  const f = fixture();
  f.events.ready();
  f.runtime.applyUpdate();
  const first = f.modals[0];
  assert.equal(typeof first.fail, 'function');
  first.fail({ errMsg: 'showModal:fail synthetic' });
  assert.equal(f.applied(), 0);
  assert.match(f.toasts.at(-1), /暂时无法打开更新确认/);
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 2);
  first.complete();
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 2);
  f.modals[1].success({ confirm: true });
  f.modals[1].complete();
  assert.equal(f.applied(), 1);
});
test('hidden drafts, uncertain requests and operations started during the update dialog prevent restart', () => {
  const pages = [{ data: {} }, { data: { hasUnsavedChanges: true } }];
  const f = fixture(pages);
  f.events.ready();
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 0);
  assert.match(f.toasts.at(-1), /先保存/);
  pages[1].data = { pendingRetry: true };
  f.runtime.applyUpdate();
  assert.match(f.toasts.at(-1), /重试/);
  pages[1].data = {};
  f.runtime.applyUpdate();
  pages[1].data = { busy: true };
  f.modals[0].success({ confirm: true });
  f.modals[0].complete();
  assert.equal(f.applied(), 0);
  for (const data of [
    { pending: true },
    { pendingKind: 'close' },
    { retryPending: true },
    { wechatLoginBusy: true },
    { phase: 'saving' },
    { phase: 'deleting' },
  ]) {
    assert.equal(workStatus([{ data }]).pending, true);
  }
  assert.equal(
    workStatus([{ _journal: { getState: () => ({ hasUnsavedChanges: true }) } }]).draft,
    true,
  );
});
test('older clients retain page use and report unsupported update without crashing', () => {
  const runtime = createAppRuntime();
  const toasts = [];
  runtime.start({ showToast: (input) => toasts.push(input.title) });
  runtime.refreshNetwork();
  runtime.showUpdateStatus();
  assert.match(toasts[0], /升级微信/);
  assert.equal(runtime.snapshot().online, null);
});
test('cached tab drafts remain protected when not returned in the active navigation stack', () => {
  const f = fixture([{ data: {} }]);
  const hiddenToday = { data: { hasUnsavedChanges: true } };
  const untrack = f.runtime.trackPage(hiddenToday);
  f.events.ready();
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 0);
  assert.match(f.toasts.at(-1), /先保存/);
  untrack();
  f.runtime.applyUpdate();
  assert.equal(f.modals.length, 1);
});
test('deep-link return has a home fallback, confirms draft discard and preserves uncertain operations', () => {
  const opened = [],
    toasts = [],
    modals = [];
  const platform = {
    switchTab: (input) => opened.push(input.url),
    navigateBack: (input) => input.fail(),
    showToast: (input) => toasts.push(input.title),
    showModal: (input) => modals.push(input),
  };
  backOrHome(platform);
  assert.deepEqual(opened, ['/pages/today/index']);
  const pages = [{ data: { hasUnsavedChanges: true } }];
  goHome(platform, () => pages);
  modals[0].success({ confirm: false });
  assert.equal(opened.length, 1);
  goHome(platform, () => pages);
  pages[0].data.pendingRetry = true;
  modals[1].success({ confirm: true });
  assert.equal(opened.length, 1);
  assert.match(toasts.at(-1), /重试/);
  pages[0].data.pendingRetry = false;
  goHome(platform, () => pages);
  modals[2].success({ confirm: true });
  assert.equal(opened.length, 2);
});
function load(file, { platform = {}, globals = {}, config = {} } = {}) {
  const full = path.join(root, 'miniprogram', file),
    local = createRequire(full);
  let definition;
  vm.runInNewContext(fs.readFileSync(full, 'utf8'), {
    wx: platform,
    setTimeout,
    clearTimeout,
    ...globals,
    Page: (value) => {
      definition = value;
    },
    Component: (value) => {
      definition = value;
    },
    App: (value) => {
      definition = value;
    },
    require: (id) => (id.endsWith('/config/environment.local') ? config : local(id)),
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}
test('all normal pages include status UI while timeline previews exclude its native actions', () => {
  const app = require('../miniprogram/app.json');
  assert.equal(app.usingComponents['app-status'], '/components/app-status/index');
  for (const route of app.pages) {
    const template = fs.readFileSync(path.join(root, 'miniprogram', route + '.wxml'), 'utf8');
    const status = template.match(/<block wx:if="{{!shareSinglePage}}">\s*(<app-status\b[^>]*\/>)/);
    const expected =
      route === 'pages/today/index'
        ? '<app-status id="app-status" />'
        : ['pages/login/index', 'pages/review/detail/index'].includes(route)
          ? '<app-status id="app-status" hide-home="{{true}}" />'
          : '<app-status />';
    assert.equal(status?.[1], expected, route);
  }
  const component = load('components/app-status/index.js');
  Object.assign(component, component.methods);
  component.lifetimes.attached.call(component);
  assert.equal(component.data.homeEntry, false);
  component.lifetimes.detached.call(component);
});
test('app handles missing pages and leaves network/update APIs untouched in timeline launch and show', () => {
  let forbidden = 0;
  const opened = [];
  const app = load('app.js', {
    platform: {
      onNetworkStatusChange: () => forbidden++,
      getUpdateManager: () => forbidden++,
      switchTab: (input) => opened.push(input.url),
    },
  });
  app.onLaunch({ scene: 1154 });
  app.onShow({ scene: 1154 });
  assert.equal(forbidden, 0);
  app.onPageNotFound();
  assert.equal(opened.length, 0);
  app.onShow({ scene: 1001 });
  app.onPageNotFound();
  assert.deepEqual(opened, ['/pages/today/index']);
});
test('production My exposes native privacy, feedback, help and actual package version for guests', () => {
  const opened = [],
    toasts = [];
  const me = load('pages/me/index.js', {
    config: { releaseProfile: 'production' },
    platform: {
      openPrivacyContract: (input) => {
        opened.push('privacy');
        input.fail();
      },
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial', version: '0.4.0' } }),
      showToast: (input) => toasts.push(input.title),
    },
  });
  me.onLoad();
  me.onPrivacyContract();
  assert.equal(me.data.clientVersion, '0.4.0 · 体验版');
  assert.deepEqual(opened, ['privacy']);
  assert.match(toasts[0], /暂时无法打开/);
  me.onSection({ currentTarget: { dataset: { section: 'help' } } });
  assert.equal(me.data.activeSection, 'help');
  me.onUnload();
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/me/index.wxml'), 'utf8');
  const production = template.split('<view class="page" wx:if="{{isPilot}}">')[0];
  assert.match(production, /open-type="feedback"/);
  assert.match(production, /bindtap="onPrivacyContract"/);
  assert.match(production, /bindtap="onCheckUpdate"/);
});
test('profile avatar and nickname edits participate in update and home draft protection', () => {
  const profile = load('pages/profile/index.js');
  profile.data.loaded = true;
  profile.onNicknameInput();
  assert.equal(workStatus([profile]).draft, true);
  profile.data.hasUnsavedChanges = false;
  profile.onChooseAvatar({ detail: { avatarUrl: 'wxfile://local-avatar' } });
  assert.equal(workStatus([profile]).draft, true);
});
test('account header opens WeChat login for guests and profile editing after login; protected menus resume their destination', () => {
  const navigated = [],
    tabs = [];
  const me = load('pages/me/index.js', {
    platform: {
      navigateTo: (input) => navigated.push(input.url),
      switchTab: (input) => tabs.push(input.url),
    },
  });
  me.onProfileTap();
  assert.equal(navigated.pop(), '/pages/login/index');
  me.onShow(); // Return from the first destination before opening another menu.
  me.onMyRecords();
  assert.equal(decodeURIComponent(navigated.pop().split('returnTo=')[1]), '/pages/universe/index');
  me.onShow();
  me.onProductionAccount();
  assert.equal(decodeURIComponent(navigated.pop().split('returnTo=')[1]), '/pages/account/index');
  me.onShow();
  me.data.wechatAuthenticated = true;
  me.onProfileTap();
  assert.equal(navigated.pop(), '/pages/profile/index');
  me.onShow();
  me.onMyRecords();
  assert.deepEqual(tabs, ['/pages/universe/index']);
  me.onShow();
  me.onProductionAccount();
  assert.equal(navigated.pop(), '/pages/account/index');
});
