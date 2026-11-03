const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProductionAccountController,
  PENDING_KEY,
} = require('../miniprogram/modules/account/production');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const A = 'scope_' + 'a'.repeat(64),
  B = 'scope_' + 'b'.repeat(64);
const response = (jobId = 'synthetic_close_A') => ({
  ok: true,
  data: {
    accountStatus: 'disabled',
    cleanup: { jobId, state: 'pending' },
    receipt: 'synthetic_receipt_' + jobId,
  },
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture({ state = createSessionState(), storage = new Map(), overrides = {} } = {}) {
  const patches = [],
    sent = [];
  const service = {
    authenticate: async () => true,
    preferences: async () => ({ ok: true, data: { cardTextPreview: false } }),
    createClose: () => createRequest('account.close', { confirm: 'CLOSE' }),
    recoverClose: async (request, scope) => {
      sent.push({ request, scope });
      return response();
    },
    cleanupStatus: async (jobId) => ({ ok: true, data: { jobId, state: 'completed' } }),
    ...overrides,
  };
  const controller = createProductionAccountController({
    service,
    session: state,
    storage: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, val) => storage.set(key, val),
    },
    publish: (patch) => patches.push(patch),
  });
  return { controller, state, storage, service, patches, sent, latest: () => patches.at(-1) };
}
for (const outcome of ['success', 'NETWORK_ERROR', 'FORBIDDEN', 'ACCOUNT_DISABLED']) {
  test(`W4 closure ${outcome} from A cannot clear B binding or display A closure`, async () => {
    const wait = deferred();
    const f = fixture({ overrides: { recoverClose: () => wait.promise } });
    f.state.accept(A);
    await f.controller.load();
    const closing = f.controller.close();
    const saved = f.storage.get(PENDING_KEY);
    const bindingB = f.state.accept(B);
    if (outcome === 'success') {
      wait.resolve(response());
    } else {
      wait.reject(new AppError(outcome, 'SYNTHETIC_A_ERROR'));
    }
    await closing;
    assert.equal(f.state.isCurrent(bindingB), true);
    assert.equal(f.latest().closure, null);
    assert.equal(f.latest().pendingKind, '');
    assert.doesNotMatch(JSON.stringify(f.latest()), /synthetic_close_A|SYNTHETIC_A_ERROR/);
    assert.equal(f.storage.get(PENDING_KEY).request, saved.request);
    await f.controller.load();
    assert.equal(f.latest().authenticated, true);
    assert.equal(f.latest().closure, null);
    f.controller.dispose();
  });
}
test('W4 closure completion does not clear the empty session a second time or cancel a newer login', async () => {
  const wait = deferred();
  const f = fixture({ overrides: { recoverClose: () => wait.promise } });
  f.state.accept(A);
  await f.controller.load();
  const closing = f.controller.close();
  const loginGeneration = f.state.getGeneration();
  wait.resolve(response());
  await closing;
  assert.equal(f.state.getGeneration(), loginGeneration);
  const acceptedB = f.state.accept(B);
  assert.equal(f.state.isCurrent(acceptedB), true);
  assert.equal(f.latest().closure, null);
  f.controller.dispose();
});
test('W4 legacy A closure does not block B, and both original requests survive scoped recovery', async () => {
  const requestA = createRequest('account.close', { confirm: 'CLOSE' });
  const storage = new Map([[PENDING_KEY, { request: requestA, scope: A }]]);
  const state = createSessionState();
  state.accept(B);
  const b = fixture({
    state,
    storage,
    overrides: {
      recoverClose: async (request, scope) => {
        b.sent.push({ request, scope });
        return response('synthetic_close_B');
      },
    },
  });
  await b.controller.load();
  assert.equal(b.latest().authenticated, true);
  assert.equal(b.latest().pendingKind, '');
  assert.equal(b.sent.length, 0);
  await b.controller.close();
  const requestB = b.sent[0].request;
  b.controller.dispose();
  state.accept(A);
  const a = fixture({ state, storage });
  await a.controller.load();
  assert.equal(a.latest().pendingKind, 'close');
  await a.controller.retry();
  assert.equal(a.sent[0].request, requestA);
  assert.equal(a.sent[0].scope, A);
  a.controller.dispose();
  state.accept(B);
  const reopenedB = fixture({ state, storage });
  await reopenedB.controller.load();
  assert.equal(reopenedB.latest().closure.jobId, 'synthetic_close_B');
  await reopenedB.controller.cleanupStatus();
  assert.equal(reopenedB.latest().closure.state, 'completed');
  assert.equal(storage.get(PENDING_KEY).request, requestB);
  reopenedB.controller.dispose();
});
test('W4 hidden closure keeps its original request and ignores a late result until explicit retry', async () => {
  const wait = deferred();
  let first = true;
  const f = fixture({
    overrides: {
      recoverClose: async (request, scope) => {
        f.sent.push({ request, scope });
        if (first) {
          first = false;
          return wait.promise;
        }
        return response();
      },
    },
  });
  f.state.accept(A);
  await f.controller.load();
  const closing = f.controller.close();
  f.controller.suspend();
  const count = f.patches.length;
  wait.resolve(response());
  await closing;
  assert.equal(f.patches.length, count);
  assert.equal(f.controller.resume().pendingKind, 'close');
  await f.controller.retry();
  assert.equal(f.sent[0].request, f.sent[1].request);
  assert.equal(f.latest().closure.jobId, 'synthetic_close_A');
  f.controller.dispose();
});
test('W4 delayed cleanup status from A cannot overwrite B state or the stored B receipt', async () => {
  const wait = deferred();
  const f = fixture({ overrides: { cleanupStatus: () => wait.promise } });
  f.state.accept(A);
  await f.controller.load();
  await f.controller.close();
  const querying = f.controller.cleanupStatus();
  const bindingB = f.state.accept(B);
  const requestB = createRequest('account.close', { confirm: 'CLOSE' });
  f.storage.set(PENDING_KEY, {
    scope: B,
    request: requestB,
    jobId: 'synthetic_close_B',
    receipt: 'synthetic_B',
  });
  wait.resolve({ ok: true, data: { jobId: 'synthetic_close_A', state: 'completed' } });
  await querying;
  assert.equal(f.state.isCurrent(bindingB), true);
  assert.equal(f.latest().closure, null);
  assert.equal(f.storage.get(PENDING_KEY).jobId, 'synthetic_close_B');
  assert.equal(f.storage.get(PENDING_KEY).request, requestB);
  f.controller.dispose();
});

