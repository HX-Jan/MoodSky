const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../miniprogram/shared/result');
const { createRequest } = require('../miniprogram/services/api');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createProductionAccountController } = require('../miniprogram/modules/account/production');
const {
  UNAVAILABLE_MESSAGE,
  clientCapabilities,
} = require('../miniprogram/modules/system/capabilities');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function fixture(overrides = {}) {
  const storage = new Map();
  const session = createSessionState();
  session.accept('scope_' + 'a'.repeat(64));
  const patches = [];
  const submitted = [];
  const service = {
    authenticate: async () => true,
    preferences: async () => ({
      ok: true,
      data: { cardTextPreview: false, decorationsEnabled: true },
    }),
    createPreferences: (payload) => createRequest('account.preferences', payload),
    createExport: (format) => createRequest('account.requestExport', { format }),
    createClose: () => createRequest('account.close', { confirm: 'CLOSE' }),
    submit: async (request) => {
      submitted.push(request);
      return {
        ok: true,
        data: { jobId: 'week4-export', state: 'ready', format: request.payload.format },
      };
    },
    exportStatus: async (jobId) => ({
      ok: true,
      data: { jobId, state: 'ready', format: 'json' },
    }),
    download: async (jobId) => ({
      ok: true,
      data: { jobId, content: '{}', extension: 'json' },
    }),
    recoverClose: async () => {
      throw new Error('not used');
    },
    cleanupStatus: async () => {
      throw new Error('not used');
    },
    ...overrides,
  };
  const controller = createProductionAccountController({
    service,
    session,
    publish: (patch) => patches.push(patch),
    storage: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
    },
  });
  return {
    controller,
    patches,
    service,
    session,
    submitted,
    latest: () => patches.at(-1),
  };
}

test('W4 L01 distinguishes development, candidate, and online capabilities', () => {
  const development = clientCapabilities({ journalDemo: true, cloudEnabled: false }, 'develop');
  assert.equal(development.stage.code, 'development');
  assert.equal(development.tasks.state, 'available');
  assert.equal(development.accountData.description, UNAVAILABLE_MESSAGE);

  const candidate = clientCapabilities(
    {
      cloudEnabled: true,
      cloudFunctionName: 'moodsky-private-pilot',
      trustedSessionEnabled: true,
    },
    'trial',
  );
  assert.equal(candidate.stage.code, 'candidate');
  assert.equal(candidate.tasks.state, 'available');

  const online = clientCapabilities(
    {
      releaseProfile: 'production',
      taskMode: 'enabled',
      cloudEnabled: true,
      cloudEnvId: 'synthetic-production',
      trustedSessionEnabled: true,
    },
    'release',
  );
  assert.equal(online.stage.code, 'online');
  assert.equal(online.accountData.state, 'available');
  assert.equal(online.tasks.state, 'available');
  assert.match(online.tasks.description, /自己的任务记录/);
});

test('W4 L02 exposes preferences, format selection, recovery, and accessible labels', () => {
  const source = read('miniprogram/pages/account/index.wxml');
  assert.match(source, /data-key="cardTextPreview"[^>]+aria-label="卡片正文预览"/);
  assert.match(source, /data-key="decorationsEnabled"[^>]+aria-label="天气装饰"/);
  assert.match(source, /data-format="json"[^>]+aria-label="选择数据文件，适合备份"/);
  assert.match(source, /data-format="markdown"[^>]+aria-label="选择文本文件，方便阅读"/);
  assert.match(source, /aria-label="按原格式重新申请导出"/);
  assert.match(source, /导出状态：\{\{exportStateLabel\}\}/);
});

test('W4 L02 retains Markdown and retries the exact request after transport failure', async () => {
  let fail = true;
  const sent = [];
  const f = fixture({
    submit: async (request) => {
      sent.push(request);
      if (fail) {
        throw new AppError('NETWORK_ERROR', '连接未确认');
      }
      return { ok: true, data: { jobId: 'week4-retry', state: 'ready' } };
    },
  });
  await f.controller.load();
  f.controller.setExportFormat('markdown');
  await f.controller.requestExport();
  assert.equal(f.latest().exportFormat, 'markdown');
  assert.equal(f.latest().pendingKind, 'export');
  assert.doesNotMatch(f.latest().notice, /成功|已就绪/);
  fail = false;
  await f.controller.retry();
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.equal(sent[1].payload.format, 'markdown');
  assert.equal(f.latest().exportFormat, 'markdown');
  assert.equal(f.latest().exportStateLabel, '可领取');
});

