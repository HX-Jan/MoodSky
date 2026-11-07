const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createLocalStorage } = require('./helpers/local-storage');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { createTaskOutbox } = require('../miniprogram/modules/tasks/outbox');
const { AppError } = require('../miniprogram/shared/result');
const A = 'scope_' + 'a'.repeat(64),
  B = 'scope_' + 'b'.repeat(64);
const env = {
  cloudEnabled: true,
  cloudEnvId: 'synthetic',
  releaseProfile: 'production',
  trustedSessionEnabled: true,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function loadPage(name, wx, overrides) {
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js'),
    local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return env;
      }
      for (const [suffix, value] of Object.entries(overrides)) {
        if (id.endsWith(suffix)) {
          return value;
        }
      }
      return local(id);
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
test('actual tasks Page unload/recreate restores original request without auto submission', async () => {
  const storage = createLocalStorage(),
    session = createSessionState(),
    sent = [];
  session.accept(A);
  let state = 'available',
    unknown = true;
  const api = {
    suggestions: async () => ({
      ok: true,
      data: { items: [{ taskId: 'task_a', title: '合成任务', durationMin: 2, state }] },
    }),
    quickChoice: async () => ({ ok: true, data: { entries: [] } }),
    createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
    async submit(request) {
      sent.push(request);
      state = 'selected';
      if (unknown) {
        throw new AppError('NETWORK_ERROR', 'synthetic');
      }
      return { ok: true, data: { taskId: 'task_a', state, date: request.payload.expectedDate } };
    },
  };
  const create = () =>
    loadPage('tasks', storage, {
      '/modules/account/cloud-session': {
        createCloudSession: () => ({ ...session, refresh: async () => true, dispose() {} }),
      },
      '/modules/tasks/service': { createPrivateTaskService: () => api },
    });
  let page = create();
  page.onLoad();
  await tick();
  await page.onTaskAction({ currentTarget: { dataset: { taskId: 'task_a', action: 'select' } } });
  assert.equal(page.data.retryPending, true);
  const original = sent[0];
  page.onUnload();
  page = create();
  page.onLoad();
  await tick();
  assert.equal(page.data.retryPending, true);
  assert.equal(page.data.suggestions.length, 0);
  assert.equal(sent.length, 1);
  unknown = false;
  await page.onRetry();
  assert.deepEqual(sent[1], original);
  assert.equal(page.data.suggestions[0].state, 'selected');
  assert.equal(createTaskOutbox(storage, env).read(A), null);
  page.onUnload();
});
test('actual account Page purges task outbox only after confirmed closure and only for original scope', async () => {
  const storage = createLocalStorage(),
    session = createSessionState(),
    outbox = createTaskOutbox(storage, env);
  session.accept(A);
  const task = createRequest('tasks.transition', {
    taskId: 'task_a',
    transition: 'select',
    expectedDate: '2026-11-07',
  });
  outbox.save(A, task);
  outbox.save(B, task);
  let confirmed = false;
  const call = async (request) => {
    if (request.action === 'account.preferences') {
      return { ok: true, data: {} };
    }
    if (!confirmed) {
      throw new AppError('NETWORK_ERROR', 'synthetic');
    }
    return {
      ok: true,
      data: {
        accountStatus: 'disabled',
        cleanup: { jobId: 'synthetic_cleanup', state: 'pending' },
        receipt: 'synthetic_receipt',
      },
    };
  };
  const page = loadPage(
    'account',
    { ...storage, showModal: (input) => input.success({ confirm: true }) },
    {
      '/services/session-state': { cloudSessionState: session },
      '/modules/account/cloud-session': { ensureCloudSession: async () => true },
      '/services/api': { createRequest, call, createApiClient: () => ({ call }) },
    },
  );
  page.onLoad();
  await tick();
  page.onClose();
  await tick();
  assert.deepEqual(outbox.read(A), task);
  assert.deepEqual(outbox.read(B), task);
  confirmed = true;
  page.onRetry();
  await tick();
  assert.equal(outbox.read(A), null);
  assert.deepEqual(outbox.read(B), task);
  assert.equal(page.data.authenticated, false);
  page.onUnload();
});
