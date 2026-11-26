const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const { createApiClient, createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');
const {
  savePhoneSession,
  readPhoneSession,
  forgetLogin,
} = require('../miniprogram/modules/account/login-memory');
function world(enabled = true) {
  const f = databaseFixture();
  let serial = 0;
  let time = new Date('2026-11-22T00:00:00Z');
  let exchanges = 0;
  const config = readProductionConfig({
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
    MOODSKY_PHONE_LOGIN_ENABLED: String(enabled),
  });
  const call = (action, payload = {}, extra = {}, who = 'synthetic_wechat') =>
    createProductionEntry({
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        OPENID: who,
        SOURCE: 'wx_client',
        identityFromCurrentInvocation: true,
      }),
      readConfig: () => config,
      openDatabase: () => f.db,
      now: () => time,
      exchangePhone: async (code) => {
        exchanges++;
        if (code === 'invalid') {
          throw new Error('synthetic');
        }
        return {
          phoneInfo: {
            countryCode: '86',
            purePhoneNumber: code === 'primary' ? '13800000001' : '13800000002',
          },
        };
      },
    })({ apiVersion: '1', requestId: 'req_phone_' + ++serial, action, payload, ...extra });
  return {
    ...f,
    call,
    expire: () => {
      time = new Date(time.getTime() + 8 * 86400000);
    },
    exchanges: () => exchanges,
  };
}
function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
function error(result, code) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code);
}
async function bound(f) {
  const primary = ok(await f.call('account.session'));
  ok(
    await f.call(
      'account.phoneLogin',
      { mode: 'bind', code: 'primary' },
      { sessionScope: primary.scope },
    ),
  );
  return primary;
}
test('phone login defaults closed and refuses unverified primary association', async () => {
  const closed = world(false);
  error(
    await closed.call('account.phoneLogin', { mode: 'login', code: 'primary' }),
    'NOT_IMPLEMENTED',
  );
  assert.equal(closed.exchanges(), 0);
  const f = world();
  await f.call('account.session');
  error(await f.call('account.phoneLogin', { mode: 'login', code: 'primary' }), 'CONFLICT');
  error(await f.call('account.phoneLogin', { mode: 'bind', code: 'primary' }), 'UNAUTHENTICATED');
  assert.equal(f.exchanges(), 1);
});
test('same verified phone converges, another phone isolates preferences and repeated logins', async () => {
  const f = world();
  const primary = await bound(f);
  const same = ok(await f.call('account.phoneLogin', { mode: 'login', code: 'primary' }));
  assert.equal(same.scope, primary.scope);
  const other = ok(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }));
  assert.notEqual(other.scope, primary.scope);
  const auth = { phoneSession: other.phoneSession, sessionScope: other.scope };
  ok(await f.call('account.preferences', { operation: 'set', cardTextPreview: true }, auth));
  assert.equal(
    ok(await f.call('account.preferences', { operation: 'get' }, { sessionScope: primary.scope }))
      .cardTextPreview,
    false,
  );
  assert.equal(
    ok(await f.call('account.preferences', { operation: 'get' }, auth)).cardTextPreview,
    true,
  );
  assert.equal(
    ok(await f.call('account.session', {}, { phoneSession: other.phoneSession })).scope,
    other.scope,
  );
  assert.equal(ok(await f.call('account.session')).scope, primary.scope);
  const repeat = await Promise.all([
    f.call('account.phoneLogin', { mode: 'login', code: 'other' }),
    f.call('account.phoneLogin', { mode: 'login', code: 'other' }),
  ]);
  repeat.forEach((r) => assert.equal(ok(r).scope, other.scope));
});
test('phone credential cannot forge ownership, cross WeChat, outlive expiry or bypass scope', async () => {
  const f = world();
  await bound(f);
  const other = ok(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }));
  error(
    await f.call('account.session', {}, { phoneSession: other.phoneSession + 'x' }),
    'UNAUTHENTICATED',
  );
  error(
    await f.call('account.session', {}, { phoneSession: other.phoneSession }, 'another_wechat'),
    'UNAUTHENTICATED',
  );
  error(
    await f.call(
      'account.preferences',
      { operation: 'get' },
      { phoneSession: other.phoneSession, sessionScope: 'scope_' + 'a'.repeat(64) },
    ),
    'UNAUTHENTICATED',
  );
  error(
    await f.call('account.phoneLogin', { mode: 'login', code: 'other', ownerId: 'forged' }),
    'INVALID_REQUEST',
  );
  f.expire();
  error(
    await f.call('account.session', {}, { phoneSession: other.phoneSession }),
    'UNAUTHENTICATED',
  );
});

