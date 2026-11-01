const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');
const { profileView } = require('../miniprogram/shared/profile');
const {
  LOGIN_KEY,
  hasRememberedLogin,
  rememberLogin,
  forgetLogin,
} = require('../miniprogram/modules/account/login-memory');
const { prepareAvatar } = require('../miniprogram/modules/account/avatar');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionCleanup } = require('../cloudfunctions/moodsky/production/cleanup');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const root = path.resolve(__dirname, '..');
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlC0AAAAASUVORK5CYII=';
const avatar = 'data:image/png;base64,' + png;
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
function world(storage) {
  const f = databaseFixture();
  const scopes = {};
  const call = async (who, action, payload = {}, original) => {
    const request = original || createRequest(action, payload);
    const result = await createProductionEntry({
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: who,
        identityFromCurrentInvocation: true,
      }),
      readConfig: () => config,
      openDatabase: () => storage || f.db,
      now: () => new Date('2026-11-01T13:00:00.000Z'),
    })({ ...request, ...(scopes[who] ? { sessionScope: scopes[who] } : {}) });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  };
  return { ...f, call };
}
test('installed native database SDK preserves profile writes, replay and preference source revisions', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const f = world(createProductionDatabase(nativeDb));
      ok(await f.call('native-profile', 'account.session'));
      const request = createRequest('account.profile', setProfile());
      const saved = ok(await f.call('native-profile', 'account.profile', {}, request));
      assert.deepEqual(ok(await f.call('native-profile', 'account.profile', {}, request)), saved);
      assert.equal(
        ok(await f.call('native-profile', 'account.profile', { operation: 'get' })).avatarData,
        avatar,
      );
    },
    { nativeDatabase: true },
  );
});
function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
const setProfile = (nickname = '合成昵称', extra = {}) => ({
  operation: 'set',
  nickname,
  avatarData: avatar,
  expectedVersion: 0,
  ...extra,
});

test('profile is optional, private to one WeChat user, persistent across fresh handlers, and preference writes retain it', async () => {
  const f = world();
  ok(await f.call('a', 'account.session'));
  ok(await f.call('b', 'account.session'));
  assert.deepEqual(
    ok(await f.call('a', 'account.profile', { operation: 'get' })),
    profileView(null),
  );
  const saved = ok(await f.call('a', 'account.profile', setProfile()));
  assert.equal(saved.nickname, '合成昵称');
  assert.equal(saved.avatarData, avatar);
  assert.equal(saved.version, 1);
  assert.deepEqual(ok(await f.call('a', 'account.profile', { operation: 'get' })), saved);
  assert.deepEqual(
    ok(await f.call('b', 'account.profile', { operation: 'get' })),
    profileView(null),
  );
  ok(await f.call('a', 'account.preferences', { operation: 'set', cardTextPreview: true }));
  assert.deepEqual(ok(await f.call('a', 'account.profile', { operation: 'get' })), saved);
  assert.doesNotMatch(JSON.stringify(saved), /ownerId|scope_|requestId|digest|openid/);
});

test('profile writes replay the exact original request without adding a version or invalidating newer unrelated preferences', async () => {
  const f = world();
  ok(await f.call('a', 'account.session'));
  const request = createRequest('account.profile', setProfile());
  const saved = ok(await f.call('a', 'account.profile', {}, request));
  ok(await f.call('a', 'account.preferences', { operation: 'set', decorationsEnabled: false }));
  assert.deepEqual(ok(await f.call('a', 'account.profile', {}, request)), saved);
  assert.equal(
    (await f.call('a', 'account.profile', {}, { ...request, payload: setProfile('其他内容') }))
      .error.code,
    'CONFLICT',
  );
  assert.equal(
    (await f.call('a', 'account.profile', setProfile('旧版本修改'))).error.code,
    'CONFLICT',
  );
  assert.equal(
    ok(
      await f.call(
        'a',
        'account.profile',
        setProfile('新昵称', { expectedVersion: 1, avatarData: '' }),
      ),
    ).version,
    2,
  );
  assert.equal(
    ok(await f.call('a', 'account.preferences', { operation: 'get' })).decorationsEnabled,
    false,
  );
});

