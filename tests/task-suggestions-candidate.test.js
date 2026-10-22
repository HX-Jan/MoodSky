const test = require('node:test');
const assert = require('node:assert/strict');
const { createCandidateRouter } = require('../cloudfunctions/moodsky/candidate-router');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { createTaskCatalogueRepository } = require('../tools/week2-integration/task-catalogue');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const { backendClient } = require('./helpers/backend-client');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');

const row = (id = 'synthetic_tpl_01') => ({
  _id: id,
  enabled: true,
  title: '合成测试😀',
  steps: ['步骤一', '步骤二'],
  durationMin: 5,
  tags: ['indoor'],
});
const request = (action, payload = {}) => ({
  apiVersion: '1',
  requestId: 'req_task_public_001',
  action,
  payload,
});
function fixture(rows = [row()]) {
  let reads = 0;
  const router = createCandidateRouter({
    resolveAccount: async () => {
      throw new Error('Public request must not resolve an account');
    },
    taskCatalogueRepository: {
      async listEnabled(options) {
        reads++;
        assert.deepEqual(options, { limit: 3 });
        return rows;
      },
    },
  });
  return { router, reads: () => reads };
}
const code = (response, expected) => {
  assert.equal(response.ok, false);
  assert.equal(response.error.code, expected, JSON.stringify(response));
};