test('verified existing phone can recover on another WeChat or after the primary account closes', async () => {
  const f = world();
  const primary = await bound(f);
  const other = ok(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }));
  ok(await f.call('account.close', { confirm: 'CLOSE' }, { sessionScope: primary.scope }));
  assert.equal(
    ok(await f.call('account.phoneLogin', { mode: 'login', code: 'other' })).scope,
    other.scope,
  );
  const recovered = ok(
    await f.call(
      'account.phoneLogin',
      { mode: 'login', code: 'other' },
      {},
      'synthetic_new_wechat',
    ),
  );
  assert.equal(recovered.scope, other.scope);
  assert.notEqual(recovered.phoneSession, other.phoneSession);
});
test('failed verification and conflicting binding preserve existing accounts', async () => {
  const f = world();
  const primary = await bound(f);
  error(await f.call('account.phoneLogin', { mode: 'login', code: 'invalid' }), 'UNAUTHENTICATED');
  error(
    await f.call(
      'account.phoneLogin',
      { mode: 'bind', code: 'other' },
      { sessionScope: primary.scope },
    ),
    'CONFLICT',
  );
  assert.equal(
    ok(await f.call('account.phoneLogin', { mode: 'login', code: 'primary' })).scope,
    primary.scope,
  );
});
test('phone account closure blocks old credentials and repeated phone login', async () => {
  const f = world();
  await bound(f);
  const other = ok(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }));
  const auth = { phoneSession: other.phoneSession, sessionScope: other.scope };
  ok(await f.call('account.close', { confirm: 'CLOSE' }, auth));
  ok(await f.call('account.close', { confirm: 'CLOSE' }, auth));
  error(
    await f.call('account.session', {}, { phoneSession: other.phoneSession }),
    'ACCOUNT_DISABLED',
  );
  error(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }), 'ACCOUNT_DISABLED');
});
test('client restores selected phone, explicitly returns to WeChat, and clears it on logout', async () => {
  const memory = new Map();
  const sent = [];
  const platform = {
    getStorageSync: (k) => memory.get(k),
    setStorageSync: (k, v) => memory.set(k, v),
    removeStorageSync: (k) => memory.delete(k),
    cloud: {
      callFunction: async ({ data }) => {
        sent.push(data);
        return { result: { apiVersion: '1', requestId: data.requestId, ok: true, data: {} } };
      },
    },
  };
  savePhoneSession(platform, 'synthetic_signed_credential');
  const state = createSessionState();
  const config = {
    cloudEnabled: true,
    cloudEnvId: ENV_ID,
    cloudFunctionName: 'moodsky-release',
    releaseProfile: 'production',
  };
  await createApiClient(platform, config, { sessionState: state }).call(
    createRequest('account.session'),
  );
  assert.equal(sent.at(-1).phoneSession, 'synthetic_signed_credential');
  await createApiClient(platform, config, { sessionState: state, ignorePhoneSession: true }).call(
    createRequest('account.session'),
  );
  assert.equal(sent.at(-1).phoneSession, undefined);
  forgetLogin(platform);
  assert.equal(readPhoneSession(platform), undefined);
});