test('W4 returning to A after B does not revive the earlier A preference response', async () => {
  const wait = deferred();
  const f = fixture({ overrides: { preferences: () => wait.promise } });
  f.state.accept(A);
  const loading = f.controller.load();
  await Promise.resolve();
  f.state.accept(B);
  f.state.accept(A);
  wait.resolve({ ok: true, data: { profile: { nickname: 'SYNTHETIC_OLD_A' } } });
  await loading;
  assert.equal(f.latest().authenticated, false);
  assert.deepEqual(f.latest().preferences, {});
  assert.doesNotMatch(JSON.stringify(f.latest()), /SYNTHETIC_OLD_A/);
  f.controller.dispose();
});

test('W4 a late export download from A never writes a file after B signs in', async () => {
  const wait = deferred();
  const written = [];
  const f = fixture({
    overrides: {
      createExport: () => createRequest('account.requestExport', { format: 'json' }),
      submit: async () => ({ ok: true, data: { jobId: 'synthetic_export_A', state: 'ready' } }),
      download: () => wait.promise,
    },
  });
  f.state.accept(A);
  await f.controller.load();
  await f.controller.requestExport('json');
  const downloading = f.controller.download((file) => written.push(file));
  const bindingB = f.state.accept(B);
  wait.resolve({
    ok: true,
    data: { jobId: 'synthetic_export_A', extension: 'json', content: 'SYNTHETIC_PRIVATE_A' },
  });
  await downloading;
  assert.deepEqual(written, []);
  assert.equal(f.state.isCurrent(bindingB), true);
  assert.equal(f.latest().exportJob, null);
  f.controller.dispose();
});

