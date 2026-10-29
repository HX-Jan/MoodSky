// W3 JF05 — task_history / preferences data sources for export and cleanup.
// Owner: Jiawei Fang. Local doubles only: no cloud function, database or network
// call is made in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountDataSources } = require('../cloudfunctions/moodsky/services/account-data');
const { sourceState } = require('../cloudfunctions/moodsky/domains/storage-support');
const { databaseFixture } = require('./helpers/w2-database');

const OWNER = 'account_w3_data_owner';
const OTHER = 'account_w3_other_owner';
const ISO = '2026-10-20T04:00:00.000Z';
const REVISIONS = Object.freeze({
  journals: 3,
  favorites: 1,
  tasks: 4,
  preferences: 2,
  decorations: 0,
});

function accountRow(overrides = {}) {
  return {
    _id: OWNER,
    status: 'active',
    journalLayout: 'deterministic-days-v1',
    taskLayout: 'deterministic-tasks-v1',
    journalRevision: 3,
    operationFence: 0,
    exportEpoch: 2,
    sourceRevisions: { ...REVISIONS },
    ...overrides,
  };
}

function without(row, key) {
  const copy = { ...row };
  delete copy[key];
  return copy;
}

function historyRow(id, extra = {}) {
  return {
    _id: id,
    ownerId: OWNER,
    taskId: 'tpl_' + id,
    date: '2026-10-10',
    state: 'completed',
    createdAt: '2026-10-10T00:00:00.000Z',
    ...extra,
  };
}

function sourceFixture(accounts = accountRow()) {
  return databaseFixture({ ['accounts:' + OWNER]: accounts });
}

async function readState(fixture, ownerId = OWNER) {
  const sources = createAccountDataSources({ db: fixture.db });
  return fixture.db.runTransaction((tx) => sources.readSourceState(ownerId, tx));
}

test('D01 the source state has the shape storage-support.sourceState accepts', async () => {
  const fixture = sourceFixture();
  const state = await readState(fixture);
  assert.deepEqual(state, {
    ownerId: OWNER,
    status: 'active',
    epoch: 2,
    revisions: { ...REVISIONS },
  });
  // The export fence consumer must accept it unchanged.
  assert.deepEqual(sourceState(state, OWNER), { epoch: 2, revisions: { ...REVISIONS } });
});

test('D02 an injected transaction is enough: no database handle is required', async () => {
  const fixture = sourceFixture();
  const sources = createAccountDataSources();
  const state = await fixture.db.runTransaction((tx) => sources.readSourceState(OWNER, tx));
  assert.equal(state.epoch, 2);
  assert.deepEqual(Object.keys(state.revisions).sort(), [
    'decorations',
    'favorites',
    'journals',
    'preferences',
    'tasks',
  ]);
});

test('D03 an account without the confirmed layouts is not a usable export source', async () => {
  for (const key of ['journalLayout', 'taskLayout']) {
    const fixture = sourceFixture(without(accountRow(), key));
    await assert.rejects(readState(fixture), { code: 'NOT_IMPLEMENTED' });
  }
  await assert.rejects(readState(sourceFixture(accountRow({ taskLayout: 'legacy-tasks' }))), {
    code: 'NOT_IMPLEMENTED',
  });
});

test('D04 a row without sourceRevisions answers NOT_IMPLEMENTED instead of zero revisions', async () => {
  const fixture = sourceFixture(without(accountRow(), 'sourceRevisions'));
  await assert.rejects(readState(fixture), (error) => {
    assert.equal(error.code, 'NOT_IMPLEMENTED');
    assert.match(error.message, /来源版本/);
    return true;
  });
});

test('D05 a journal revision that disagrees with sourceRevisions is a CONFLICT', async () => {
  const fixture = sourceFixture(accountRow({ sourceRevisions: { ...REVISIONS, journals: 5 } }));
  await assert.rejects(readState(fixture), { code: 'CONFLICT' });
});

