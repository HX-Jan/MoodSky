const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { redactPath } = require('../miniprogram/modules/share/share-diagnostics');

const root = path.resolve(__dirname, '..');
const SHARE_FILE = path.join(root, 'miniprogram/modules/share/app-share.js');
const SHA = 'a'.repeat(40);
const FORBIDDEN =
  /openid|unionid|token|cookie|nickname|avatar|receipt|jobid|accountid|sessionscope|exporttoken|scope_[a-f0-9]+/i;

function testConfig(overrides = {}) {
  return {
    releaseProfile: 'develop',
    shareDiagnostics: true,
    buildCommit: SHA,
    ...overrides,
  };
}

function loadShareModule({ config, session }) {
  const local = createRequire(SHARE_FILE);
  const sandboxModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(SHARE_FILE, 'utf8') +
      '\nmodule.exports = { createAppShare, enableAppShare, prepareSharedPage, isTimelinePreview, parseShareReturn, shareTarget };',
    {
      module: sandboxModule,
      require(id) {
        if (id === '../../config/environment.local') {
          return config;
        }
        if (id === '../../services/session-state') {
          return { cloudSessionState: session ?? createSessionState() };
        }
        return local(id);
      },
    },
  );
  return sandboxModule.exports;
}

function captureEntries(config, session, callback) {
  const { createAppShare, prepareSharedPage } = loadShareModule({ config, session });
  const entries = [];
  const originalLog = console.log;
  console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[share-diagnostics] ')) {
      entries.push(JSON.parse(args[0].slice('[share-diagnostics] '.length)));
      return;
    }
    originalLog(...args);
  };
  let result;
  try {
    result = callback({ createAppShare, prepareSharedPage });
  } finally {
    console.log = originalLog;
  }
  return { entries, result };
}

test('share_send keeps only whitelisted keys and drops sender-private values', () => {
  const config = testConfig();
  const { entries, result } = captureEntries(config, null, ({ createAppShare }) => {
    const share = createAppShare({ route: 'pages/review/detail/index' });
    const page = {
      data: {
        date: '2026-11-01',
        text: 'PRIVATE_BODY',
        accountId: 'PRIVATE_ACCOUNT',
        sessionScope: 'PRIVATE_SESSION',
        exportToken: 'PRIVATE_TOKEN',
      },
      options: { id: 'PRIVATE_RECORD', receipt: 'PRIVATE_RECEIPT' },
    };
    return {
      friend: share.onShareAppMessage.call(page),
      timeline: share.onShareTimeline.call(page),
    };
  });
  const { friend, timeline } = result;
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.event, 'share_send');
    assert.equal(entry.route, 'pages/review/detail/index');
    assert.match(entry.safePath, /fromShare=page&date=2026-11-01$/);
    assert.deepEqual(entry.queryKeys, ['fromShare', 'date']);
    assert.equal(entry.buildSha, SHA);
    assert.equal(entry.environmentLabel, 'test');
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  }
  assert.equal(entries[0].safePath, friend.path);
  assert.equal(entries[1].safePath, '/pages/review/detail/index?' + timeline.query);
  const serialized = JSON.stringify({ entries, friend, timeline });
  assert.doesNotMatch(
    serialized,
    /PRIVATE_BODY|PRIVATE_ACCOUNT|PRIVATE_SESSION|PRIVATE_TOKEN|PRIVATE_RECORD|PRIVATE_RECEIPT/,
  );
  assert.doesNotMatch(serialized, FORBIDDEN);
});

test('redactPath counts unexpected keys by name only and never keeps their values', () => {
  const result = redactPath(
    '/pages/me/index?fromShare=page&openid=OPENID_VALUE&token=SECRET_TOKEN&text=SECRET_BODY&date=2026-11-21',
  );
  assert.equal(result.route, 'pages/me/index');
  assert.equal(result.safePath, '/pages/me/index?fromShare=page&date=2026-11-21');
  assert.deepEqual(result.unexpectedKeys, ['openid', 'token', 'text']);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /OPENID_VALUE|SECRET_TOKEN|SECRET_BODY/);
  assert.match(serialized, /"openid"|"token"|"text"/);
});

