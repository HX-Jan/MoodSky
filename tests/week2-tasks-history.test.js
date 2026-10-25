// W2 JF02 — tasks.history: owner scoping, range validation and stable pagination.
// Owner: Jiawei Fang. Local doubles only: no cloud function, database or network
// call is made in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createTasksDomain } = require('../cloudfunctions/moodsky/services/tasks-candidate');
const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');

const OWNER = 'account_alpha';
const OTHER = 'account_beta';
const NOW = new Date('2026-10-20T04:00:00.000Z');
const clock = () => NOW;
const RANGE = { from: '2026-09-20', to: '2026-10-20' };

function seedRows(count, { ownerId = OWNER, date = '2026-10-10', prefix = 'tpl_seed' } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    _id: 'hist_' + prefix + '_' + String(index).padStart(2, '0'),
    ownerId,
    taskId: prefix + '_' + String(index).padStart(2, '0'),
    date,
    state: 'completed',
    createdAt: '2026-10-10T00:' + String(index).padStart(2, '0') + ':00.000Z',
  }));
}

function createHistoryWorld({ history = [], account = { id: OWNER, status: 'active' } } = {}) {
  const store = createMemoryTasksStore({ history });
  const domain = createTasksDomain({ store, clock });
  let serial = 0;
  const router = createRouter({
    resolveAccount: async (openid) => ({
      id: openid === 'trusted_openid_beta' ? OTHER : account.id,
      status: account.status,
    }),
    domainHandlers: { tasks: domain.handle },
  });
  return {
    store,
    call(action, payload = {}, options = {}) {
      serial += 1;
      const requestId = options.requestId || 'req_w2hist_' + String(serial).padStart(4, '0');
      return router(
        { apiVersion: '1', requestId, action, payload },
        options.context || { OPENID: 'trusted_openid_alpha' },
      );
    },
    history(payload, options) {
      return this.call('tasks.history', payload, options);
    },
    async insert(entry) {
      await store.commitTransition({
        ownerId: OWNER,
        action: 'tasks.transition',
        requestId: 'req_w2hist_seed_' + entry.taskId,
        digest: 'seed',
        result: {},
        entries: [{ ...entry, createdAt: entry.createdAt }],
      });
    },
  };
}

test('H01 history requires a trusted private identity', async () => {
  const world = createHistoryWorld({ history: seedRows(3) });
  const missing = await world.history(RANGE, { context: {} });
  assert.equal(missing.error.code, 'UNAUTHENTICATED');
  const disabled = await createHistoryWorld({
    history: seedRows(3),
    account: { id: OWNER, status: 'disabled' },
  }).history(RANGE);
  assert.equal(disabled.error.code, 'ACCOUNT_DISABLED');
});

test('H02 history only returns the calling owner rows', async () => {
  const world = createHistoryWorld({
    history: [...seedRows(2), ...seedRows(3, { ownerId: OTHER, prefix: 'tpl_other' })],
  });
  const result = await world.history(RANGE);
  assert.equal(result.ok, true);
  assert.equal(result.data.entries.length, 2);
  for (const entry of result.data.entries) {
    assert.match(entry.taskId, /^tpl_seed_/);
  }
  assert.doesNotMatch(JSON.stringify(result.data), new RegExp(OWNER));
});

test('H03 the date range is inclusive on both bounds', async () => {
  const rows = [
    { ...seedRows(1, { date: '2026-09-30' })[0], taskId: 'tpl_before' },
    { ...seedRows(1, { date: '2026-10-01' })[0], taskId: 'tpl_start' },
    { ...seedRows(1, { date: '2026-10-20' })[0], taskId: 'tpl_end' },
    { ...seedRows(1, { date: '2026-10-21' })[0], taskId: 'tpl_after' },
  ];
  const result = await createHistoryWorld({ history: rows }).history({
    from: '2026-10-01',
    to: '2026-10-20',
  });
  assert.deepEqual(result.data.entries.map((entry) => entry.taskId).sort(), [
    'tpl_end',
    'tpl_start',
  ]);
});

test('H04 cursor pagination walks every row exactly once', async () => {
  const world = createHistoryWorld({ history: seedRows(25) });
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const result = await world.history({ ...RANGE, limit: 10, cursor });
    assert.equal(result.ok, true);
    seen.push(...result.data.entries.map((entry) => entry.taskId));
    cursor = result.data.nextCursor;
    pages += 1;
    assert.ok(pages <= 4);
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(seen.length, 25);
  assert.equal(new Set(seen).size, 25);
  assert.equal(seen[0], 'tpl_seed_24');
  assert.equal(seen[24], 'tpl_seed_00');
});

