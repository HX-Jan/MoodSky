const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const saved = (nickname = 'synthetic saved') => ({
  ok: true,
  data: {
    nickname,
    avatarData: '',
    version: 1,
    updatedAt: '2026-11-03T14:00:00Z',
  },
});
function fixture({ platform = {}, submit } = {}) {
  const session = createSessionState(),
    calls = [],
    requests = [];
  session.accept('scope_' + 'a'.repeat(64));
  const file = path.resolve(__dirname, '../miniprogram/pages/profile/index.js'),
    local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {
      enableAlertBeforeUnload: (input) => {
        calls.push({ kind: 'enable', ...input });
        input.success?.({});
      },
      disableAlertBeforeUnload: (input) => {
        calls.push({ kind: 'disable', ...input });
        input.success?.({});
      },
      ...platform,
    },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {};
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: session };
      }
      if (id.endsWith('/services/api')) {
        return {
          createRequest,
          call: async (request) => {
            requests.push(request);
            return request.payload.operation === 'get'
              ? saved()
              : submit
                ? submit(request)
                : saved(request.payload.nickname);
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
  return { page, calls, session, requests };
}
const type = (page, value) => page.onNicknameInput({ detail: { value } });
const save = (page) => page.onSave({ detail: { value: { nickname: page.data.nickname } } });
test('profile blur without edits stays clean, and an exact nickname revert releases native return protection', async () => {
  const f = fixture();
  await f.page.onLoad();
  f.page.onShow();
  type(f.page, 'synthetic saved');
  assert.equal(f.page.data.hasUnsavedChanges, false);
  assert.equal(f.calls.length, 0);
  type(f.page, 'synthetic changed');
  type(f.page, 'synthetic changed more');
  assert.equal(f.calls.length, 1);
  assert.match(f.page.data.leaveWarning, /未保存/);
  type(f.page, 'synthetic saved');
  assert.equal(f.page.data.hasUnsavedChanges, false);
  assert.equal(f.page.data.leaveWarning, '');
  assert.equal(f.calls.at(-1).kind, 'disable');
  f.page.onUnload();
});
test('profile avatar selection is protected and restoring an originally empty avatar releases the guard', async () => {
  const f = fixture();
  await f.page.onLoad();
  f.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://synthetic-avatar' } });
  assert.match(f.page.data.leaveWarning, /未保存/);
  assert.equal(f.calls.at(-1).kind, 'enable');
  f.page.onDefaultAvatar();
  assert.equal(f.page.data.hasUnsavedChanges, false);
  assert.equal(f.page.data.leaveWarning, '');
  assert.equal(f.calls.at(-1).kind, 'disable');
  f.page.onUnload();
});
test('profile unknown save keeps a stronger warning and retries the identical request before releasing it', async () => {
  let fail = true;
  const f = fixture({
    submit: async (request) => {
      if (fail) {
        throw new AppError('NETWORK_ERROR', 'synthetic');
      }
      return saved(request.payload.nickname);
    },
  });
  await f.page.onLoad();
  type(f.page, 'synthetic draft');
  await save(f.page);
  assert.match(f.page.data.leaveWarning, /结果尚未确认/);
  assert.equal(f.page.data.pending, true);
  const original = f.requests[1];
  fail = false;
  await f.page.onRetry();
  assert.equal(f.requests[2], original);
  assert.equal(f.page.data.leaveWarning, '');
  assert.equal(f.page.data.hasUnsavedChanges, false);
  assert.equal(f.calls.at(-1).kind, 'disable');
  f.page.onUnload();
});
test('profile drafts survive hide/show and native guard calls wait until the page is visible', async () => {
  let resolve;
  const f = fixture({
    submit: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  await f.page.onLoad();
  type(f.page, 'synthetic draft');
  f.page.onHide();
  const before = f.calls.length;
  f.page.onShow();
  assert.equal(f.page.data.nickname, 'synthetic draft');
  assert.equal(f.calls.length, before + 1);
  const writing = save(f.page);
  f.page.onHide();
  const hidden = f.calls.length;
  resolve(saved('synthetic draft'));
  await writing;
  assert.equal(f.calls.length, hidden, 'A hidden save must not alter another page guard');
  assert.equal(f.page.data.leaveWarning, '');
  f.page.onShow();
  assert.equal(f.calls.at(-1).kind, 'disable');
  assert.equal(f.page.data.hasUnsavedChanges, false);
  f.page.onUnload();
});
test('profile account change clears both the dirty baseline and native return warning', async () => {
  const f = fixture();
  await f.page.onLoad();
  type(f.page, 'SYNTHETIC_PRIVATE_A');
  f.session.accept('scope_' + 'b'.repeat(64));
  assert.equal(f.page.data.nickname, '');
  assert.equal(f.page.data.leaveWarning, '');
  assert.equal(f.page.data.hasUnsavedChanges, false);
  assert.equal(f.calls.at(-1).kind, 'disable');
  await f.page.onReload();
  type(f.page, 'synthetic saved');
  assert.equal(f.page.data.hasUnsavedChanges, false);
  assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC_PRIVATE_A/);
  f.page.onUnload();
});
test('profile older or failed native APIs keep a visible safe warning and a working save', async () => {
  for (const platform of [
    { enableAlertBeforeUnload: undefined, disableAlertBeforeUnload: undefined },
    {
      enableAlertBeforeUnload() {
        throw new Error('SYNTHETIC private diagnostic');
      },
    },
    {
      enableAlertBeforeUnload(input) {
        input.fail({ errMsg: 'SYNTHETIC private diagnostic' });
      },
    },
  ]) {
    const f = fixture({ platform });
    await f.page.onLoad();
    type(f.page, 'synthetic draft');
    assert.match(f.page.data.leaveWarning, /未保存/);
    assert.doesNotMatch(f.page.data.leaveWarning, /SYNTHETIC|diagnostic/);
    await save(f.page);
    assert.equal(f.page.data.leaveWarning, '');
    f.page.onUnload();
  }
});
test('profile ignores late enable callbacks and retries failed cleanup when unloading', async () => {
  const late = [];
  let disables = 0;
  const f = fixture({
    platform: {
      enableAlertBeforeUnload: (input) => late.push(input.success),
      disableAlertBeforeUnload(input) {
        disables++;
        if (disables === 1) {
          input.fail({});
        } else {
          input.success({});
        }
      },
    },
  });
  await f.page.onLoad();
  type(f.page, 'synthetic draft');
  await save(f.page);
  late.forEach((done) => done({}));
  assert.equal(f.page._leaveGuardReady, false);
  assert.equal(f.page._leaveGuardCleanupNeeded, true);
  f.page.onUnload();
  assert.equal(disables, 2);
  assert.equal(f.page._leaveGuardCleanupNeeded, false);
});