function loginPageFixture() {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const { createCloudSession } = require('../miniprogram/modules/account/cloud-session');
  const file = path.resolve(__dirname, '../miniprogram/pages/login/index.js');
  const localRequire = createRequire(file);
  const state = createSessionState();
  const sent = [],
    navigations = [];
  let definition;
  let complete, reject;
  const response = new Promise((resolve, fail) => {
    complete = resolve;
    reject = fail;
  });
  const platform = { setStorageSync() {}, switchTab: ({ url }) => navigations.push(url) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (page) => {
      definition = page;
    },
    wx: platform,
    require: (id) => {
      if (id === '../../config/environment.local') {
        return { releaseProfile: 'production', phoneLoginEnabled: true };
      }
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../services/api') {
        return {
          createRequest,
          createApiClient: (_platform, _environment, options) => ({
            call: async (request) => {
              assert.equal(options.ignorePhoneSession, true);
              sent.push(request);
              return {
                ok: true,
                data: {
                  authenticated: true,
                  scope: 'scope_' + 'd'.repeat(64),
                  capabilities: ['journal', 'review', 'tasks'],
                },
              };
            },
          }),
          call: (request) => {
            sent.push(request);
            return response;
          },
        };
      }
      if (id === '../../modules/account/cloud-session') {
        return { createCloudSession: (options) => createCloudSession({ state, ...options }) };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: globalThis.structuredClone(definition.data),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.data.agreed = true;
  return {
    page,
    sent,
    navigations,
    state,
    fail: () =>
      reject(
        Object.assign(new Error('请先微信登录，在「账号与数据」中绑定本微信使用的手机号。'), {
          code: 'CONFLICT',
        }),
      ),
    complete: () =>
      complete({
        ok: true,
        data: {
          authenticated: true,
          scope: 'scope_' + 'c'.repeat(64),
          capabilities: ['journal', 'review', 'tasks'],
          phoneSession: 'synthetic_credential',
        },
      }),
  };
}
test('actual phone login page handles cancel, agreement, duplicate taps and the selected account', async () => {
  const f = loginPageFixture();
  await f.page.onPhoneLogin({ detail: {} });
  assert.equal(f.sent.length, 0);
  f.page.data.agreed = false;
  await f.page.onPhoneLogin({ detail: { code: 'synthetic_code' } });
  assert.equal(f.sent.length, 0);
  f.page.data.agreed = true;
  const pending = f.page.onPhoneLogin({ detail: { code: 'synthetic_code' } });
  await f.page.onPhoneLogin({ detail: { code: 'synthetic_code' } });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].action, 'account.phoneLogin');
  assert.equal(f.sent[0].payload.mode, 'login');
  f.complete();
  await pending;
  assert.equal(f.state.capture().phoneSession, 'synthetic_credential');
  assert.equal(f.navigations.length, 1);
});
test('hiding actual phone login page rejects a late authentication result', async () => {
  const f = loginPageFixture();
  const pending = f.page.onPhoneLogin({ detail: { code: 'synthetic_code' } });
  f.page.onHide();
  f.complete();
  await pending;
  assert.equal(f.state.capture(), null);
  assert.equal(f.navigations.length, 0);
});

