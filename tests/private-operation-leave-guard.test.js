const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { AppError } = require('../miniprogram/shared/result');
const { createLocalStorage } = require('./helpers/local-storage');
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t, name, older = false) {
  const session = createSessionState();
  session.accept('scope_' + 'a'.repeat(64));
  const enabled = [],
    disabled = [],
    sent = [];
  let fail = true,
    taskState = 'available';
  const platform = {
    ...createLocalStorage(),
    ...(older
      ? {}
      : {
          enableAlertBeforeUnload: (input) => enabled.push(input),
          disableAlertBeforeUnload: (input) => disabled.push(input),
        }),
  };
  async function submit(input) {
    sent.push(input);
    if (fail) {
      throw new AppError('NETWORK_ERROR', '合成未知结果');
    }
    taskState = 'selected';
    return name === 'tasks'
      ? {
          ok: true,
          data: { taskId: 'synthetic_task', state: taskState, date: input.payload.expectedDate },
        }
      : { ok: true, data: { cardTextPreview: true, decorationsEnabled: true } };
  }
  const taskApi = {
    suggestions: async () => ({
      ok: true,
      data: {
        items: [
          {
            taskId: 'synthetic_task',
            title: '合成任务',
            durationMin: 2,
            state: taskState,
          },
        ],
      },
    }),
    quickChoice: async () => ({ ok: true, data: { entries: [] } }),
    createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
    submit,
  };
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: platform,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {
          releaseProfile: 'production',
          cloudEnabled: true,
          cloudEnvId: 'synthetic',
          trustedSessionEnabled: true,
        };
      }
      if (id.endsWith('/system/capabilities')) {
        return {
          clientCapabilities: () => ({
            accountData: { state: 'available' },
            tasks: { state: 'available' },
          }),
        };
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: session };
      }
      if (id.endsWith('/account/cloud-session')) {
        return {
          ensureCloudSession: async () => true,
          createCloudSession: () => ({
            ...session,
            refresh: async () => true,
            getErrorCode: () => '',
            dispose() {},
          }),
        };
      }
      if (id.endsWith('/services/api')) {
        return {
          createRequest,
          call: (input) =>
            input.payload.operation === 'get'
              ? Promise.resolve({
                  ok: true,
                  data: { cardTextPreview: false, decorationsEnabled: true },
                })
              : submit(input),
        };
      }
      if (id.endsWith('/tasks/service')) {
        return { createPrivateTaskService: () => taskApi };
      }
      if (id.endsWith('/tasks/cloud')) {
        return {
          createCloudTaskController: (options) =>
            createCloudTaskController({
              ...options,
              now: () => new Date('2026-11-04T04:00:00.000Z'),
            }),
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
  t.after(() => page.onUnload());
  page.onLoad();
  page.onShow();
  await tick();
  const write = async () => {
    if (name === 'tasks') {
      await page.onTaskAction({
        currentTarget: { dataset: { taskId: 'synthetic_task', action: 'select' } },
      });
    } else {
      page.onPreference({
        currentTarget: { dataset: { key: 'cardTextPreview' } },
        detail: { value: true },
      });
    }
    await tick();
  };
  return {
    page,
    enabled,
    disabled,
    sent,
    write,
    recover: () => {
      fail = false;
    },
  };
}

for (const name of ['account', 'tasks']) {
  test(`${name}: only writes register a native leave warning, and original retry clears it`, async (t) => {
    const f = await fixture(t, name);
    assert.equal(f.enabled.length, 0); // Initial read does not need a discard warning.
    await f.write();
    assert.equal(f.sent.length, 1);
    assert.equal(f.enabled.length, 1);
    assert.match(f.enabled[0].message, /操作.*离开/);
    assert.doesNotMatch(f.enabled[0].message, /scope_|synthetic_task|cardTextPreview/);
    f.enabled[0].success();
    assert.equal(f.page._leaveGuardReady, true);
    f.recover();
    await f.page.onRetry();
    await tick();
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent[1], f.sent[0]);
    assert.equal(f.disabled.length, 1);
    f.disabled[0].success();
    assert.equal(f.page._leaveGuardReady, false);
  });

  test(`${name}: hide suppresses native calls, show resyncs, unload cancels late warning callbacks`, async (t) => {
    const f = await fixture(t, name);
    await f.write();
    assert.equal(f.enabled.length, 1);
    f.page.onHide();
    assert.equal(f.enabled.length, 1);
    assert.equal(f.disabled.length, 0);
    f.page.onShow();
    await tick();
    assert.equal(f.enabled.length, 2);
    f.enabled[0].success();
    assert.equal(f.page._leaveGuardReady, false);
    f.enabled[1].success();
    f.page.onUnload();
    assert.equal(f.disabled.length, 1);
    f.disabled[0].success();
    f.enabled[1].success();
    assert.equal(f.page._leaveGuardReady, false);
    assert.equal(f.sent.length, 1);
  });
}

test('missing native leave APIs retain the existing account retry notice and a working original retry', async (t) => {
  const f = await fixture(t, 'account', true);
  await f.write();
  assert.equal(f.page.data.pendingKind, 'preferences');
  assert.ok(f.page.data.notice);
  assert.equal(f.page._leaveGuardReady, false);
  f.recover();
  await f.page.onRetry();
  await tick();
  assert.equal(f.sent[1], f.sent[0]);
  assert.equal(f.page.data.pendingKind, '');
});