test('D06 malformed or exhausted counters are a CONFLICT, never rounded', async () => {
  const cases = [
    { exportEpoch: -1 },
    { exportEpoch: 1.5 },
    { exportEpoch: Number.MAX_SAFE_INTEGER },
    { journalRevision: -2 },
    { operationFence: '0' },
    { sourceRevisions: { ...REVISIONS, journals: 3, tasks: -1 } },
    { sourceRevisions: { ...REVISIONS, preferences: 1.5 } },
    { sourceRevisions: { ...REVISIONS, favorites: undefined } },
    { sourceRevisions: { ...REVISIONS, extra: 0 } },
    { sourceRevisions: { journals: 3 } },
  ];
  for (const overrides of cases) {
    const fixture = sourceFixture(accountRow(overrides));
    await assert.rejects(readState(fixture), { code: 'CONFLICT' }, JSON.stringify(overrides));
  }
});

test('D07 a field that predates the fence protocol is NOT_IMPLEMENTED, not migrated', async () => {
  for (const key of ['operationFence', 'exportEpoch', 'journalRevision']) {
    const fixture = sourceFixture(without(accountRow(), key));
    await assert.rejects(readState(fixture), { code: 'NOT_IMPLEMENTED' }, key);
  }
});

test('D08 the fence refuses a missing, mismatched or disabled account', async () => {
  const missing = sourceFixture();
  const sources = createAccountDataSources({ db: missing.db });
  await assert.rejects(
    missing.db.runTransaction((tx) => sources.readSourceState(OTHER, tx)),
    { code: 'UNAUTHENTICATED' },
  );
  const mismatched = databaseFixture({
    ['accounts:' + OWNER]: accountRow({ _id: OTHER }),
  });
  await assert.rejects(readState(mismatched), { code: 'UNAUTHENTICATED' });
  await assert.rejects(readState(sourceFixture(accountRow({ status: 'disabled' }))), {
    code: 'ACCOUNT_DISABLED',
  });
});

test('D09 the source state cannot be read outside a transaction', async () => {
  const sources = createAccountDataSources({ db: sourceFixture().db });
  await assert.rejects(sources.readSourceState(OWNER), { code: 'NOT_IMPLEMENTED' });
  await assert.rejects(sources.readSourceState(''), { code: 'INVALID_INPUT' });
});

test('D10 task history is owner-only and drops storage identity fields', async () => {
  const fixture = databaseFixture({
    ['accounts:' + OWNER]: accountRow(),
    ['task_history:h1']: historyRow('h1'),
    ['task_history:h2']: historyRow('h2', { taskTitle: '喝一杯水', state: 'selected' }),
    ['task_history:h3']: { ...historyRow('h3', { taskId: 'tpl_other' }), ownerId: OTHER },
  });
  const sources = createAccountDataSources({ db: fixture.db });
  const page = await sources.listTaskHistory(OWNER, { limit: 10 });
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, null);
  for (const item of page.items) {
    // taskTitle is the only optional projection (present only when stored).
    const fields = Object.keys(item).filter(function (key) {
      return key !== 'taskTitle';
    });
    assert.deepEqual(fields.sort(), ['createdAt', 'date', 'state', 'taskId']);
  }
  assert.equal(page.items[1].taskTitle, '喝一杯水');
  assert.equal(Object.hasOwn(page.items[0], 'taskTitle'), false);
  assert.doesNotMatch(JSON.stringify(page), /ownerId|account_w3_other_owner/);
});

test('D11 the history cursor walks every own row exactly once', async () => {
  const seed = { ['accounts:' + OWNER]: accountRow() };
  for (let index = 0; index < 5; index += 1) {
    seed['task_history:h0' + index] = historyRow('h0' + index);
  }
  seed['task_history:h99'] = { ...historyRow('h99'), ownerId: OTHER };
  const sources = createAccountDataSources({ db: databaseFixture(seed).db });
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await sources.listTaskHistory(OWNER, { limit: 2, after: cursor });
    seen.push(...page.items.map((item) => item.taskId));
    cursor = page.nextCursor;
    pages += 1;
    assert.ok(pages <= 4);
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);
});