test('W4 expired cleanup receipt recovers with the original close and queries only its refreshed receipt', async () => {
  const queried = [];
  let receiptVersion = 0;
  const f = fixture({
    overrides: {
      recoverClose: async (request, scope) => {
        f.sent.push({ request, scope });
        const result = response();
        result.data.receipt = 'synthetic_receipt_version_' + ++receiptVersion;
        return result;
      },
      cleanupStatus: async (jobId, receipt) => {
        queried.push({ jobId, receipt });
        if (queried.length === 1) {
          throw new AppError('FORBIDDEN', 'SYNTHETIC_EXPIRED');
        }
        return { ok: true, data: { jobId, state: 'completed' } };
      },
    },
  });
  f.state.accept(A);
  await f.controller.load();
  await f.controller.close();
  const generation = f.state.getGeneration();
  await f.controller.cleanupStatus();
  assert.equal(f.sent[0].request, f.sent[1].request);
  assert.equal(f.sent[1].scope, A);
  assert.equal(queried.length, 2);
  assert.notEqual(queried[0].receipt, queried[1].receipt);
  assert.equal(queried[1].receipt, f.storage.get(PENDING_KEY).receipt);
  assert.equal(f.latest().closure.state, 'completed');
  assert.equal(f.state.getGeneration(), generation);
  f.controller.dispose();
});

function pageFixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/account/index.js');
  const local = createRequire(file);
  const state = createSessionState();
  state.accept(A);
  const calls = [];
  let definition, modal;
  const controller = {
    resume: () => {
      calls.push('resume');
      return { authenticated: false };
    },
    load: () => calls.push('load'),
    suspend: () => calls.push('suspend'),
    dispose: () => calls.push('dispose'),
    close: () => calls.push('close'),
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {
      showModal: (value) => {
        modal = value;
      },
    },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { releaseProfile: 'production' };
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: state };
      }
      return local(id);
    },
  });
  const page = { ...definition, data: { authenticated: true }, _controller: controller };
  return { page, state, calls, confirm: () => modal.success({ confirm: true }) };
}

test('W4 cold start restores B before selecting a legacy A closure, while a disabled owner can still recover', async () => {
  const request = createRequest('account.close', { confirm: 'CLOSE' });
  const storage = new Map([
    [PENDING_KEY, { scope: A, request, jobId: 'synthetic_close_A', receipt: 'synthetic_A' }],
  ]);
  const b = fixture({
    storage,
    overrides: {
      authenticate: async () => {
        b.state.accept(B);
        return true;
      },
    },
  });
  await b.controller.load();
  assert.equal(b.latest().authenticated, true);
  assert.equal(b.latest().closure, null);
  assert.equal(b.sent.length, 0);
  b.controller.dispose();
  const a = fixture({ storage, overrides: { authenticate: async () => false } });
  await a.controller.load();
  assert.equal(a.latest().authenticated, false);
  assert.equal(a.latest().closure.jobId, 'synthetic_close_A');
  await a.controller.cleanupStatus();
  assert.equal(a.latest().closure.state, 'completed');
  a.controller.dispose();
});

test('W4 native account page suspends hidden work and reloads a cleared account on return', () => {
  const f = pageFixture();
  f.page.onHide();
  f.page.onShow();
  f.page.onUnload();
  assert.deepEqual(f.calls, ['suspend', 'resume', 'load', 'dispose']);
});

for (const change of ['switch', 'hide', 'unload']) {
  test(`W4 native close confirmation is ignored after ${change}, while a current confirmation works`, () => {
    const f = pageFixture();
    f.page.onClose();
    if (change === 'switch') {
      f.state.accept(B);
      f.state.accept(A);
    } else if (change === 'hide') {
      f.page.onHide();
    } else {
      f.page.onUnload();
    }
    f.confirm();
    assert.equal(f.calls.includes('close'), false);
    const current = pageFixture();
    current.page.onClose();
    current.confirm();
    current.confirm();
    assert.deepEqual(current.calls, ['close']);
  });
}