test('profile data is included in JSON and Markdown export, later updates invalidate old exports, closure removes it', async () => {
  const f = world();
  ok(await f.call('a', 'account.session'));
  ok(await f.call('a', 'account.profile', setProfile()));
  const json = ok(await f.call('a', 'account.requestExport', { format: 'json' }));
  const file = ok(await f.call('a', 'account.downloadExport', { jobId: json.jobId }));
  const content = JSON.parse(file.content);
  assert.equal(content.data.preferences.profile.nickname, '合成昵称');
  assert.equal(content.data.preferences.profile.avatarData, avatar);
  assert.doesNotMatch(file.content, /requestId|digest|scope_|openid/);
  const md = ok(await f.call('a', 'account.requestExport', { format: 'markdown' }));
  assert.match(
    ok(await f.call('a', 'account.downloadExport', { jobId: md.jobId })).content,
    /合成昵称/,
  );
  ok(await f.call('a', 'account.profile', setProfile('新昵称', { expectedVersion: 1 })));
  assert.equal(
    (await f.call('a', 'account.downloadExport', { jobId: json.jobId })).error.code,
    'CONFLICT',
  );
  const closed = ok(await f.call('a', 'account.close', { confirm: 'CLOSE' }));
  assert.equal(
    (await f.call('a', 'account.profile', { operation: 'get' })).error.code,
    'ACCOUNT_DISABLED',
  );
  const worker = createProductionCleanup({ db: f.db });
  for (let i = 0; i < 20; i++) {
    if ((await worker.step(closed.cleanup.jobId)).state === 'completed') {
      break;
    }
  }
  const dump = JSON.stringify(f.inspect());
  assert.doesNotMatch(dump, /合成昵称|新昵称|data:image/);
});

for (const [title, payload] of [
  ['too long nickname', setProfile('长'.repeat(21))],
  ['control characters', setProfile('换\n行')],
  ['external avatar URL', setProfile('正常', { avatarData: 'https://example.invalid/avatar.jpg' })],
  ['invalid image bytes', setProfile('正常', { avatarData: 'data:image/png;base64,YWJj' })],
  [
    'oversized image',
    setProfile('正常', { avatarData: 'data:image/png;base64,' + png + 'A'.repeat(45000) }),
  ],
  ['owner spoofing', { ...setProfile(), ownerId: 'b' }],
  ['GET with write fields', { operation: 'get', nickname: '注入' }],
]) {
  test('profile refuses ' + title, async () => {
    const f = world();
    ok(await f.call('a', 'account.session'));
    const forged = {
      apiVersion: '1',
      requestId: 'req_profile_validation_001',
      action: 'account.profile',
      payload,
    };
    assert.equal((await f.call('a', 'account.profile', {}, forged)).ok, false);
    assert.deepEqual(
      ok(await f.call('a', 'account.profile', { operation: 'get' })),
      profileView(null),
    );
  });
}