test('D12 malformed history rows and arguments fail instead of being projected', async () => {
  const rows = {
    state: historyRow('s1', { state: 'archived' }),
    date: historyRow('s2', { date: '2026-13-01' }),
    createdAt: historyRow('s3', { createdAt: 'not-a-date' }),
    taskId: historyRow('s4', { taskId: 'bad id!' }),
  };
  for (const [name, row] of Object.entries(rows)) {
    const fixture = databaseFixture({
      ['accounts:' + OWNER]: accountRow(),
      ['task_history:' + row._id]: row,
    });
    const sources = createAccountDataSources({ db: fixture.db });
    await assert.rejects(sources.listTaskHistory(OWNER, { limit: 5 }), { code: 'CONFLICT' }, name);
  }
  const sources = createAccountDataSources({ db: sourceFixture().db });
  for (const options of [{ limit: 0 }, { limit: 101 }, { after: 'bad id!' }]) {
    await assert.rejects(sources.listTaskHistory(OWNER, options), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(sources.listTaskHistory(''), { code: 'INVALID_INPUT' });
});

test('D13 preferences are projected without ownerId/openid and without invented defaults', async () => {
  const fixture = databaseFixture({
    ['accounts:' + OWNER]: accountRow(),
    ['preferences:p1']: {
      _id: 'p1',
      ownerId: OWNER,
      cardTextPreview: true,
      openid: 'should-never-leave',
      updatedAt: ISO,
    },
    ['preferences:p2']: {
      _id: 'p2',
      ownerId: OTHER,
      cardTextPreview: false,
      decorationsEnabled: false,
    },
  });
  const sources = createAccountDataSources({ db: fixture.db });
  const preferences = await sources.listPreferences(OWNER);
  assert.deepEqual(preferences, { cardTextPreview: true, updatedAt: ISO });
  assert.doesNotMatch(JSON.stringify(preferences), /ownerId|openid|should-never-leave/);
});

test('D14 an owner without a saved preference document gets null, not defaults', async () => {
  const sources = createAccountDataSources({ db: sourceFixture().db });
  assert.equal(await sources.listPreferences(OWNER), null);
});

test('D15 duplicate or corrupt preference documents are a CONFLICT', async () => {
  const duplicate = databaseFixture({
    ['preferences:p1']: { _id: 'p1', ownerId: OWNER, cardTextPreview: true },
    ['preferences:p2']: { _id: 'p2', ownerId: OWNER, cardTextPreview: false },
  });
  await assert.rejects(createAccountDataSources({ db: duplicate.db }).listPreferences(OWNER), {
    code: 'CONFLICT',
  });
  for (const row of [
    { _id: 'p1', ownerId: OWNER, cardTextPreview: 'yes' },
    { _id: 'p1', ownerId: OWNER, updatedAt: 'not-a-date' },
  ]) {
    const fixture = databaseFixture({ ['preferences:p1']: row });
    await assert.rejects(createAccountDataSources({ db: fixture.db }).listPreferences(OWNER), {
      code: 'CONFLICT',
    });
  }
});

test('D16 a cleanup batch deletes only this owner, and reports whether more remains', async () => {
  const fixture = databaseFixture({
    ['accounts:' + OWNER]: accountRow(),
    ['task_history:h1']: historyRow('h1'),
    ['task_history:h2']: historyRow('h2'),
    ['task_history:h3']: historyRow('h3'),
    ['task_history:h4']: { ...historyRow('h4'), ownerId: OTHER },
    ['task_templates:t1']: {
      _id: 't1',
      title: '公共模板',
      steps: ['一步'],
      durationMin: 5,
      enabled: true,
    },
  });
  const sources = createAccountDataSources({ db: fixture.db });
  const first = await sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', limit: 2 });
  assert.deepEqual(first, { collection: 'task_history', deleted: 2, hasMore: true });
  const second = await sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', limit: 2 });
  assert.deepEqual(second, { collection: 'task_history', deleted: 1, hasMore: false });
  const stored = fixture.inspect();
  assert.equal(stored['task_history:h4'].ownerId, OTHER);
  assert.ok(stored['task_templates:t1']);
  assert.equal(
    Object.keys(stored).filter((key) => key.startsWith('task_history:h') && !key.endsWith('h4'))
      .length,
    0,
  );
});

test('D17 repeating a finished cleanup changes nothing and reports zero deletions', async () => {
  const fixture = sourceFixture();
  fixture.put('task_history', historyRow('h1'));
  fixture.put('task_history', historyRow('h2'));
  const sources = createAccountDataSources({ db: fixture.db });
  const first = await sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', limit: 10 });
  assert.deepEqual(first, { collection: 'task_history', deleted: 2, hasMore: false });
  const afterFirst = fixture.inspect();
  const again = await sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', limit: 10 });
  assert.deepEqual(again, { collection: 'task_history', deleted: 0, hasMore: false });
  assert.deepEqual(fixture.inspect(), afterFirst);
});

test('D18 a row already removed by another worker is zero deletions, not an error', async () => {
  const fixture = sourceFixture();
  fixture.put('task_history', historyRow('h1'));
  // Every remove reports "nothing removed", as a concurrent cleanup would.
  const db = {
    ...fixture.db,
    collection(name) {
      const reference = fixture.db.collection(name);
      return {
        where: (filter) => reference.where(filter),
        doc(id) {
          return { ...reference.doc(id), remove: async () => ({ stats: { removed: 0 } }) };
        },
      };
    },
  };
  const sources = createAccountDataSources({ db });
  const result = await sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', limit: 5 });
  assert.deepEqual(result, { collection: 'task_history', deleted: 0, hasMore: true });
  assert.ok(fixture.inspect()['task_history:h1']);
});

test('D19 cleanup refuses task_templates and every collection outside the allow-list', async () => {
  const fixture = databaseFixture({
    ['task_templates:t1']: {
      _id: 't1',
      title: '公共模板',
      steps: ['一步'],
      durationMin: 5,
      enabled: true,
    },
    ['journals:j1']: { _id: 'j1', ownerId: OWNER, date: '2026-10-10' },
  });
  const sources = createAccountDataSources({ db: fixture.db });
  for (const collection of ['task_templates', 'journals', 'accounts', undefined]) {
    await assert.rejects(sources.cleanupOwnerBatch(OWNER, { collection, limit: 5 }), {
      code: 'INVALID_INPUT',
    });
  }
  const stored = fixture.inspect();
  assert.ok(stored['task_templates:t1']);
  assert.ok(stored['journals:j1']);
  for (const options of [{ limit: 0 }, { limit: 101 }]) {
    await assert.rejects(
      sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', ...options }),
      { code: 'INVALID_INPUT' },
    );
  }
});

test('D20 a missing database handle answers NOT_IMPLEMENTED, never an empty success', async () => {
  const sources = createAccountDataSources();
  await assert.rejects(sources.listTaskHistory(OWNER, { limit: 5 }), {
    code: 'NOT_IMPLEMENTED',
  });
  await assert.rejects(sources.listPreferences(OWNER), { code: 'NOT_IMPLEMENTED' });
  await assert.rejects(sources.cleanupOwnerBatch(OWNER, { collection: 'task_history', limit: 5 }), {
    code: 'NOT_IMPLEMENTED',
  });
  // A fixture wrapper (not fixture.db) is a wiring error, not a data answer.
  const fixture = sourceFixture();
  await assert.rejects(createAccountDataSources({ db: fixture }).listTaskHistory(OWNER), TypeError);
});
