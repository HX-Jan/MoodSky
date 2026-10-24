// W2 JF02 — tasks.transition state machine, idempotency and local concurrency.
// Owner: Jiawei Fang. Local doubles only: no cloud function, database or network
// call is made in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const tasksModule = require('../cloudfunctions/moodsky/domains/tasks');
const { createTasksDomain } = tasksModule;
const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');

const OWNER = 'account_alpha';
const TOP = 'tpl_walk_10min';
const SECOND = 'tpl_water';
const THIRD = 'tpl_breathe';
const DISABLED = 'tpl_disabled';
const DAY_ONE = '2026-10-20T04:00:00.000Z'; // 2026-10-20 12:00 Asia/Shanghai
const DAY_TWO = '2026-10-21T04:00:00.000Z';

const TEMPLATES = [
  {
    _id: TOP,
    title: '在安全开放区域走 10 分钟',
    steps: ['找一个安全开放的区域', '慢慢走 10 分钟'],
    durationMin: 10,
    tags: ['outdoor'],
    enabled: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    _id: SECOND,
    title: '喝一杯水',
    steps: ['倒一杯温水', '慢慢喝完'],
    durationMin: 2,
    tags: ['indoor'],
    enabled: true,
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  {
    _id: THIRD,
    title: '做三次慢呼吸',
    steps: ['坐稳', '做三次慢呼吸'],
    durationMin: 3,
    tags: ['indoor'],
    enabled: true,
    createdAt: '2026-10-03T00:00:00.000Z',
  },
  {
    _id: DISABLED,
    title: '已停用模板',
    steps: ['不应出现'],
    durationMin: 5,
    tags: [],
    enabled: false,
    createdAt: '2026-10-04T00:00:00.000Z',
  },
];

function createWorld({
  templates = TEMPLATES,
  account = { id: OWNER, status: 'active' },
  start = new Date(DAY_ONE),
} = {}) {
  const state = { now: start };
  const store = createMemoryTasksStore({ templates });
  const domain = createTasksDomain({ store, clock: () => state.now });
  let serial = 0;
  const router = createRouter({ resolveAccount: async () => account }, { tasks: domain });
  return {
    store,
    setNow(value) {
      state.now = value;
    },
    history: () => store.snapshot().history,
    receipts: () => store.snapshot().receipts,
    call(action, payload = {}, options = {}) {
      serial += 1;
      const requestId = options.requestId || 'req_w2tran_' + String(serial).padStart(4, '0');
      return router(
        { apiVersion: '1', requestId, action, payload },
        options.context || { OPENID: 'trusted_openid_alpha' },
      );
    },
  };
}

async function run(world, payload, requestId) {
  return world.call('tasks.transition', payload, requestId ? { requestId } : {});
}
function rowsOf(world, taskId) {
  return world.history().filter((row) => row.taskId === taskId);
}

test('T01 a select without any record creates a selected row for the server date', async () => {
  const world = createWorld();
  const result = await run(world, { taskId: TOP, transition: 'select' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    taskId: TOP,
    date: '2026-10-20',
    state: 'selected',
    replayed: false,
  });
  const rows = rowsOf(world, TOP);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ownerId, OWNER);
  assert.equal(rows[0].date, '2026-10-20');
  assert.equal(rows[0].state, 'selected');
  assert.equal(rows[0].createdAt, DAY_ONE);
});

test('T02 complete from selected updates the single daily row and keeps createdAt', async () => {
  const world = createWorld();
  await run(world, { taskId: TOP, transition: 'select' });
  world.setNow(new Date('2026-10-20T05:00:00.000Z'));
  const result = await run(world, { taskId: TOP, transition: 'complete' });
  assert.equal(result.ok, true);
  assert.equal(result.data.state, 'completed');
  const rows = rowsOf(world, TOP);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'completed');
  assert.equal(rows[0].createdAt, DAY_ONE);
});

test('T03 skip is allowed from selected and from a missing record', async () => {
  const world = createWorld();
  const direct = await run(world, { taskId: SECOND, transition: 'skip' });
  assert.equal(direct.data.state, 'skipped');

  await run(world, { taskId: TOP, transition: 'select' });
  const fromSelected = await run(world, { taskId: TOP, transition: 'skip' });
  assert.equal(fromSelected.data.state, 'skipped');
  assert.equal(world.history().length, 2);
});

test('T04 replace from selected replaces the current template and selects a new one', async () => {
  const world = createWorld();
  await run(world, { taskId: TOP, transition: 'select' });
  const result = await run(world, {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: SECOND,
  });
  assert.deepEqual(result.data, {
    taskId: TOP,
    date: '2026-10-20',
    state: 'replaced',
    replacementTaskId: SECOND,
    replacementState: 'selected',
    replayed: false,
  });
  assert.equal(rowsOf(world, TOP)[0].state, 'replaced');
  assert.equal(rowsOf(world, SECOND)[0].state, 'selected');
  assert.equal(world.history().length, 2);
});