function page(name, modules = {}, platform = {}) {
  const file = path.join(root, 'miniprogram/pages', name, 'index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    wx: platform,
    Page: (p) => {
      definition = p;
    },
    require: (id) => modules[id] || local(id),
    setTimeout,
    clearTimeout,
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}
function scopeModule(state) {
  return { '../../services/session-state': { cloudSessionState: state } };
}

test('WeChat sign-in requires agreement and native privacy acceptance; cancellation sends no account request', async () => {
  const state = createSessionState();
  let calls = 0;
  const p = page(
    'login',
    {
      ...scopeModule(state),
      '../../config/environment.local': { releaseProfile: 'production' },
      '../../modules/account/cloud-session': {
        createCloudSession: () => ({
          async refresh() {
            calls++;
          },
          dispose() {},
        }),
      },
    },
    { requirePrivacyAuthorize: ({ fail }) => fail() },
  );
  p.onLoad();
  await p.onWechatLogin();
  assert.equal(calls, 0);
  assert.match(p.data.wechatLoginNotice, /同意/);
  p.onAgreement({ detail: { value: ['agree'] } });
  await p.onWechatLogin();
  assert.equal(calls, 0);
  assert.equal(p.data.wechatLoginBusy, false);
  assert.match(p.data.wechatLoginNotice, /稍后/);
  p.onUnload();
});

test('remembered login stores only a flow flag and logout clears it without deleting the cloud account', () => {
  const values = new Map();
  const platform = {
    getStorageSync: (k) => values.get(k),
    setStorageSync: (k, v) => values.set(k, v),
    removeStorageSync: (k) => values.delete(k),
  };
  assert.equal(hasRememberedLogin(platform), false);
  assert.equal(rememberLogin(platform), true);
  assert.deepEqual([...values.entries()], [[LOGIN_KEY, true]]);
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  const p = page(
    'me',
    { ...scopeModule(state), '../../config/environment.local': { releaseProfile: 'production' } },
    platform,
  );
  p.onLoad();
  assert.equal(p.data.wechatAuthenticated, true);
  p.onLogout();
  assert.equal(p.data.wechatAuthenticated, false);
  assert.equal(p.data.profileNickname, '微信用户');
  assert.equal(state.capture(), null);
  assert.equal(hasRememberedLogin(platform), false);
  p.onUnload();
  rememberLogin(platform);
  forgetLogin(platform);
  assert.equal(values.size, 0);
});

test('avatar compression uses the selected local image and sends bounded image bytes rather than a temporary path', async () => {
  let input;
  const data = await prepareAvatar(
    {
      compressImage(options) {
        input = options;
        options.success({ tempFilePath: 'synthetic_compressed' });
      },
      getFileSystemManager: () => ({
        readFile(options) {
          assert.equal(options.filePath, 'synthetic_compressed');
          options.success({ data: png });
        },
      }),
    },
    'synthetic_selected',
  );
  assert.equal(input.src, 'synthetic_selected');
  assert.equal(input.compressedWidth, 128);
  assert.equal(data, avatar);
  await assert.rejects(
    prepareAvatar(
      {
        compressImage: (o) => o.success({ tempFilePath: 'synthetic' }),
        getFileSystemManager: () => ({ readFile: (o) => o.success({ data: 'A'.repeat(45000) }) }),
      },
      'synthetic',
    ),
    { code: 'INVALID_INPUT' },
  );
});

test('personal center immediately clears an old avatar and nickname when a different account is accepted', () => {
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  const p = page('me', {
    ...scopeModule(state),
    '../../config/environment.local': { releaseProfile: 'production' },
  });
  p.onLoad();
  p.setData({ profileNickname: 'SYNTHETIC A private name', profileAvatar: avatar });
  state.accept('scope_' + 'b'.repeat(64));
  assert.equal(p.data.profileNickname, '微信用户');
  assert.equal(p.data.profileAvatar, '/assets/jiaqi/user.png');
  assert.equal(p.data.wechatAuthenticated, true);
  p.onUnload();
});

test('profile editor submits the checked nickname, retries original request, and never carries profile content across sessions', async () => {
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  let fail = true;
  const sent = [];
  const api = {
    createRequest,
    async call(request) {
      if (request.payload.operation === 'get') {
        return { data: profileView(null) };
      }
      sent.push(request);
      if (fail) {
        throw Error('Synthetic response loss');
      }
      return {
        data: {
          nickname: request.payload.nickname,
          avatarData: '',
          version: 1,
          updatedAt: '2026-11-01T13:00:00.000Z',
        },
      };
    },
  };
  const p = page('profile', { ...scopeModule(state), '../../services/api': api });
  await p.onLoad();
  assert.equal(p.data.loaded, true);
  await p.onSave({ detail: { value: { nickname: '已检查的昵称' } } });
  assert.equal(p.data.pending, true);
  fail = false;
  await p.onRetry();
  assert.equal(sent[0], sent[1]);
  assert.equal(p.data.nickname, '已检查的昵称');
  state.accept('scope_' + 'b'.repeat(64));
  assert.equal(p.data.nickname, '');
  assert.equal(p.data.avatarData, '');
  assert.equal(p.data.loaded, false);
  p.onUnload();
});

test('profile UI uses the native avatar and nickname components and submits a form', () => {
  const markup = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/index.wxml'), 'utf8');
  assert.match(markup, /open-type="chooseAvatar"/);
  assert.match(markup, /bindchooseavatar="onChooseAvatar"/);
  assert.match(markup, /name="nickname" type="nickname"/);
  assert.match(markup, /form-type="submit"/);
});

test('new production clients cannot silently establish an account before sign-in, and restore only a server-verified session', async () => {
  const state = createSessionState(),
    values = new Map();
  let calls = 0;
  const platform = {
    getStorageSync: (key) => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
  };
  const file = path.join(root, 'miniprogram/modules/account/cloud-session.js'),
    local = createRequire(file),
    module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module,
    wx: platform,
    require(id) {
      if (id === '../../config/environment.local') {
        return { explicitWechatLogin: true };
      }
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../services/api') {
        return {
          createRequest: () => ({}),
          async call() {
            calls++;
            return {
              ok: true,
              data: {
                authenticated: true,
                scope: 'scope_' + 'a'.repeat(64),
                capabilities: ['journal', 'review', 'tasks'],
              },
            };
          },
        };
      }
      return local(id);
    },
  });
  assert.equal(await module.exports.ensureCloudSession(), false);
  assert.equal(calls, 0);
  rememberLogin(platform);
  assert.equal(await module.exports.ensureCloudSession(), true);
  assert.equal(calls, 1);
  state.clear();
  assert.equal(await module.exports.ensureCloudSession(), true);
  assert.equal(calls, 2);
  state.clear();
  values.clear();
  assert.equal(await module.exports.ensureCloudSession(), false);
  assert.equal(calls, 2);
});

for (const change of ['unload', 'new account']) {
  test('profile editor ignores late private content after ' + change, async () => {
    const state = createSessionState();
    state.accept('scope_' + 'a'.repeat(64));
    let release;
    const api = {
      createRequest,
      call: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const p = page('profile', { ...scopeModule(state), '../../services/api': api });
    const pending = p.onLoad();
    if (change === 'unload') {
      p.onUnload();
    } else {
      state.accept('scope_' + 'b'.repeat(64));
    }
    release({
      data: {
        nickname: 'synthetic old private profile',
        avatarData: avatar,
        version: 1,
        updatedAt: '2026-11-01T13:00:00.000Z',
      },
    });
    await pending;
    assert.equal(p.data.nickname, '');
    assert.equal(p.data.avatarData, '');
    p.onUnload();
  });
}
