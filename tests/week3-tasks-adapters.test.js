// W3 JF02 — tasks adapter seam: public/private split, idempotency, client history
// shape. Owner: Jiawei Fang. Local doubles only: no cloud function, database or
// network call is made in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTasksAdapters,
  PUBLIC_ACTIONS,
  PRIVATE_ACTIONS,
} = require('../cloudfunctions/moodsky/services/tasks-adapters');
const { createTasksDomain } = require('../cloudfunctions/moodsky/services/tasks-candidate');
const {
  createTaskSuggestionsService,
} = require('../cloudfunctions/moodsky/services/task-suggestions');
const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');
const { createRouter } = require('../cloudfunctions/moodsky/router');

const OWNER = 'account_alpha';
const OTHER = 'account_beta';
const TOP = 'tpl_walk_10min';
const SECOND = 'tpl_water';
const THIRD = 'tpl_breathe';
const DAY_ONE = '2026-10-20T04:00:00.000Z'; // 2026-10-20 12:00 Asia/Shanghai
const DAY_TWO = '2026-10-21T04:00:00.000Z';
const RANGE = { from: '2026-09-20', to: '2026-10-20' };

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
];

// Any private read on the public path throws instead of returning data, so a
// leak fails the test instead of merely changing a number.
function forbiddenStore(calls) {
  const stop = () => {
    calls.push('private-store');
    throw new Error('PRIVATE_STORE_ACCESS');
  };
  return {
    withOwnerLock: stop,
    listTemplates: stop,
    getStatesForDate: stop,
    listHistory: stop,
    getReceipt: stop,
    commitTransition: stop,
  };
}

function publicSuggestionsOf(rows, calls = []) {
  return createTaskSuggestionsService({
    repository: {
      async listEnabled({ limit }) {
        calls.push('public-catalogue');
        return rows.slice(0, limit);
      },
    },
  });
}

function historyRow(index, ownerId = OWNER, prefix = 'tpl_seed') {
  return {
    _id: 'hist_' + prefix + '_' + String(index).padStart(2, '0'),
    ownerId,
    taskId: prefix + '_' + String(index).padStart(2, '0'),
    date: '2026-10-10',
    state: 'completed',
    createdAt: '2026-10-10T00:' + String(index).padStart(2, '0') + ':00.000Z',
  };
}

function createPrivateWorld({
  templates = TEMPLATES,
  history = [],
  account = { id: OWNER, status: 'active' },
  start = new Date(DAY_ONE),
} = {}) {
  const state = { now: start };
  const store = createMemoryTasksStore({ templates, history });
  const domain = createTasksDomain({ store, clock: () => state.now });
  const calls = [];
  const adapters = createTasksAdapters({
    tasksDomain: domain,
    publicSuggestions: publicSuggestionsOf(TEMPLATES, calls),
    clock: () => state.now,
  });
  let serial = 0;
  const router = createRouter({
    resolveAccount: async () => account,
    domainHandlers: { tasks: adapters.handle },
  });
  return {
    store,
    calls,
    setNow(value) {
      state.now = value;
    },
    historyRows: () => store.snapshot().history,
    receipts: () => store.snapshot().receipts,
    call(action, payload = {}, options = {}) {
      serial += 1;
      const requestId = options.requestId || 'req_w3adp_' + String(serial).padStart(4, '0');
      return router(
        { apiVersion: '1', requestId, action, payload },
        options.context || { OPENID: 'trusted_openid_alpha' },
      );
    },
  };
}

test('P01 public suggestions are answered from the read-only service with no private read', async () => {
  const calls = [];
  const adapters = createTasksAdapters({
    tasksDomain: createTasksDomain({ store: forbiddenStore(calls) }),
    publicSuggestions: publicSuggestionsOf(TEMPLATES, calls),
  });
  const data = await adapters.handle({ action: 'tasks.suggestions', payload: {} });
  assert.equal(data.readOnly, true);
  assert.deepEqual(
    data.items.map((item) => item.taskId),
    [TOP, SECOND, THIRD],
  );
  assert.equal(Object.hasOwn(data.items[0], 'state'), true);
  assert.equal(data.items[0].state, null);
  assert.deepEqual(calls, ['public-catalogue']);
});

test('P02 quickChoice keeps the public entry point and fabricates no private task state', async () => {
  const calls = [];
  const adapters = createTasksAdapters({
    tasksDomain: createTasksDomain({ store: forbiddenStore(calls) }),
    publicSuggestions: publicSuggestionsOf(TEMPLATES, calls),
  });
  const data = await adapters.handle({ action: 'tasks.quickChoice', payload: {} });
  assert.deepEqual(data.entries, [{ kind: 'tasks', label: '浏览小任务', enabled: true }]);
  assert.match(data.notice, /任务操作/);
  assert.equal(Object.hasOwn(data, 'suggestions'), false);
  // The bounded public service answers quickChoice without listing the catalogue.
  assert.deepEqual(calls, []);
});

test('P03 an empty public catalogue is an empty state, not a synthesized task', async () => {
  const adapters = createTasksAdapters({ publicSuggestions: publicSuggestionsOf([]) });
  const data = await adapters.handle({ action: 'tasks.suggestions', payload: {} });
  assert.deepEqual(data.items, []);
  assert.equal(data.readOnly, true);
});