test('T05 replace from a missing record also works and auto-picks when unspecified', async () => {
  const world = createWorld();
  const result = await run(world, { taskId: TOP, transition: 'replace' });
  assert.equal(result.data.state, 'replaced');
  assert.equal(result.data.replacementTaskId, SECOND);
  assert.equal(rowsOf(world, SECOND)[0].state, 'selected');
});

test('T06 auto-pick skips templates that already have a record today', async () => {
  const world = createWorld();
  await run(world, { taskId: SECOND, transition: 'complete' });
  const result = await run(world, { taskId: TOP, transition: 'replace' });
  assert.equal(result.data.replacementTaskId, THIRD);
});

test('T07 replace without any available replacement is a conflict', async () => {
  const world = createWorld({ templates: [TEMPLATES[0]] });
  const result = await run(world, { taskId: TOP, transition: 'replace' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(world.history().length, 0);
});

test('T08 repeating the same terminal transition under a new requestId replays it', async () => {
  const world = createWorld();
  await run(world, { taskId: TOP, transition: 'complete' });
  const replay = await run(world, { taskId: TOP, transition: 'complete' });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.state, 'completed');
  assert.equal(replay.data.replayed, true);
  assert.equal(world.history().length, 1);
});

test('T09 a terminal state refuses every other terminal target', async () => {
  for (const [first, secondAction] of [
    ['complete', 'skip'],
    ['complete', 'select'],
    ['complete', 'replace'],
    ['skip', 'complete'],
    ['replace', 'complete'],
  ]) {
    const world = createWorld();
    const firstResult = await run(world, {
      taskId: TOP,
      transition: first,
      replacementTaskId: first === 'replace' ? SECOND : undefined,
    });
    assert.equal(firstResult.ok, true, first);
    const result = await run(world, { taskId: TOP, transition: secondAction });
    assert.equal(result.ok, false, first + ' then ' + secondAction);
    assert.equal(result.error.code, 'CONFLICT', first + ' then ' + secondAction);
    assert.equal(rowsOf(world, TOP).length, 1);
  }
});

test('T10 invalid payloads are rejected without touching task history', async () => {
  const world = createWorld();
  const cases = [
    [{ taskId: 'tpl_missing', transition: 'select' }, 'INVALID_INPUT'],
    [{ taskId: DISABLED, transition: 'select' }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'archive' }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'select', photo: 'synthetic.jpg' }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'select', photos: ['a.jpg'] }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'select', location: { lat: 0, lng: 0 } }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'select', evidence: 'proof' }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'select', date: '2026-10-20' }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'complete', replacementTaskId: SECOND }, 'INVALID_INPUT'],
    [{ taskId: TOP, transition: 'replace', replacementTaskId: TOP }, 'INVALID_INPUT'],
    [{ taskId: '', transition: 'select' }, 'INVALID_INPUT'],
    [{ transition: 'select' }, 'INVALID_INPUT'],
    [{}, 'INVALID_INPUT'],
    [null, 'INVALID_REQUEST'],
    [[], 'INVALID_REQUEST'],
  ];
  for (const [payload, code] of cases) {
    const result = await world.call('tasks.transition', payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.equal(result.error.code, code, JSON.stringify(payload));
  }
  assert.equal(world.history().length, 0);
});

test('T11 one requestId replays its stored result and cannot be reused for another action', async () => {
  const world = createWorld();
  const requestId = 'req_w2tran_idem_0001';
  const first = await run(world, { taskId: TOP, transition: 'complete' }, requestId);
  assert.equal(first.data.replayed, false);
  assert.equal(first.data.state, 'completed');

  const replay = await run(world, { taskId: TOP, transition: 'complete' }, requestId);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, { ...first.data, replayed: true });
  assert.equal(world.history().length, 1);

  const reused = await run(world, { taskId: TOP, transition: 'skip' }, requestId);
  assert.equal(reused.ok, false);
  assert.equal(reused.error.code, 'CONFLICT');
  assert.equal(world.history().length, 1);
  assert.equal(world.receipts().length, 1);
});

test('T12 payload identity fields are rejected by the router before the domain runs', async () => {
  const world = createWorld();
  for (const field of ['ownerId', 'owner', 'openid', 'OPENID', 'role', 'roles', 'accountId']) {
    const result = await world.call('tasks.transition', {
      taskId: TOP,
      transition: 'select',
      [field]: 'someone_else',
    });
    assert.equal(result.error.code, 'INVALID_REQUEST', field);
  }
  assert.equal(world.history().length, 0);
});

test('T13 missing trusted identity is rejected before any store access', async () => {
  const world = createWorld();
  const result = await world.call(
    'tasks.transition',
    { taskId: TOP, transition: 'select' },
    { context: {} },
  );
  assert.equal(result.error.code, 'UNAUTHENTICATED');
  assert.equal(world.history().length, 0);
});