test('share_receive records option key names only and the session resolution enum', () => {
  const config = { ...testConfig(), explicitWechatLogin: true };
  const session = createSessionState();
  session.accept('scope_' + 'b'.repeat(64));
  const { entries, result } = captureEntries(config, session, ({ prepareSharedPage }) => {
    const page = {
      data: {},
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
    const handled = prepareSharedPage(page, {}, config, 'pages/review/detail/index', {
      fromShare: 'page',
      date: '2026-11-01',
      id: 'PRIVATE_SENDER',
      text: 'PRIVATE_BODY',
    });
    return { handled };
  });
  assert.equal(result.handled, false);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.event, 'share_receive');
  assert.equal(entry.route, 'pages/review/detail/index');
  assert.deepEqual(entry.optionKeys, ['fromShare', 'date', 'id', 'text']);
  assert.equal(entry.fromShare, true);
  assert.equal(entry.sessionResolution, 'receiver_self');
  assert.equal(entry.unexpectedKeyCount, 2);
  assert.deepEqual(entry.unexpectedKeys, ['id', 'text']);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /PRIVATE_SENDER|PRIVATE_BODY/);
  assert.doesNotMatch(serialized, FORBIDDEN);
});

for (const [name, expectations] of [
  [
    'login_redirect',
    { route: 'pages/review/detail/index', options: { fromShare: 'page', date: '2026-11-01' } },
  ],
  [
    'guest_public',
    { route: 'pages/tasks/index', options: { fromShare: 'page', view: 'suggestions' } },
  ],
]) {
  test(`share_receive resolves ${name} for a guest without leaking option values`, () => {
    const config = { ...testConfig(), explicitWechatLogin: true };
    const { entries, result } = captureEntries(config, null, ({ prepareSharedPage }) => {
      const redirected = [];
      const platform =
        name === 'login_redirect' ? { redirectTo: (input) => redirected.push(input.url) } : {};
      const page = {
        data: {},
        setData(patch) {
          Object.assign(this.data, patch);
        },
      };
      prepareSharedPage(page, platform, config, expectations.route, expectations.options);
      return { redirected };
    });
    if (name === 'login_redirect') {
      assert.equal(result.redirected.length, 1);
      assert.doesNotMatch(result.redirected[0], /PRIVATE|id=|text=/);
    }
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sessionResolution, name);
    assert.equal(entries[0].fromShare, true);
    const serialized = JSON.stringify({ entries, result });
    assert.doesNotMatch(serialized, FORBIDDEN);
  });
}

test('timeline preview resolves single_page_preview without touching session state', () => {
  const config = testConfig();
  const { entries, result } = captureEntries(config, null, ({ prepareSharedPage }) => {
    const page = {
      data: {},
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
    const platform = { getEnterOptionsSync: () => ({ scene: 1154 }) };
    return prepareSharedPage(page, platform, config, 'pages/me/index', { fromShare: 'page' });
  });
  assert.equal(result, true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sessionResolution, 'single_page_preview');
  assert.equal(entries[0].fromShare, true);
});

test('diagnostics stay silent outside opted-in test builds', () => {
  for (const config of [
    testConfig({ shareDiagnostics: false }),
    testConfig({ releaseProfile: 'production' }),
    {},
    null,
  ]) {
    const { entries, result } = captureEntries(config, null, ({ createAppShare }) => {
      const share = createAppShare({ route: 'pages/me/index' });
      share.onShareAppMessage.call({ data: {}, options: {} });
      return true;
    });
    assert.equal(result, true);
    assert.deepEqual(entries, []);
  }
});

test('a build commit that is not a full sha is reported as unknown', () => {
  const config = testConfig({ buildCommit: 'shortsha' });
  const { entries } = captureEntries(config, null, ({ createAppShare }) => {
    const share = createAppShare({ route: 'pages/today/index' });
    share.onShareAppMessage.call({
      data: { date: '2026-11-01' },
      options: { date: '2026-11-01' },
    });
    return true;
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].buildSha, 'unknown');
});