test('P04 the public path never receives an actor and still filters private payload', async () => {
  const seen = [];
  let attempts = 0;
  const adapters = createTasksAdapters({
    publicSuggestions: async (request) => {
      attempts += 1;
      if (Object.keys(request.payload).length > 0) {
        const error = new Error('private payload');
        error.code = 'INVALID_INPUT';
        throw error;
      }
      seen.push(request);
      return { items: [], readOnly: true, notice: 'synthetic' };
    },
  });
  const data = await adapters.handle({
    action: 'tasks.suggestions',
    payload: {},
    actor: { accountId: OTHER },
  });
  assert.equal(data.readOnly, true);
  assert.deepEqual(seen, [{ action: 'tasks.suggestions', payload: {} }]);
  assert.equal(attempts, 1);
  await assert.rejects(
    adapters.handle({ action: 'tasks.suggestions', payload: { query: 'x' } }),
    (error) => error.code === 'INVALID_INPUT',
  );
  assert.equal(attempts, 2);
  assert.deepEqual(seen, [{ action: 'tasks.suggestions', payload: {} }]);
});

test('P05 a missing public read service answers NOT_IMPLEMENTED instead of fake items', async () => {
  const calls = [];
  const adapters = createTasksAdapters({
    tasksDomain: createTasksDomain({ store: forbiddenStore(calls) }),
  });
  for (const action of PUBLIC_ACTIONS) {
    await assert.rejects(
      adapters.handle({ action, payload: {} }),
      (error) => error.code === 'NOT_IMPLEMENTED',
    );
  }
  assert.deepEqual(calls, []);
});

test('P06 private actions without a wired domain answer NOT_IMPLEMENTED', async () => {
  const adapters = createTasksAdapters({ publicSuggestions: publicSuggestionsOf(TEMPLATES) });
  await assert.rejects(
    adapters.handle({
      action: 'tasks.transition',
      payload: { taskId: TOP, transition: 'select' },
      requestId: 'req_w3adp_missing_01',
      actor: { accountId: OWNER },
    }),
    (error) => error.code === 'NOT_IMPLEMENTED',
  );
  await assert.rejects(
    adapters.handle({
      action: 'tasks.history',
      payload: RANGE,
      actor: { accountId: OWNER },
    }),
    (error) => error.code === 'NOT_IMPLEMENTED',
  );
});

test('P07 actions outside the seam stay NOT_IMPLEMENTED even on a fully wired adapter', async () => {
  const calls = [];
  const adapters = createTasksAdapters({
    tasksDomain: createTasksDomain({ store: forbiddenStore(calls) }),
    publicSuggestions: publicSuggestionsOf(TEMPLATES, calls),
  });
  for (const action of ['tasks.mine', 'account.preferences', 'tasks.unknown']) {
    await assert.rejects(
      adapters.handle({ action, payload: {}, actor: { accountId: OWNER } }),
      (error) => error.code === 'NOT_IMPLEMENTED',
    );
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(
    [...PUBLIC_ACTIONS, ...PRIVATE_ACTIONS],
    ['tasks.suggestions', 'tasks.quickChoice', 'tasks.transition', 'tasks.history'],
  );
});

test('P08 private actions require an active account before any task row is written', async () => {
  const world = createPrivateWorld();
  const anonymous = await world.call(
    'tasks.transition',
    { taskId: TOP, transition: 'select' },
    { context: {} },
  );
  assert.equal(anonymous.error.code, 'UNAUTHENTICATED');
  const disabled = await createPrivateWorld({
    account: { id: OWNER, status: 'disabled' },
  }).call('tasks.transition', { taskId: TOP, transition: 'select' });
  assert.equal(disabled.error.code, 'ACCOUNT_DISABLED');
  assert.equal(world.historyRows().length, 0);
});

test('P09 the same requestId replays the stored transition instead of writing twice', async () => {
  const world = createPrivateWorld();
  const requestId = 'req_w3adp_idem_0001';
  const first = await world.call(
    'tasks.transition',
    { taskId: TOP, transition: 'complete' },
    { requestId },
  );
  assert.equal(first.ok, true);
  assert.equal(first.data.replayed, false);
  const replay = await world.call(
    'tasks.transition',
    { taskId: TOP, transition: 'complete' },
    { requestId },
  );
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, { ...first.data, replayed: true });
  assert.equal(world.historyRows().length, 1);
  assert.equal(world.receipts().length, 1);
});

test('P10 one requestId with a different payload is a CONFLICT and writes nothing new', async () => {
  const world = createPrivateWorld();
  const requestId = 'req_w3adp_conflict_01';
  await world.call('tasks.transition', { taskId: TOP, transition: 'select' }, { requestId });
  const reused = await world.call(
    'tasks.transition',
    { taskId: TOP, transition: 'skip' },
    { requestId },
  );
  assert.equal(reused.error.code, 'CONFLICT');
  assert.equal(world.historyRows().length, 1);
  assert.equal(world.historyRows()[0].state, 'selected');
});