test('native phone failures distinguish cancellation from permission, privacy and missing code', async () => {
  const cases = [
    [{ errMsg: 'getPhoneNumber:fail user deny' }, /你取消了手机号授权/],
    [{ errMsg: 'getPhoneNumber:fail user cancel' }, /你取消了手机号授权/],
    [
      { errMsg: 'getPhoneNumber:fail operateWXData:fail jsapi has no permission', errno: 102 },
      /主体认证.*微信错误码：102/,
    ],
    [{ errMsg: 'getPhoneNumber:fail privacy permission denied' }, /隐私授权未完成/],
    [{ errMsg: 'getPhoneNumber:fail quota limit exceeded' }, /额度暂不可用/],
    [{ errMsg: 'getPhoneNumber:fail network timeout' }, /检查网络/],
    [{ errMsg: 'getPhoneNumber:fail not supported' }, /更新微信/],
    [
      {
        errMsg: 'getPhoneNumber:ok',
        encryptedData: 'synthetic_private_data',
        iv: 'synthetic_private_iv',
      },
      /更新微信/,
    ],
    [{}, /未返回手机号授权码/],
    [null, /未返回手机号授权码/],
    [
      { errMsg: 'getPhoneNumber:fail synthetic_private_message', errno: 'synthetic_private_errno' },
      /未返回手机号授权码/,
    ],
  ];
  for (const [detail, expected] of cases) {
    const f = loginPageFixture();
    await f.page.onPhoneLogin({ detail });
    assert.match(f.page.data.wechatLoginNotice, expected);
    if (!/user deny|user cancel/.test(detail?.errMsg || '')) {
      assert.doesNotMatch(f.page.data.wechatLoginNotice, /你取消了/);
    }
    assert.doesNotMatch(f.page.data.wechatLoginNotice, /synthetic_private/);
    assert.equal(f.page.data.wechatLoginBusy, false);
    assert.equal(f.sent.length, 0);
    assert.equal(f.state.capture(), null);
    assert.equal(f.navigations.length, 0);
  }
});

test('primary login tap waits for the native number selection without a silent WeChat login', async () => {
  const f = loginPageFixture();
  await f.page.onWechatLogin();
  assert.equal(f.sent.length, 0);
  assert.equal(f.state.capture(), null);
  assert.equal(f.navigations.length, 0);
});
test('first-time legacy binding stays on the same native button and uses a verified scope', async () => {
  const f = loginPageFixture();
  const first = f.page.onPhoneLogin({ detail: { code: 'first_code' } });
  f.fail();
  await first;
  assert.equal(f.page.data.phoneBindingRequired, true);
  assert.equal(f.state.capture(), null);
  await f.page.onPhoneLogin({ detail: { code: 'bind_code' } });
  assert.equal(f.sent[1].action, 'account.session');
  assert.equal(f.sent[2].action, 'account.phoneLogin');
  assert.equal(f.sent[2].payload.mode, 'bind');
  assert.equal(f.sent[2].payload.code, 'bind_code');
  assert.equal(f.page.data.phoneBindingRequired, false);
  assert.equal(f.state.capture().scope, 'scope_' + 'd'.repeat(64));
});
test('leaving before first-time WeChat scope discovery prevents a late binding write', async () => {
  const f = loginPageFixture();
  f.page.data.phoneBindingRequired = true;
  const pending = f.page.onPhoneLogin({ detail: { code: 'bind_code' } });
  f.page.onHide();
  await pending;
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].action, 'account.session');
  assert.equal(f.state.capture(), null);
});

test('phone identity indexes stay separate from login accounts and survive owner closure', async () => {
  const f = world();
  await bound(f);
  const other = ok(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }));
  const indexes = Object.values(f.inspect()).filter(
    (x) => x.identityKind === 'verified-phone-index-v1',
  );
  assert.equal(indexes.length, 2);
  indexes.forEach((row) => {
    assert.match(row._id, /^phone_[a-f0-9]{64}$/);
    assert.equal(row.openid, row._id);
    assert.equal(row.status, 'mapping');
    assert.match(row.ownerId, /^acct_[a-f0-9]{64}$/);
  });
  assert.equal(
    f.calls.some((x) => x.collection === 'phone_identities'),
    false,
  );
  ok(
    await f.call(
      'account.close',
      { confirm: 'CLOSE' },
      { phoneSession: other.phoneSession, sessionScope: other.scope },
    ),
  );
  assert.deepEqual(
    Object.values(f.inspect()).filter((x) => x.identityKind === 'verified-phone-index-v1'),
    indexes,
  );
  error(await f.call('account.phoneLogin', { mode: 'login', code: 'other' }), 'ACCOUNT_DISABLED');
});
