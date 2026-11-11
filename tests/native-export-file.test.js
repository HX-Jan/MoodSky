const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');

const A = 'scope_' + 'a'.repeat(64);
const B = 'scope_' + 'b'.repeat(64);
const content = 'SYNTHETIC private export';
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function fixture(options = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/account/index.js');
  const local = createRequire(file);
  const session = createSessionState();
  session.accept(A);
  const writes = [];
  const shares = [];
  const disks = [];
  const removed = [];
  const storage = new Map();
  const platform = {
    env: { USER_DATA_PATH: '/synthetic-local' },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    getFileSystemManager: () => ({
      writeFile: (input) => writes.push(input),
      unlink: (input) => removed.push(input.filePath),
    }),
    shareFileMessage(input) {
      shares.push(input);
      if (options.shareThrows) {
        throw new Error('SYNTHETIC native share unavailable');
      }
      if (options.shareSuccess) {
        input.success();
      } else {
        input.fail({ errMsg: 'shareFileMessage:fail cancel' });
      }
    },
  };
  if (options.desktop) {
    platform.saveFileToDisk = (input) => disks.push(input);
  }
  if (options.noFileSystem) {
    delete platform.getFileSystemManager;
  }
  if (options.noShare) {
    delete platform.shareFileMessage;
  }
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
                data: { jobId: 'synthetic_file', format: 'json', state: 'ready' },
              };
            }
            if (request.action === 'account.downloadExport') {
              return {
                ok: true,
                data: { jobId: 'synthetic_file', extension: 'json', content },
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
  page.onExport({ currentTarget: { dataset: {} } });
  await flush();
  assert.equal(page.data.exportJob.state, 'ready');
  return { page, session, writes, shares, disks, removed };
}

test('actual account page prepares one export and reports cancellation accurately', async () => {
  const f = await fixture();
  f.page.onSaveExport();
  f.page.onSaveExport();
  await flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].data, content);
  f.writes[0].success();
  await flush();
  assert.equal(f.shares.length, 1);
  assert.equal(f.shares[0].fileName, '天气记录.json');
  assert.match(f.page.data.notice, /已取消发送/);
  assert.deepEqual(f.removed, [f.writes[0].filePath]);
  assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC private export/);
  f.page.onUnload();
});

for (const change of ['hide', 'unload', 'account-cycle', 'hide-return']) {
  test(`late native file write cannot open an old export share after ${change}`, async () => {
    const f = await fixture();
    f.page.onSaveExport();
    await flush();
    assert.equal(f.writes.length, 1);
    if (change === 'account-cycle') {
      f.session.accept(B);
      f.session.accept(A);
    } else if (change === 'unload') {
      f.page.onUnload();
    } else {
      f.page.onHide();
      if (change === 'hide-return') {
        f.page.onShow();
      }
    }
    f.writes[0].success();
    await flush();
    assert.equal(f.shares.length, 0);
    assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC private export/);
    f.page.onUnload();
  });
}

test('native file failures give a Chinese save error and leave the ready export available', async () => {
  const f = await fixture();
  f.page.onSaveExport();
  await flush();
  f.writes[0].fail({ errMsg: 'writeFile:fail no space' });
  await flush();
  assert.match(f.page.data.notice, /文件保存失败/);
  assert.equal(f.page.data.exportJob.state, 'ready');
  assert.equal(f.page.data.busy, false);
  assert.equal(f.shares.length, 0);
  f.page.onUnload();
});

test('an unavailable native file system produces a Chinese explanation', async () => {
  const f = await fixture({ noFileSystem: true });
  f.page.onSaveExport();
  await flush();
  assert.match(f.page.data.notice, /可以在小程序里查看导出内容/);
  assert.equal(f.page.data.busy, false);
  assert.equal(f.writes.length, 0);
  f.page.onUnload();
});

test('a failing file hand-off keeps the ready export and offers an in-app fallback', async () => {
  const f = await fixture({ shareThrows: true });
  f.page.onSaveExport();
  await flush();
  assert.doesNotThrow(() => f.writes[0].success());
  await flush();
  assert.match(f.page.data.notice, /可以在小程序里查看导出内容/);
  assert.equal(f.page.data.busy, false);
  f.page.onUnload();
});

test('desktop saves to disk and mobile sends a file after native success', async () => {
  for (const options of [{ desktop: true }, { shareSuccess: true }]) {
    const f = await fixture(options);
    f.page.onSaveExport();
    await flush();
    f.writes[0].success();
    await flush();
    if (options.desktop) {
      assert.equal(f.disks[0].filePath, f.writes[0].filePath);
      assert.equal(f.shares.length, 0);
      f.disks[0].success();
    }
    await flush();
    assert.match(f.page.data.notice, options.desktop ? /文件已保存到电脑/ : /文件已发送/);
    assert.deepEqual(f.removed, [f.writes[0].filePath]);
    f.page.onUnload();
  }
});

test('unsupported clients can preview a checked export and clear it on account switch or hide', async () => {
  for (const action of ['switch', 'hide']) {
    const f = await fixture({ noShare: true, noFileSystem: true });
    await f.page.onPreviewExport();
    assert.equal(f.page.data.exportPreview, content);
    assert.equal(f.page.data.exportPreviewTotal, 1);
    assert.equal(f.writes.length, 0);
    if (action === 'switch') {
      f.session.accept(B);
    } else {
      f.page.onHide();
    }
    assert.equal(f.page.data.exportPreview, '');
    assert.equal(f.page._exportPreview, null);
    f.page.onUnload();
  }
});
