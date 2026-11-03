const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const A = 'scope_' + 'a'.repeat(64),
  B = 'scope_' + 'b'.repeat(64);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = (taskId) => ({ ok: true, data: { taskId, state: 'selected' } });
function fixture() {
  const session = createSessionState();
  session.accept(A);
  const waitA = deferred(),
    waitB = deferred(),
    state = {},
    sent = [];
  const serverStates = { [A]: 'available', [B]: 'available' };
  const taskId = (scope) => (scope === A ? 'synthetic_a' : 'synthetic_b');
  const api = {
    suggestions: async () => ({
      ok: true,
      data: {
        items: [
          {
            taskId: taskId(session.capture().scope),
            title: session.capture().scope === A ? 'SYNTHETIC_PRIVATE_A' : 'SYNTHETIC_PRIVATE_B',
            state: serverStates[session.capture().scope],
            durationMin: 2,
          },
        ],
      },
    }),
    quickChoice: async () => ({ ok: true, data: { entries: [] } }),
    createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
    submit: (request) => {
      const scope = session.capture().scope;
      sent.push({ scope, request });
      return scope === A ? waitA.promise : waitB.promise;
    },
  };
  const controller = createCloudTaskController({
    api,
    session,
    publish: (patch) => Object.assign(state, patch),
  });
  return { controller, api, session, state, sent, serverStates, waitA, waitB };
}

for (const outcome of ['success', 'NETWORK_ERROR', 'ACCOUNT_DISABLED', 'FORBIDDEN']) {
  test(`W4 an old A task ${outcome} cannot block B loading or clear B's new in-flight operation`, async () => {
    const f = fixture();
    let writingA, writingB;
    try {
      await f.controller.load();
      writingA = f.controller.transition('synthetic_a', 'select');
      f.session.clear();
      f.session.accept(B);
      await f.controller.load();
      assert.equal(f.state.suggestions[0]?.taskId, 'synthetic_b');
      writingB = f.controller.transition('synthetic_b', 'select');
      assert.equal(f.sent.length, 2);
      assert.equal(f.state.busy, true);
      if (outcome === 'success') {
        f.waitA.resolve(result('synthetic_a'));
      } else {
        f.waitA.reject(new AppError(outcome, 'SYNTHETIC_OLD_A_ERROR'));
      }
      await writingA;
      assert.equal(f.state.busy, true);
      assert.equal(f.state.suggestions[0].taskId, 'synthetic_b');
      assert.doesNotMatch(JSON.stringify(f.state), /SYNTHETIC_PRIVATE_A|SYNTHETIC_OLD_A_ERROR/);
      assert.equal(f.session.capture().scope, B);
      f.waitB.resolve(result('synthetic_b'));
      await writingB;
      assert.equal(f.state.busy, false);
      assert.equal(f.state.suggestions[0].state, 'selected');
      assert.deepEqual(
        f.sent.map((x) => x.scope),
        [A, B],
      );
    } finally {
      f.waitA.resolve(result('synthetic_a'));
      f.waitB.resolve(result('synthetic_b'));
      await Promise.allSettled([writingA, writingB]);
      f.controller.dispose();
    }
  });
}

test('W4 an unknown A task outcome is not replayed in B, and returning A reads server state', async () => {
  const f = fixture();
  await f.controller.load();
  const writing = f.controller.transition('synthetic_a', 'select');
  f.waitA.reject(new AppError('NETWORK_ERROR', 'synthetic'));
  await writing;
  assert.equal(f.state.retryPending, true);
  const original = f.sent[0].request;
  // Simulate an accepted write whose acknowledgement was lost, without claiming live evidence.
  f.serverStates[A] = 'selected';
  f.session.accept(B);
  await f.controller.retry();
  assert.equal(f.state.suggestions[0]?.taskId, 'synthetic_b');
  assert.equal(f.state.retryPending, false);
  assert.equal(f.sent.length, 1);
  f.session.accept(A);
  await f.controller.load();
  assert.equal(f.state.suggestions[0].state, 'selected');
  assert.equal(f.sent[0].request, original);
  assert.equal(f.sent.length, 1);
  f.controller.dispose();
});

test('W4 same binding still retries the exact unknown request after hide and resume', async () => {
  const f = fixture(),
    sent = [];
  f.api.submit = async (request) => {
    sent.push(request);
    if (sent.length === 1) {
      throw new AppError('NETWORK_ERROR', 'synthetic');
    }
    f.serverStates[A] = 'selected';
    return result('synthetic_a');
  };
  await f.controller.load();
  await f.controller.transition('synthetic_a', 'select');
  f.controller.suspend();
  await f.controller.resume();
  assert.equal(f.state.retryPending, true);
  await f.controller.retry();
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.equal(f.state.suggestions[0].state, 'selected');
  f.controller.dispose();
});

test('W4 actual tasks Page can reconnect B while A write is still pending', async () => {
  const f = fixture();
  f.controller.dispose();
  const file = path.resolve(__dirname, '../miniprogram/pages/tasks/index.js'),
    local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {},
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { cloudEnabled: true, releaseProfile: 'production', trustedSessionEnabled: true };
      }
      if (id.endsWith('/modules/account/cloud-session')) {
        return {
          createCloudSession: () => ({ ...f.session, refresh: async () => true, dispose() {} }),
        };
      }
      if (id.endsWith('/modules/tasks/service')) {
        return { createPrivateTaskService: () => f.api };
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
  let writing;
  try {
    page.onLoad();
    await tick();
    writing = page.onTaskAction({
      currentTarget: { dataset: { taskId: 'synthetic_a', action: 'select' } },
    });
    f.session.accept(B);
    await page.onRetry();
    assert.equal(page.data.suggestions[0]?.taskId, 'synthetic_b');
    f.waitA.resolve(result('synthetic_a'));
    await writing;
    assert.equal(page.data.suggestions[0]?.taskId, 'synthetic_b');
    assert.equal(page.data.writeBlocked, false);
    assert.equal(f.sent.length, 1);
  } finally {
    f.waitA.resolve(result('synthetic_a'));
    await writing;
    page.onUnload();
  }
});
