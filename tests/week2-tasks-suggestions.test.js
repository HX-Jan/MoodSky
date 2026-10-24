// W2 JF02 — tasks.suggestions / tasks.quickChoice (public reads).
// Owner: Jiawei Fang. Local doubles only: no cloud function, database or network
// call is made in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createTasksDomain } = require('../cloudfunctions/moodsky/domains/tasks');
const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');

const NOW = new Date('2026-10-20T04:00:00.000Z'); // 2026-10-20 12:00 Asia/Shanghai
const clock = () => NOW;
const OWNER = { id: 'account_alpha', status: 'active' };

// task_templates rows follow docs/week1/XiangYu/data-dictionary.md §9.
const TEMPLATES = [
  {
    _id: 'tpl_walk_10min',
    title: '在安全开放区域走 10 分钟',
    steps: ['找一个安全开放的区域', '慢慢走 10 分钟'],
    durationMin: 10,
    tags: ['outdoor'],
    enabled: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    _id: 'tpl_water',
    title: '喝一杯水',
    steps: ['倒一杯温水', '慢慢喝完'],
    durationMin: 2,
    tags: ['indoor'],
    enabled: true,
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  {
    _id: 'tpl_breathe',
    title: '做三次慢呼吸',
    steps: ['坐稳', '做三次慢呼吸'],
    durationMin: 3,
    tags: ['indoor'],
    enabled: true,
    createdAt: '2026-10-03T00:00:00.000Z',
  },
  {
    _id: 'tpl_extra',
    title: '第四条已启用模板不应进入建议',
    steps: ['这条超出上限'],
    durationMin: 5,
    tags: [],
    enabled: true,
    createdAt: '2026-10-04T00:00:00.000Z',
  },
  {
    _id: 'tpl_disabled',
    title: '已停用模板',
    steps: ['不应出现'],
    durationMin: 5,
    tags: [],
    enabled: false,
    createdAt: '2026-10-05T00:00:00.000Z',
  },
  {
    _id: 'tpl_bad_title',
    title: '   ',
    steps: ['标题无效'],
    durationMin: 5,
    tags: [],
    enabled: true,
    createdAt: '2026-10-06T00:00:00.000Z',
  },
];

function createRoute(store, { account = OWNER, adapters } = {}) {
  let serial = 0;
  const resolved = adapters || { resolveAccount: async () => account };
  const router = createRouter({
    ...resolved,
    domainHandlers: { tasks: createTasksDomain({ store, clock }).handle },
  });
  return (action, payload = {}, options = {}) => {
    serial += 1;
    const requestId = options.requestId || 'req_w2sug_' + String(serial).padStart(4, '0');
    return router(
      { apiVersion: '1', requestId, action, payload },
      options.context || { OPENID: 'trusted_openid_alpha' },
    );
  };
}

test('S01 suggestions works without a login and caps enabled templates at three', async () => {
  const call = createRoute(createMemoryTasksStore({ templates: TEMPLATES }), {
    adapters: {
      resolveAccount: async () => {
        throw new Error('public suggestions must not query an account');
      },
    },
  });
  const result = await call('tasks.suggestions');
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.data.items.map((item) => item.taskId),
    ['tpl_walk_10min', 'tpl_water', 'tpl_breathe'],
  );
  assert.equal(result.data.notice, '完成由你自行确认，不做打卡惩罚。');
  const first = result.data.items[0];
  assert.deepEqual(Object.keys(first).sort(), [
    'durationMin',
    'indoor',
    'state',
    'steps',
    'tags',
    'taskId',
    'title',
  ]);
  assert.equal(first.state, null);
  assert.equal(first.indoor, false);
  assert.deepEqual(first.steps, ['找一个安全开放的区域', '慢慢走 10 分钟']);
  assert.equal(first.durationMin, 10);
  assert.equal(result.data.items[1].indoor, true);
  // Disabled and malformed rows are skipped, never repaired into fake tasks.
  assert.ok(!result.data.items.some((item) => item.taskId.startsWith('tpl_disabled')));
  assert.ok(!result.data.items.some((item) => item.taskId === 'tpl_bad_title'));
});

test('S02 an empty or malformed template collection renders an empty state', async () => {
  const empty = await createRoute(createMemoryTasksStore())('tasks.suggestions');
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.data.items, []);
  assert.equal(empty.data.notice, '完成由你自行确认，不做打卡惩罚。');

  const broken = createMemoryTasksStore({
    templates: [{ _id: 'tpl_broken', enabled: true, title: '缺步骤的模板' }],
  });
  const result = await createRoute(broken)('tasks.suggestions');
  assert.deepEqual(result.data.items, []);
});

test('S03 suggestions never reads private state, history or receipts', async () => {
  const store = createMemoryTasksStore({ templates: TEMPLATES });
  store.getStatesForDate = () => {
    throw new Error('suggestions must not read task state');
  };
  store.listHistory = () => {
    throw new Error('suggestions must not read history');
  };
  store.getReceipt = () => {
    throw new Error('suggestions must not read receipts');
  };
  const result = await createRoute(store)('tasks.suggestions');
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 3);
});

test('S04 suggestions rejects unexpected payload fields and identity spoofing', async () => {
  const store = createMemoryTasksStore({ templates: TEMPLATES });
  const call = createRoute(store);
  const date = await call('tasks.suggestions', { date: '2026-10-20' });
  assert.equal(date.ok, false);
  assert.equal(date.error.code, 'INVALID_INPUT');

  for (const field of ['ownerId', 'owner', 'openid', 'OPENID', 'role', 'roles', 'accountId']) {
    const spoofed = await call('tasks.suggestions', { [field]: 'someone_else' });
    assert.equal(spoofed.error.code, 'INVALID_REQUEST', field);
  }
  const arrayPayload = await call('tasks.suggestions', []);
  assert.equal(arrayPayload.error.code, 'INVALID_REQUEST');
});

test('S05 quickChoice offers entries plus the same suggestions without a journal entry', async () => {
  const call = createRoute(createMemoryTasksStore({ templates: TEMPLATES }));
  const result = await call('tasks.quickChoice');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.entries, [
    { kind: 'places', label: '找个安静角落', enabled: true },
    { kind: 'tasks', label: '做一件小事', enabled: true },
  ]);
  assert.equal(result.data.suggestions.length, 3);
  assert.equal(result.data.notice, '不读取你的日记正文。');

  const empty = await createRoute(createMemoryTasksStore())('tasks.quickChoice');
  assert.deepEqual(empty.data.suggestions, []);
  assert.equal(empty.data.entries.length, 2);
});

test('S06 quickChoice rejects journal text and unknown payload fields', async () => {
  const call = createRoute(createMemoryTasksStore({ templates: TEMPLATES }));
  for (const payload of [
    { text: '今天的日记' },
    { date: '2026-10-20' },
    { savedJournal: true },
    { ownerId: 'someone_else' },
  ]) {
    const result = await call('tasks.quickChoice', payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.ok(
      ['INVALID_INPUT', 'INVALID_REQUEST'].includes(result.error.code),
      JSON.stringify(payload) + ' -> ' + result.error.code,
    );
  }
});
