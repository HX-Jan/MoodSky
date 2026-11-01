const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const {
  shareTarget,
  parseShareReturn,
  prepareSharedPage,
  enableAppShare,
} = require('../miniprogram/modules/share/app-share');
const { cloudSessionState } = require('../miniprogram/services/session-state');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');
const root = path.resolve(__dirname, '..');
const routes = require('../miniprogram/app.json').pages;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function page(route, { modules = {}, platform = {}, config = { cloudEnabled: false } } = {}) {
  const file = path.join(root, 'miniprogram', route + '.js'),
    local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: platform,
    setTimeout,
    clearTimeout,
    getCurrentPages: () => [],
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return config;
      }
      return modules[id] || local(id);
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
test('both native callbacks preserve the active page and validated navigation context', () => {
  const cases = [
    ['pages/today/index', { date: '2026-10-31' }, 'date=2026-10-31'],
    ['pages/record/index', { date: '2026-10-31', weatherName: 'PRIVATE' }, 'date=2026-10-31'],
    ['pages/review/detail/index', { dateLabel: '2026-10-31', text: 'PRIVATE' }, 'date=2026-10-31'],
    ['pages/universe/index', { month: '2026-09' }, 'month=2026-09'],
    ['pages/review/month/index', { month: '2026-09' }, 'month=2026-09'],
    ['pages/review/archive/index', { selectedMonth: '2026-09' }, 'month=2026-09'],
    ['pages/review/insights/index', { windowDays: 90, text: 'PRIVATE' }, 'days=90'],
    ['pages/tasks/index', { view: 'history', history: ['PRIVATE'] }, 'view=history'],
  ];
  for (const [route, data, expected] of cases) {
    const p = page(route);
    Object.assign(p.data, data);
    p.options = {
      id: 'PRIVATE_ID',
      ownerId: 'PRIVATE_OWNER',
      receipt: 'PRIVATE_RECEIPT',
      weatherName: 'PRIVATE',
    };
    const friend = p.onShareAppMessage(),
      timeline = p.onShareTimeline();
    assert.equal(friend.path.split('?')[0], '/' + route);
    assert.ok(friend.path.includes(expected));
    assert.equal(friend.path.split('?')[1], timeline.query);
    assert.equal(timeline.path, undefined);
    assert.equal(friend.imageUrl, '/assets/jiaqi/PARTLY_CLOUDY.png');
    assert.doesNotMatch(
      JSON.stringify([friend, timeline]),
      /PRIVATE|ownerId|receipt|text=|weatherName|avatar/,
    );
  }
});
test('invalid or injected dates, windows, row IDs and form state never enter share URLs', () => {
  for (const route of routes) {
    const target = shareTarget(route, {
      data: {
        date: '2026-02-30',
        month: '2026-13',
        windowDays: 365,
        view: 'PRIVATE',
        text: 'PRIVATE',
      },
      options: {
        date: 'invalid',
        month: 'bad',
        id: 'PRIVATE',
        ownerId: 'PRIVATE',
        receipt: 'PRIVATE',
        returnTo: 'https://example.invalid',
      },
    });
    assert.equal(target.path.split('?')[0], '/' + route);
    assert.doesNotMatch(JSON.stringify(target), /PRIVATE|2026-02-30|2026-13|365|invalid|example/);
  }
  assert.equal(
    parseShareReturn('/pages/review/detail/index?date=2026-11-01&id=PRIVATE&ownerId=PRIVATE'),
    '/pages/review/detail/index?fromShare=page&date=2026-11-01',
  );
  for (const target of [
    'https://example.invalid',
    '//pages/me/index',
    '/pages/unknown/index',
    '/pages/login/index?returnTo=loop',
    '/pages/record/index?date=%ZZ',
    '/pages/record/index?date=2026-11-01&date=2026-10-31',
  ]) {
    assert.equal(parseShareReturn(target), '');
  }
});
test('every actual page requests both actions in the WeChat three-dot menu', () => {
  const shown = [];
  for (const route of routes) {
    const p = page(route, {
      platform: { showShareMenu: (options) => shown.push({ route, menus: options.menus }) },
    });
    p.onShow();
  }
  assert.equal(shown.length, routes.length);
  shown.forEach(({ menus }) => assert.deepEqual(menus, ['shareAppMessage', 'shareTimeline']));
});
test('every actual page has a static single-page preview without calling login, storage or cloud APIs', () => {
  const forbidden = () => {
    throw Error('Single-page preview must not use this API');
  };
  for (const route of routes) {
    const p = page(route, {
      config: { releaseProfile: 'production', explicitWechatLogin: true, cloudEnabled: true },
      platform: {
        getEnterOptionsSync: () => ({ scene: 1154 }),
        getStorageSync: forbidden,
        showShareMenu: forbidden,
        redirectTo: forbidden,
        cloud: { init: forbidden, callFunction: forbidden },
      },
    });
    const originalService = p._service;
    p.onLoad({ fromShare: 'page', date: '2026-11-01', ownerId: 'PRIVATE', text: 'PRIVATE' });
    p.onShow();
    assert.equal(p.data.shareSinglePage, true, route);
    assert.ok(p.data.sharePageTitle);
    assert.ok(p.data.sharePageDescription);
    assert.doesNotMatch(p.data.sharePageTitle + p.data.sharePageDescription, /PRIVATE/);
    assert.equal(p._journal, undefined);
    assert.equal(p._controller, undefined);
    assert.equal(p._service, originalService);
  }
  assert.doesNotThrow(() =>
    enableAppShare({ getLaunchOptionsSync: () => ({ scene: 1154 }), showShareMenu: forbidden }),
  );
});
test('single-page App launch does not initialize cloud but a normal launch still does', () => {
  const file = path.join(root, 'miniprogram/app.js'),
    local = createRequire(file);
  let definition,
    calls = 0;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    App: (value) => {
      definition = value;
    },
    wx: { cloud: { init: () => calls++ } },
    require(id) {
      return id === './config/environment.local'
        ? { cloudEnabled: true, cloudEnvId: 'synthetic_env' }
        : local(id);
    },
  });
  definition.onLaunch({ scene: 1154 });
  assert.equal(calls, 0);
  assert.equal(definition.globalData.cloudReady, false);
  definition.onLaunch({ scene: 1001 });
  assert.equal(calls, 1);
  assert.equal(definition.globalData.cloudReady, true);
});
test('private shared pages go through login then resume the same sanitized page rather than My or home', async () => {
  cloudSessionState.clear();
  const redirects = [],
    opened = [],
    memory = new Map();
  const platform = {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, val) => memory.set(key, val),
    redirectTo: ({ url }) => redirects.push(url),
    reLaunch: ({ url }) => opened.push(url),
  };
  const p = page('pages/review/detail/index', {
    platform,
    config: { releaseProfile: 'production', explicitWechatLogin: true, cloudEnabled: true },
  });
  p.onLoad({ fromShare: 'page', date: '2026-10-31', id: 'PRIVATE_SENDER_ID' });
  p.onShow();
  assert.equal(p._shareLoginRedirected, true);
  assert.equal(p._service, undefined);
  assert.equal(redirects.length, 1);
  const returnTo = decodeURIComponent(redirects[0].split('returnTo=')[1]);
  assert.equal(returnTo, '/pages/review/detail/index?fromShare=page&date=2026-10-31');
  const modules = {
    '../../modules/account/cloud-session': {
      createCloudSession: () => ({
        async refresh() {
          cloudSessionState.accept('scope_' + 'b'.repeat(64));
          return true;
        },
        getErrorCode: () => '',
        dispose() {},
      }),
    },
  };
  const login = page('pages/login/index', {
    platform,
    config: { releaseProfile: 'production', explicitWechatLogin: true },
    modules,
  });
  login.onLoad({ returnTo });
  login.onAgreement({ detail: { value: ['agree'] } });
  await login.onWechatLogin();
  assert.deepEqual(opened, [returnTo]);
  assert.equal(
    prepareSharedPage(
      { setData() {} },
      platform,
      { explicitWechatLogin: true },
      'pages/review/detail/index',
      { fromShare: 'page', date: '2026-10-31' },
    ),
    false,
  );
  login.onUnload();
  cloudSessionState.clear();
});
test('a shared private detail resolves only the recipient entry for the selected date, without the sender record ID', async () => {
  const date = '2026-10-31',
    stamp = '2026-10-31T04:00:00.000Z';
  const sender = shareTarget('pages/review/detail/index', {
    data: { dateLabel: date, text: 'PRIVATE_SENDER' },
    options: { date, id: 'PRIVATE_SENDER_ID' },
  });
  const store = createLocalStore([
    {
      id: 'synthetic_recipient_entry',
      date,
      weather: 'SUNNY',
      tags: [],
      text: 'SYNTHETIC recipient own content',
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  const service = createReviewDemoService({ store });
  const p = page('pages/review/detail/index', {
    config: { journalDemo: true, cloudEnabled: false },
    modules: {
      '../../../modules/review/demo-service': { reviewDemoService: service },
      '../../../modules/review/demo-store': { reviewStore: store },
    },
  });
  const query = Object.fromEntries(
    sender.query.split('&').map((pair) => pair.split('=').map(decodeURIComponent)),
  );
  p.onLoad(query);
  await settle();
  assert.equal(p.data.phase, 'ready');
  assert.equal(p.data.text, 'SYNTHETIC recipient own content');
  assert.equal(p._query.id, undefined);
  p.onUnload();
});
test('shared month and review window parameters are applied by the actual destination pages', async () => {
  const config = { journalDemo: true, cloudEnabled: false };
  const universe = page('pages/universe/index', { config });
  universe.onLoad({ fromShare: 'page', month: '2026-09' });
  await settle();
  assert.equal(universe.data.month, '2026-09');
  universe.onUnload();
  const insights = page('pages/review/insights/index', { config });
  insights.onLoad({ fromShare: 'page', days: '90' });
  await settle();
  assert.equal(insights.data.windowDays, 90);
  insights.onUnload();
});
test('all page templates have a single-page branch and the static component uses no restricted controls', () => {
  for (const route of routes) {
    const markup = fs.readFileSync(path.join(root, 'miniprogram', route + '.wxml'), 'utf8');
    assert.match(markup, /<share-entry wx:if="\{\{shareSinglePage\}\}"/);
    assert.match(markup, /<block wx:if="\{\{!shareSinglePage\}\}">/);
  }
  assert.equal(
    require('../miniprogram/app.json').usingComponents['share-entry'],
    '/components/share-entry/index',
  );
  const markup = fs.readFileSync(
    path.join(root, 'miniprogram/components/share-entry/index.wxml'),
    'utf8',
  );
  assert.doesNotMatch(markup, /<button|<form|<navigator|open-type|bindtap/);
});