test('H05 the page size defaults to 20 and is capped at 50', async () => {
  const world = createHistoryWorld({ history: seedRows(25) });
  const defaults = await world.history(RANGE);
  assert.equal(defaults.data.entries.length, 20);
  assert.ok(defaults.data.nextCursor);

  const capped = await world.history({ ...RANGE, limit: 50 });
  assert.equal(capped.data.entries.length, 25);
  assert.equal(capped.data.nextCursor, null);

  for (const limit of [0, 51, 1.5, '10', -1]) {
    const result = await world.history({ ...RANGE, limit });
    assert.equal(result.error.code, 'INVALID_INPUT', String(limit));
  }
});

test('H06 invalid or oversized ranges are rejected', async () => {
  const world = createHistoryWorld({ history: seedRows(1) });
  const cases = [
    { from: '2026-10-20', to: '2026-10-01' },
    { from: '2026-10-01' },
    { to: '2026-10-01' },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: 'not-a-date', to: '2026-10-01' },
    { from: '2026-01-01', to: '2026-04-01' },
  ];
  for (const payload of cases) {
    const result = await world.history(payload);
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(payload));
  }
  const longest = await world.history({ from: '2026-01-01', to: '2026-03-31' });
  assert.equal(longest.ok, true);
  assert.deepEqual(longest.data.entries, []);
});

test('H07 malformed cursors are rejected', async () => {
  const world = createHistoryWorld({ history: seedRows(3) });
  for (const cursor of ['not-a-cursor', '', 123, true]) {
    const result = await world.history({ ...RANGE, cursor });
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(cursor));
  }
  const brokenPayload = Buffer.from(JSON.stringify({ c: 1 }), 'utf8').toString('base64url');
  const result = await world.history({ ...RANGE, cursor: brokenPayload });
  assert.equal(result.error.code, 'INVALID_INPUT');
});

test('H08 an empty window returns an empty page and no cursor', async () => {
  const result = await createHistoryWorld({ history: seedRows(3) }).history({
    from: '2026-08-01',
    to: '2026-08-31',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { entries: [], nextCursor: null });
});

test('H09 history entries expose only task facts, never the owner id', async () => {
  const result = await createHistoryWorld({ history: seedRows(1) }).history(RANGE);
  const entry = result.data.entries[0];
  assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'date', 'state', 'taskId']);
  assert.equal(entry.taskId, 'tpl_seed_00');
  assert.equal(entry.date, '2026-10-10');
  assert.equal(entry.state, 'completed');
  assert.equal(entry.createdAt, '2026-10-10T00:00:00.000Z');
});

test('H10 history payload rejects identity fields and unknown controls', async () => {
  const world = createHistoryWorld({ history: seedRows(1) });
  for (const field of ['ownerId', 'owner', 'openid', 'OPENID', 'role', 'roles', 'accountId']) {
    const result = await world.history({ ...RANGE, [field]: OTHER });
    assert.equal(result.error.code, 'INVALID_REQUEST', field);
  }
  for (const payload of [
    { ...RANGE, windowDays: 7 },
    { ...RANGE, date: '2026-10-10' },
  ]) {
    const result = await world.history(payload);
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(payload));
  }
});

test('H11 a newer row inserted between pages never duplicates or shifts page two', async () => {
  const world = createHistoryWorld({ history: seedRows(25) });
  const pageOne = await world.history({ ...RANGE, limit: 10 });
  await world.insert({
    taskId: 'tpl_new_row',
    date: '2026-10-10',
    state: 'completed',
    createdAt: '2026-10-10T01:00:00.000Z',
  });
  const pageTwo = await world.history({
    ...RANGE,
    limit: 10,
    cursor: pageOne.data.nextCursor,
  });
  assert.equal(pageTwo.ok, true);
  const first = pageOne.data.entries.map((entry) => entry.taskId);
  const second = pageTwo.data.entries.map((entry) => entry.taskId);
  assert.equal(second.length, 10);
  assert.ok(!second.includes('tpl_new_row'));
  assert.ok(second.every((taskId) => !first.includes(taskId)));
  assert.equal(second[0], 'tpl_seed_14');
});

test('H12 another owner cursor cannot widen or leak the current owner scope', async () => {
  const world = createHistoryWorld({
    history: [...seedRows(25), ...seedRows(6, { ownerId: OTHER, prefix: 'tpl_other' })],
  });
  const otherPage = await world.call(
    'tasks.history',
    { ...RANGE, limit: 5 },
    { context: { OPENID: 'trusted_openid_beta' } },
  );
  assert.equal(otherPage.ok, true);
  const result = await world.history({
    ...RANGE,
    limit: 10,
    cursor: otherPage.data.nextCursor,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.entries.length, 1);
  for (const entry of result.data.entries) {
    assert.match(entry.taskId, /^tpl_seed_/);
  }
});