test('T14 a disabled account is refused by the router with ACCOUNT_DISABLED', async () => {
  const world = createWorld({ account: { id: OWNER, status: 'disabled' } });
  const result = await run(world, { taskId: TOP, transition: 'select' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
  assert.equal(world.history().length, 0);
});

test('T15 the date comes from the injected clock in Asia/Shanghai, never from the payload', async () => {
  const world = createWorld({ start: new Date('2026-10-20T17:30:00.000Z') });
  const result = await run(world, { taskId: TOP, transition: 'select' });
  assert.equal(result.data.date, '2026-10-21');
  assert.equal(rowsOf(world, TOP)[0].date, '2026-10-21');
});

test('T16 concurrent completes under different requestIds leave exactly one daily row', async () => {
  const world = createWorld();
  const calls = Array.from({ length: 5 }, (_, index) =>
    run(world, { taskId: TOP, transition: 'complete' }, 'req_w2tran_conc_' + index),
  );
  const results = await Promise.all(calls);
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.equal(result.data.state, 'completed');
  }
  assert.equal(results.filter((result) => result.data.replayed === false).length, 1);
  assert.equal(world.history().length, 1);
  assert.equal(rowsOf(world, TOP)[0].state, 'completed');
});

test('T17 task state resets on a new business day instead of carrying a terminal state', async () => {
  const world = createWorld();
  await run(world, { taskId: TOP, transition: 'complete' });
  world.setNow(new Date(DAY_TWO));
  const result = await run(world, { taskId: TOP, transition: 'select' });
  assert.equal(result.ok, true);
  assert.equal(result.data.date, '2026-10-21');
  assert.equal(result.data.state, 'selected');
  const rows = rowsOf(world, TOP);
  assert.deepEqual(
    rows.map((row) => [row.date, row.state]),
    [
      ['2026-10-20', 'completed'],
      ['2026-10-21', 'selected'],
    ],
  );
});

test('T18 an explicit replacement that already has a record today is a conflict', async () => {
  const world = createWorld();
  await run(world, { taskId: SECOND, transition: 'complete' });
  const result = await run(world, {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: SECOND,
  });
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(world.history().length, 1);
});

test('T19 an unknown or disabled replacement is an invalid input', async () => {
  for (const replacementTaskId of ['tpl_missing', DISABLED]) {
    const world = createWorld();
    const result = await run(world, { taskId: TOP, transition: 'replace', replacementTaskId });
    assert.equal(result.error.code, 'INVALID_INPUT', replacementTaskId);
    assert.equal(world.history().length, 0);
  }
});

test('T20 the unwired handle still answers NOT_IMPLEMENTED', async () => {
  await assert.rejects(
    () => tasksModule.handle({ action: 'tasks.transition', payload: {} }),
    (error) => error.code === 'NOT_IMPLEMENTED',
  );
  assert.equal(typeof createTasksDomain, 'function');
});

test('T21 a replayed replace keeps the first response shape, including the target', async () => {
  const world = createWorld();
  const first = await run(world, { taskId: TOP, transition: 'replace', replacementTaskId: SECOND });
  assert.equal(first.data.replacementTaskId, SECOND);

  const sameTarget = await run(world, {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: SECOND,
  });
  assert.equal(sameTarget.ok, true);
  assert.equal(sameTarget.data.replayed, true);
  assert.equal(sameTarget.data.state, 'replaced');
  assert.ok(Object.prototype.hasOwnProperty.call(sameTarget.data, 'replacementTaskId'));
  assert.equal(sameTarget.data.replacementTaskId, SECOND);
  assert.equal(sameTarget.data.replacementState, 'selected');

  // A replay naming another target still answers with the target actually stored
  // for the day; the payload value is never echoed back as if it had been applied.
  const otherTarget = await run(world, {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: THIRD,
  });
  assert.equal(otherTarget.ok, true);
  assert.equal(otherTarget.data.replayed, true);
  assert.equal(otherTarget.data.replacementTaskId, SECOND);
  assert.notEqual(otherTarget.data.replacementTaskId, THIRD);
  assert.equal(world.history().length, 2);
  assert.equal(rowsOf(world, SECOND)[0].state, 'selected');
});

test('T22 a replace replay that cannot identify its target reports null, never a guess', async () => {
  const world = createWorld();
  await run(world, { taskId: TOP, transition: 'replace', replacementTaskId: SECOND });
  // A second task is selected the same day, so the day no longer names one target.
  await run(world, { taskId: THIRD, transition: 'select' });
  const replay = await run(world, {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: SECOND,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.ok(Object.prototype.hasOwnProperty.call(replay.data, 'replacementTaskId'));
  assert.equal(replay.data.replacementTaskId, null);
  assert.equal(replay.data.replacementState, null);
  assert.equal(world.history().length, 3);
});
