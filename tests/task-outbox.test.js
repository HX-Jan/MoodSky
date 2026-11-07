const test = require('node:test');
const assert = require('node:assert/strict');
const clone = (value) => JSON.parse(JSON.stringify(value));
const { createTaskOutbox } = require('../miniprogram/modules/tasks/outbox');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { AppError } = require('../miniprogram/shared/result');
const A = 'scope_' + 'a'.repeat(64),
  B = 'scope_' + 'b'.repeat(64);
const env = { cloudEnabled: true, cloudEnvId: 'synthetic', releaseProfile: 'production' };
function memory() {
  const records = new Map();
  return {
    records,
    getStorageSync: (key) => clone(records.get(key) ?? ''),
    setStorageSync: (key, value) => records.set(key, clone(value)),
    removeStorageSync: (key) => records.delete(key),
  };
}
function fixture(storage = memory(), environment = env) {
  const session = createSessionState();
  session.accept(A);
  const sent = [],
    state = {};
  let unknown = true;
  const api = {
    suggestions: async () => ({
      ok: true,
      data: {
        items: [{ taskId: 'task_a', title: '合成任务', durationMin: 2, state: 'available' }],
      },
    }),
    quickChoice: async () => ({ ok: true, data: { entries: [] } }),
    createTransitionRequest: (payload) => createRequest('tasks.transition', payload),
    submit: async (request) => {
      sent.push(request);
      if (unknown) {
        throw new AppError('NETWORK_ERROR', 'synthetic');
      }
      return {
        ok: true,
        data: {
          taskId: request.payload.taskId,
          state: 'selected',
          date: request.payload.expectedDate,
        },
      };
    },
  };
  const outbox = createTaskOutbox(storage, environment);
  const create = () =>
    createCloudTaskController({
      api,
      session,
      pendingStorage: outbox,
      publish: (patch) => Object.assign(state, patch),
    });
  return {
    storage,
    session,
    outbox,
    sent,
    state,
    create,
    confirm: () => {
      unknown = false;
    },
  };
}
test('task restart restores exact frozen request and waits for explicit retry', async () => {
  const f = fixture();
  let controller = f.create();
  await controller.load();
  await controller.transition('task_a', 'select');
  const original = f.sent[0];
  controller.dispose();
  controller = f.create();
  await controller.load();
  assert.equal(f.state.retryPending, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.state.suggestions.length, 0);
  f.confirm();
  await controller.retry();
  assert.deepEqual(f.sent[1], original);
  assert.equal(Object.isFrozen(f.sent[1]), true);
  assert.equal(Object.isFrozen(f.sent[1].payload), true);
  assert.equal(f.outbox.read(A), null);
  assert.equal(f.state.noticeType, 'success');
  controller.dispose();
});
test('task request is isolated by account and deployment and returns only to its original account', async () => {
  const f = fixture(),
    controller = f.create();
  await controller.load();
  await controller.transition('task_a', 'select');
  f.session.accept(B);
  await controller.load();
  assert.equal(f.state.retryPending, false);
  assert.equal(f.sent.length, 1);
  assert.equal(createTaskOutbox(f.storage, { ...env, cloudEnvId: 'other' }).read(A), null);
  f.session.accept(A);
  await controller.load();
  assert.equal(f.state.retryPending, true);
  assert.equal(f.sent.length, 1);
  controller.dispose();
});
test('non-retained or corrupt task storage blocks dispatch without erasing evidence', async () => {
  const f = fixture();
  f.storage.setStorageSync = () => {};
  const controller = f.create();
  await controller.load();
  await controller.transition('task_a', 'select');
  assert.equal(f.sent.length, 0);
  assert.equal(f.state.storageBlocked, true);
  assert.equal(controller.getWorkStatus().pending, true);
  controller.dispose();
  const corrupt = fixture();
  corrupt.outbox.save(
    A,
    createRequest('tasks.transition', {
      taskId: 'task_a',
      transition: 'select',
      expectedDate: '2026-11-07',
    }),
  );
  const key = [...corrupt.storage.records.keys()][0];
  corrupt.storage.records.get(key).request.payload.ownerId = 'forged';
  const next = corrupt.create();
  await next.load();
  await next.retry();
  assert.equal(corrupt.sent.length, 0);
  assert.equal(corrupt.state.storageBlocked, true);
  assert.equal(corrupt.storage.records.has(key), true);
  next.dispose();
});
test('task local cleanup failure preserves unknown request and never reports success', async () => {
  const f = fixture();
  f.confirm();
  const remove = f.storage.removeStorageSync;
  f.storage.removeStorageSync = () => {};
  const controller = f.create();
  await controller.load();
  await controller.transition('task_a', 'select');
  assert.equal(f.state.retryPending, true);
  assert.notEqual(f.state.noticeType, 'success');
  const original = f.sent[0];
  f.storage.removeStorageSync = remove;
  await controller.retry();
  assert.equal(f.sent[1], original);
  assert.equal(f.outbox.read(A), null);
  controller.dispose();
});
test('task outbox rejects invalid protocol and overwrite; closure purges only exact account', () => {
  const storage = memory(),
    outbox = createTaskOutbox(storage, env);
  const request = createRequest('tasks.transition', {
    taskId: 'task_a',
    transition: 'select',
    expectedDate: '2026-11-07',
  });
  outbox.save(A, request);
  outbox.save(B, request);
  assert.throws(() =>
    outbox.save(
      A,
      createRequest('tasks.transition', {
        taskId: 'other',
        transition: 'select',
        expectedDate: '2026-11-07',
      }),
    ),
  );
  for (const payload of [
    { taskId: 'a', transition: 'arrive' },
    { taskId: 'a', transition: 'select', ownerId: 'forged' },
    { taskId: 'a', transition: 'select', replacementTaskId: 'b' },
  ]) {
    assert.throws(() => outbox.save(B, createRequest('tasks.transition', payload)));
  }
  outbox.purge(A);
  assert.equal(outbox.read(A), null);
  assert.deepEqual(outbox.read(B), request);
});

test('legacy undated or invalid-date durable requests remain blocked without dispatch or silent date migration', async () => {
  for (const expectedDate of [undefined, '2026-02-30']) {
    const f = fixture();
    f.outbox.save(
      A,
      createRequest('tasks.transition', {
        taskId: 'task_a',
        transition: 'select',
        expectedDate: '2026-11-06',
      }),
    );
    const record = [...f.storage.records.values()][0];
    if (expectedDate === undefined) {
      delete record.request.payload.expectedDate;
    } else {
      record.request.payload.expectedDate = expectedDate;
    }
    const before = clone([...f.storage.records.entries()]);
    const controller = f.create();
    await controller.load();
    await controller.retry();
    assert.equal(f.state.storageBlocked, true);
    assert.equal(f.sent.length, 0);
    assert.deepEqual([...f.storage.records.entries()], before);
    controller.dispose();
  }
});