test('P11 a terminal task refuses every other target through the adapter', async () => {
  for (const [first, secondAction] of [
    ['complete', 'skip'],
    ['complete', 'select'],
    ['skip', 'complete'],
    ['replace', 'complete'],
  ]) {
    const world = createPrivateWorld();
    const started = await world.call('tasks.transition', {
      taskId: TOP,
      transition: first,
      ...(first === 'replace' ? { replacementTaskId: SECOND } : {}),
    });
    assert.equal(started.ok, true, first);
    const refused = await world.call('tasks.transition', { taskId: TOP, transition: secondAction });
    assert.equal(refused.error.code, 'CONFLICT', first + ' then ' + secondAction);
    assert.equal(
      world.historyRows().filter((row) => row.taskId === TOP).length,
      1,
      first + ' then ' + secondAction,
    );
  }
});

test('P12 a new business day resets the task state instead of carrying the terminal value', async () => {
  const world = createPrivateWorld();
  await world.call('tasks.transition', { taskId: TOP, transition: 'complete' });
  world.setNow(new Date(DAY_TWO));
  const reselect = await world.call('tasks.transition', { taskId: TOP, transition: 'select' });
  assert.equal(reselect.ok, true);
  assert.equal(reselect.data.date, '2026-10-21');
  assert.equal(reselect.data.state, 'selected');
  assert.deepEqual(
    world
      .historyRows()
      .filter((row) => row.taskId === TOP)
      .map((row) => [row.date, row.state]),
    [
      ['2026-10-20', 'completed'],
      ['2026-10-21', 'selected'],
    ],
  );
});

test('P13 history returns only the caller rows in the client items shape', async () => {
  const world = createPrivateWorld({
    history: [
      historyRow(1),
      historyRow(2),
      historyRow(3, OWNER, 'tpl_own'),
      ...['a', 'b'].map((suffix, index) => historyRow(index, OTHER, 'tpl_other' + suffix)),
    ],
  });
  const result = await world.call('tasks.history', RANGE);
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.data, 'entries'), false);
  assert.equal(result.data.items.length, 3);
  for (const item of result.data.items) {
    assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'date', 'state', 'taskId']);
  }
  assert.doesNotMatch(JSON.stringify(result.data), new RegExp(OTHER));
  assert.doesNotMatch(JSON.stringify(result.data), /ownerId/);
});

test('P14 history items walk every own row exactly once through nextCursor', async () => {
  const world = createPrivateWorld({
    history: Array.from({ length: 5 }, (_, index) => historyRow(index)),
  });
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const result = await world.call('tasks.history', { ...RANGE, limit: 2, cursor });
    assert.equal(result.ok, true);
    seen.push(...result.data.items.map((item) => item.taskId));
    cursor = result.data.nextCursor;
    pages += 1;
    assert.ok(pages <= 4);
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 5);
  assert.equal(seen.length, 5);
});

test('P15 a replayed replace keeps the first response shape, including the stored target', async () => {
  const world = createPrivateWorld();
  const first = await world.call('tasks.transition', {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: SECOND,
  });
  assert.equal(first.data.replacementTaskId, SECOND);
  const replay = await world.call('tasks.transition', {
    taskId: TOP,
    transition: 'replace',
    replacementTaskId: SECOND,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.state, 'replaced');
  assert.equal(replay.data.replacementTaskId, SECOND);
  assert.equal(replay.data.replacementState, 'selected');
  assert.equal(world.historyRows().length, 2);
});

test('P16 a malformed domain history result is rejected instead of reshaped', async () => {
  const entriesBroken = createTasksAdapters({
    tasksDomain: { handle: async () => ({ entries: 'not-a-list', nextCursor: null }) },
  });
  await assert.rejects(
    entriesBroken.handle({ action: 'tasks.history', payload: RANGE, actor: { accountId: OWNER } }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  const cursorBroken = createTasksAdapters({
    tasksDomain: { handle: async () => ({ entries: [], nextCursor: 42 }) },
  });
  await assert.rejects(
    cursorBroken.handle({ action: 'tasks.history', payload: RANGE, actor: { accountId: OWNER } }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  const fieldBroken = createTasksAdapters({
    tasksDomain: {
      handle: async () => ({
        entries: [{ taskId: TOP, date: '2026-10-20', state: 'completed' }],
        nextCursor: null,
      }),
    },
  });
  await assert.rejects(
    fieldBroken.handle({ action: 'tasks.history', payload: RANGE, actor: { accountId: OWNER } }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
});

test('P17 adapters reject malformed wiring and share the injected clock', () => {
  assert.throws(() => createTasksAdapters({ tasksDomain: {} }), TypeError);
  assert.throws(() => createTasksAdapters({ publicSuggestions: 'handler' }), TypeError);
  assert.throws(() => createTasksAdapters({ clock: 'now' }), TypeError);
  const clock = () => new Date(DAY_ONE);
  const adapters = createTasksAdapters({ tasksDomain: { handle: async () => ({}) }, clock });
  assert.equal(adapters.clock, clock);
  assert.ok(createTasksAdapters().clock() instanceof Date);
});
