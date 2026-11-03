const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate } = require('node:timers');
const { createRequire } = require('node:module');
const { createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');
const { AppError } = require('../miniprogram/shared/result');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ nativeModal = true } = {}) {
  const session = createSessionState();
  session.accept('scope_' + 'a'.repeat(64));
  const requests = [],
    modals = [];
  let uncertain = true;
  const api = {
    createRequest,
    async call(request) {
      requests.push(request);
      if (request.payload.operation === 'set' && uncertain) {
        throw new AppError('NETWORK_ERROR', 'synthetic');
      }
      return {
        ok: true,
        data: {
          nickname: request.payload.nickname || 'synthetic saved',
          avatarData: '',
          version: 1,
          updatedAt: '2026-11-03T04:00:00.000Z',
        },
      };
    },
  };
  const file = path.resolve(__dirname, '../miniprogram/pages/profile/index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: nativeModal ? { showModal: (input) => modals.push(input) } : {},
    require(id) {
      if (id === '../../services/api') {
        return api;
      }
      if (id === '../../services/session-state') {
        return { cloudSessionState: session };
      }
      if (id === '../../config/environment.local') {
        return {};
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
  return {
    page,
    requests,
    modals,
    session,
    succeed: () => {
      uncertain = false;
    },
  };
}
async function edit(f) {
  await f.page.onLoad();
  f.page.onNicknameInput({ detail: { value: 'synthetic draft' } });
  f.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://synthetic-local' } });
}
async function unknownSave(f) {
  await f.page.onLoad();
  f.page.onNicknameInput({ detail: { value: 'synthetic draft' } });
  await f.page.onSave({ detail: { value: { nickname: 'synthetic draft' } } });
  assert.equal(f.page.data.pending, true);
}
test('W4 profile reload cancellation keeps the actual nickname and avatar draft', async () => {
  const f = fixture();
  await edit(f);
  await f.page.onReload();
  assert.equal(f.requests.length, 1);
  assert.equal(f.modals.length, 1);
  f.modals[0].success({ confirm: false });
  f.modals[0].complete();
  assert.equal(f.page.data.nickname, 'synthetic draft');
  assert.equal(f.page.data.avatarPath, 'wxfile://synthetic-local');
  assert.equal(f.page.data.hasUnsavedChanges, true);
  f.page.onUnload();
});
test('W4 cancelling reload after an unknown profile save retries the identical request', async () => {
  const f = fixture();
  await unknownSave(f);
  const original = f.requests[1];
  await f.page.onReload();
  assert.equal(f.requests.length, 2);
  f.modals[0].success({ confirm: false });
  f.modals[0].complete();
  f.succeed();
  await f.page.onRetry();
  assert.equal(f.requests[2], original);
  assert.equal(f.page.data.pending, false);
  assert.equal(f.page.data.hasUnsavedChanges, false);
  f.page.onUnload();
});
test('W4 confirmed profile reload discards locally once and reads server without another write', async () => {
  const f = fixture();
  await unknownSave(f);
  await f.page.onReload();
  await f.page.onReload();
  assert.equal(f.modals.length, 1);
  assert.match(f.modals[0].content, /不会撤销/);
  f.modals[0].success({ confirm: true });
  f.modals[0].success({ confirm: true });
  f.modals[0].complete();
  await tick();
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].payload.operation, 'get');
  assert.equal(f.page.data.pending, false);
  assert.equal(f.page.data.nickname, 'synthetic saved');
  f.page.onUnload();
});
for (const boundary of ['account', 'hide', 'unload']) {
  test(`W4 a profile reload confirmation cannot discard later work after ${boundary}`, async () => {
    const f = fixture();
    await edit(f);
    await f.page.onReload();
    assert.equal(f.modals.length, 1);
    if (boundary === 'account') {
      f.session.accept('scope_' + 'b'.repeat(64));
      await f.page.onReload();
      f.page.onNicknameInput({ detail: { value: 'synthetic B draft' } });
    } else {
      f.page[boundary === 'hide' ? 'onHide' : 'onUnload']();
    }
    const count = f.requests.length;
    const before = JSON.stringify(f.page.data);
    f.modals[0].success({ confirm: true });
    f.modals[0].complete();
    await tick();
    assert.equal(f.requests.length, count);
    assert.equal(JSON.stringify(f.page.data), before);
    f.page.onUnload();
  });
}
test('W4 unsupported native confirmation keeps profile inputs instead of silently reloading', async () => {
  const f = fixture({ nativeModal: false });
  await edit(f);
  await f.page.onReload();
  assert.equal(f.requests.length, 1);
  assert.equal(f.page.data.avatarPath, 'wxfile://synthetic-local');
  assert.equal(f.page.data.hasUnsavedChanges, true);
  f.page.onUnload();
});