test('public task candidate projects only catalogue content, never identity or stored task state', async () => {
  const source = {
    ...row(),
    ownerId: 'SYNTHETIC_SECRET',
    text: 'SYNTHETIC_SECRET',
    state: 'completed',
  };
  const f = fixture([source]);
  const result = await f.router(request('tasks.suggestions'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [
    {
      taskId: source._id,
      title: source.title,
      description: '步骤一\n步骤二',
      durationMin: 5,
      tags: ['indoor'],
      state: null,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|completed|ownerId/);
  result.data.items[0].tags.push('changed');
  assert.deepEqual(source.tags, ['indoor']);
  assert.equal(f.reads(), 1);
});

test('empty catalogue is a valid empty response; quick choice needs neither account nor catalogue read', async () => {
  const f = fixture([]);
  const choices = await f.router(request('tasks.quickChoice'));
  assert.equal(choices.ok, true);
  assert.deepEqual(choices.data.entries, [{ kind: 'tasks', label: '浏览小任务', enabled: true }]);
  assert.equal(f.reads(), 0);
  assert.deepEqual((await f.router(request('tasks.suggestions'))).data.items, []);
});

test('public task payload whitelist rejects private content, filters, pagination and identity before reading', async () => {
  const f = fixture();
  for (const action of ['tasks.suggestions', 'tasks.quickChoice']) {
    for (const payload of [
      { text: 'private' },
      { tags: ['indoor'] },
      { limit: 99 },
      { cursor: 'x' },
    ]) {
      code(await f.router(request(action, payload)), 'INVALID_INPUT');
    }
    code(await f.router(request(action, { ownerId: 'other' })), 'INVALID_REQUEST');
  }
  assert.equal(f.reads(), 0);
});

test('invalid or disabled templates fail the complete read without fabricated durations or partial success', async () => {
  for (const invalid of [
    null,
    { ...row(), enabled: false },
    { ...row(), _id: '' },
    { ...row(), title: ' ' },
    { ...row(), durationMin: undefined },
    { ...row(), durationMin: '5' },
    { ...row(), durationMin: 0 },
    { ...row(), durationMin: 1.5 },
    { ...row(), durationMin: 1441 },
    { ...row(), steps: [] },
    { ...row(), steps: [''] },
    { ...row(), steps: ['x'.repeat(501)] },
    { ...row(), title: '😀'.repeat(121) },
    { ...row(), tags: ['indoor', 'indoor'] },
    { ...row(), tags: [''] },
    { ...row(), tags: 'indoor' },
  ]) {
    const result = await fixture([row('synthetic_valid'), invalid]).router(
      request('tasks.suggestions'),
    );
    code(result, 'INTERNAL_ERROR');
    assert.equal(result.data, undefined);
  }
});

test('oversized, duplicate or malformed repository results are rejected rather than silently truncated', async () => {
  for (const rows of [
    null,
    {},
    [row(), row()],
    Array.from({ length: 4 }, (_, i) => row('tpl_' + i)),
  ]) {
    code(await fixture(rows).router(request('tasks.suggestions')), 'INTERNAL_ERROR');
  }
});

test('repository exceptions are sanitized, with no demo fallback', async () => {
  const router = createCandidateRouter({
    taskCatalogueRepository: {
      listEnabled: async () => {
        throw new Error('SYNTHETIC_PRIVATE_PLATFORM_ERROR');
      },
    },
  });
  const result = await router(request('tasks.suggestions'));
  code(result, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_PLATFORM_ERROR|task_demo/);
});

test('candidate does not enable private task history or transitions, even for an active account', async () => {
  const router = createCandidateRouter({
    taskCatalogueRepository: { listEnabled: async () => [row()] },
    resolveAccount: async () => ({ id: 'synthetic_account', status: 'active' }),
  });
  for (const action of ['tasks.history', 'tasks.transition']) {
    code(await router(request(action)), 'UNAUTHENTICATED');
    code(await router(request(action), { OPENID: 'synthetic_openid' }), 'NOT_IMPLEMENTED');
  }
});

test('production router and unconfigured candidate keep public task APIs explicitly unimplemented', async () => {
  for (const router of [createRouter(), createCandidateRouter()]) {
    for (const action of ['tasks.suggestions', 'tasks.quickChoice']) {
      code(await router(request(action)), 'NOT_IMPLEMENTED');
    }
  }
});

test('real SDK offline query filters enabled templates, orders deterministically, projects and limits before return', async () => {
  const rows = [row('z'), row('c'), row('b'), { ...row('a'), enabled: false }, row('d')];
  const seed = Object.fromEntries(
    rows.map((item) => ['task_templates:' + item._id, { ...item, secret: 'SYNTHETIC_SECRET' }]),
  );
  await withOfflineWxDatabase(seed, async ({ db, calls, inspect }) => {
    const router = createWeek2Backend({ db, taskSuggestionsEnabled: true });
    const result = await router(request('tasks.suggestions'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      result.data.items.map((item) => item.taskId),
      ['b', 'c', 'd'],
    );
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET/);
    assert.deepEqual(inspect(), seed);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'database.getDocument');
    await assert.rejects(createTaskCatalogueRepository(db).listEnabled({ limit: 100 }), TypeError);
    assert.equal(calls.length, 1);
  });
});

test('week2 assembly defaults closed and ignores truthy nonboolean opt-in flags', async () => {
  await withOfflineWxDatabase({}, async ({ db, calls }) => {
    for (const taskSuggestionsEnabled of [undefined, false, 'true', 1]) {
      code(
        await createWeek2Backend({ db, taskSuggestionsEnabled })(request('tasks.suggestions')),
        'NOT_IMPLEMENTED',
      );
    }
    assert.equal(calls.length, 0);
  });
});

test('SDK offline empty catalogue stays empty and quick choice performs no additional query', async () => {
  await withOfflineWxDatabase({}, async ({ db, calls, inspect }) => {
    const router = createWeek2Backend({ db, taskSuggestionsEnabled: true });
    const result = await router(request('tasks.suggestions'));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.items, []);
    assert.equal((await router(request('tasks.quickChoice'))).ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(inspect(), {});
  });
});

test('SDK offline read failure reaches the actual client as an error without leaking details or modifying storage', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ db, calls, inspect }) => {
      const router = createWeek2Backend({ db, taskSuggestionsEnabled: true });
      const client = backendClient({ router });
      const state = {};
      const controller = createCloudTaskController({
        api: client.tasks,
        publish: (patch) => Object.assign(state, patch),
      });
      await controller.load();
      assert.equal(state.errorCode, 'INTERNAL_ERROR');
      assert.deepEqual(state.suggestions, []);
      assert.equal(state.loading, false);
      assert.match(state.notice, /读取失败/);
      assert.doesNotMatch(JSON.stringify(state), /SYNTHETIC|task_demo/);
      assert.equal(calls.length, 1);
      assert.deepEqual(inspect(), {});
      controller.dispose();
    },
    { fail: () => 'SYNTHETIC_PERMISSION_DENIED' },
  );
});

test('actual client service and controller display candidate suggestions while guest writes remain closed', async () => {
  const f = fixture();
  const client = backendClient({ router: f.router });
  const state = {};
  const controller = createCloudTaskController({
    api: client.tasks,
    publish: (patch) => Object.assign(state, patch),
  });
  await Promise.all([controller.load(), controller.loadChoices()]);
  assert.equal(state.suggestions[0].title, '合成测试😀');
  assert.equal(state.suggestions[0].description, '步骤一\n步骤二');
  assert.equal(state.suggestions[0].state, 'available');
  assert.equal(state.quickEntries[0].kind, 'tasks');
  assert.equal(state.writeBlocked, true);
  await controller.transition('synthetic_tpl_01', 'select');
  assert.equal(state.errorCode, 'NOT_IMPLEMENTED');
  assert.deepEqual(client.requests.map((item) => item.action).sort(), [
    'tasks.quickChoice',
    'tasks.suggestions',
  ]);
  assert.ok(client.requests.every((item) => Object.keys(item.payload).length === 0));
  controller.dispose();
});