test('W4 L02 reapplies an expired export with the same selected format', async () => {
  let calls = 0;
  const formats = [];
  const f = fixture({
    submit: async (request) => {
      formats.push(request.payload.format);
      calls++;
      return {
        ok: true,
        data: {
          jobId: 'week4-expiry-' + calls,
          state: calls === 1 ? 'expired' : 'ready',
          format: request.payload.format,
        },
      };
    },
  });
  await f.controller.load();
  await f.controller.requestExport('markdown');
  assert.equal(f.latest().exportStateLabel, '已过期');
  assert.match(f.latest().notice, /重新申请/);
  await f.controller.requestExport();
  assert.deepEqual(formats, ['markdown', 'markdown']);
  assert.equal(f.latest().exportStateLabel, '可领取');
});

test('W4 L03 clears private account state and rejects an old response after identity switch', async () => {
  let release;
  const f = fixture({
    submit: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await f.controller.load();
  const pending = f.controller.savePreference('cardTextPreview', true);
  await Promise.resolve();
  f.session.accept('scope_' + 'b'.repeat(64));
  assert.deepEqual(f.latest().preferences, {});
  assert.equal(f.latest().exportJob, null);
  assert.equal(f.latest().authenticated, false);
  release({ ok: true, data: { cardTextPreview: true, decorationsEnabled: true } });
  await pending;
  assert.deepEqual(f.latest().preferences, {});
  assert.match(f.latest().notice, /账号状态已变化/);
});

test('W4 L03 suspend ignores a late export and keeps the exact request retryable', async () => {
  let release;
  let first = true;
  const sent = [];
  const f = fixture({
    submit: (request) => {
      sent.push(request);
      if (first) {
        first = false;
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        data: { jobId: 'week4-resumed', state: 'ready', format: 'markdown' },
      });
    },
  });
  await f.controller.load();
  const pending = f.controller.requestExport('markdown');
  await Promise.resolve();
  f.controller.suspend();
  const patchCount = f.patches.length;
  release({ ok: true, data: { jobId: 'late-result', state: 'ready', format: 'markdown' } });
  await pending;
  assert.equal(f.patches.length, patchCount);
  const resumed = f.controller.resume();
  assert.equal(resumed.pendingKind, 'export');
  assert.equal(resumed.exportJob, null);
  await f.controller.retry();
  assert.equal(sent[0], sent[1]);
  assert.equal(f.latest().exportJob.jobId, 'week4-resumed');
});

test('W4 L03 dispose ignores a late load response', async () => {
  let release;
  const f = fixture({
    preferences: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = f.controller.load();
  await Promise.resolve();
  f.controller.dispose();
  const patchCount = f.patches.length;
  release({ ok: true, data: { cardTextPreview: true, decorationsEnabled: false } });
  await pending;
  assert.equal(f.patches.length, patchCount);
});

test('the four main tabs include tasks and campus remains a destination page', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.deepEqual(
    app.tabBar.list.map((item) => item.pagePath),
    ['pages/today/index', 'pages/tasks/index', 'pages/universe/index', 'pages/me/index'],
  );
  assert.ok(app.pages.includes('pages/campus/index'));
  const me = read('miniprogram/pages/me/index.js');
  assert.match(me, /navigateOnce\(this, wx, '\/pages\/tasks\/index\?view=history', 'reLaunch'\)/);
  assert.match(me, /if \(!this\.data\.tasksAvailable\)/);
  assert.match(me, /getAccountInfoSync\?\.\(\)/);
});

test('W4 L05 keeps touch targets, wrapping, retry status, and screen-reader labels', () => {
  const style = read('miniprogram/pages/account/index.wxss');
  const source = read('miniprogram/pages/account/index.wxml');
  assert.match(style, /min-height:\s*44px/);
  assert.match(style, /word-break:\s*break-word/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-label="按当前格式申请导出"/);
  assert.match(source, /重试原操作/);
});
