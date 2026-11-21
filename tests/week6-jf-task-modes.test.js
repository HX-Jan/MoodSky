// W6-JF - task modes, template read rules, exact retries and write counts.
// Synthetic local doubles only: no cloud, no network, no real account.
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const { DEFAULT_TASKS } = require('../miniprogram/shared/task-catalogue');
const { clientCapabilities } = require('../miniprogram/modules/system/capabilities');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../cloudfunctions/moodsky/production/config');

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const identity = (who) => ({
  APPID: APP_ID,
  ENV: ENV_ID,
  SOURCE: 'wx_client',
  OPENID: who,
  identityFromCurrentInvocation: true,
});
const template = (id, extra = {}) => ({
  _id: id,
  enabled: true,
  title: '合成任务 ' + id,
  steps: ['合成步骤'],
  durationMin: 5,
  tags: [],
  ...extra,
});
const seedOf = (rows) => Object.fromEntries(rows.map((row) => ['task_templates:' + row._id, row]));
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
};
const error = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code, JSON.stringify(result));
};
const keysStartingWith = (rows, prefix) =>
  Object.entries(rows).filter(([key]) => key.startsWith(prefix + ':'));
const ownerHistory = (rows, ownerId) =>
  keysStartingWith(rows, 'task_history').filter(([, row]) => row.ownerId === ownerId);
const ownerReceipts = (rows, ownerId) =>
  keysStartingWith(rows, 'request_receipts').filter(([, row]) => row.ownerId === ownerId);

function world({ seed = {}, tasksWritesEnabled = true, fail = () => false } = {}) {
  const fixture = databaseFixture(seed, { fail });
  let now = new Date('2026-11-18T04:00:00.000Z'); // 2026-11-18 12:00 Asia/Shanghai
  let serial = 0;
  const scopes = {};
  const entry = (who, overrides = {}) =>
    createProductionEntry({
      tasksWritesEnabled,
      readIdentity: () => identity(who),
      readConfig: () => config,
      openDatabase: () => fixture.db,
      now: () => now,
      ...overrides,
    });
  const request = (action, payload = {}, id) => ({
    apiVersion: '1',
    requestId: id || 'req_w6_jf_' + ++serial,
    action,
    payload,
  });
  async function call(who, action, payload = {}, extra = {}) {
    const result = await entry(who)({
      ...request(action, payload, extra.requestId),
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
      ...extra,
    });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  }
  return {
    fixture,
    call,
    entry,
    request,
    scopes,
    setNow: (value) => {
      now = new Date(value);
    },
  };
}

test('W6-JF-M01 client capability matrix for closed, readOnly and enabled', () => {
  const base = {
    releaseProfile: 'production',
    cloudEnabled: true,
    cloudEnvId: 'synthetic-w6-jf',
    trustedSessionEnabled: true,
  };
  const closed = clientCapabilities({ ...base, taskMode: 'closed' }).tasks;
  assert.equal(closed.state, 'unavailable');
  assert.equal(closed.historyAvailable, false);
  const readOnly = clientCapabilities({ ...base, taskMode: 'readOnly' }).tasks;
  assert.equal(readOnly.state, 'readOnly');
  assert.equal(readOnly.historyAvailable, false);
  const enabled = clientCapabilities({ ...base, taskMode: 'enabled' }).tasks;
  assert.equal(enabled.state, 'available');
  assert.equal(enabled.historyAvailable, true);
  // Untrusted or unset builds fail closed even when taskMode says enabled.
  assert.equal(
    clientCapabilities({ ...base, trustedSessionEnabled: false, taskMode: 'enabled' }).tasks.state,
    'unavailable',
  );
  assert.equal(clientCapabilities({ ...base, taskMode: undefined }).tasks.state, 'unavailable');
});

test('W6-JF-M02 a non-production build is not a release gate (characterization)', () => {
  // Current development behavior: without releaseProfile=production, taskMode
  // defaults to enabled and availability does not require a trusted cloud.
  // This is documented as dev-only; production releases must set the profile.
  const dev = clientCapabilities({
    taskMode: 'enabled',
    cloudEnabled: false,
  }).tasks;
  assert.equal(dev.state, 'available');
  assert.equal(dev.historyAvailable, true);
});

test('W6-JF-T01 an empty successful template read falls back to the built-in three', async () => {
  const f = world({ seed: {}, tasksWritesEnabled: false });
  const result = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.equal(result.readOnly, true);
  assert.deepEqual(
    result.items.map((item) => item.taskId),
    ['moodsky_01_walk', 'moodsky_02_read', 'moodsky_03_journal'],
  );
  assert.deepEqual(
    result.items.map((item) => item.title),
    ['去散散心', '找个地方看会儿书', '记录一下心情'],
  );
  const quick = ok(await f.call('synthetic_a', 'tasks.quickChoice'));
  assert.deepEqual(quick.entries, [{ kind: 'tasks', label: '浏览小任务', enabled: true }]);
  assert.equal(quick.notice, '无需保存日记即可浏览任务；任务操作仍待接入。');
});

test('W6-JF-T02 official templates win over the built-in fallback', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]) });
  const result = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.deepEqual(
    result.items.map((item) => item.taskId),
    ['synthetic_one'],
  );
  assert.equal(result.items[0].title, '合成任务 synthetic_one');
});

test('W6-JF-T03 a few official templates are returned as-is without padding', async () => {
  const f = world({ seed: seedOf([template('synthetic_a1'), template('synthetic_a2')]) });
  const result = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.deepEqual(
    result.items.map((item) => item.taskId),
    ['synthetic_a1', 'synthetic_a2'],
  );
});

test('W6-JF-T04 more than three enabled templates are bounded to the first three by _id', async () => {
  const rows = ['b', 'e', 'a', 'd', 'c'].map((suffix) => template('synthetic_' + suffix));
  const f = world({ seed: seedOf(rows) });
  const result = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.deepEqual(
    result.items.map((item) => item.taskId),
    ['synthetic_a', 'synthetic_b', 'synthetic_c'],
  );
  assert.equal(result.items.length, 3);
});

test('W6-JF-T05 disabled-only rows leave an empty enabled read, which is the fallback trigger', async () => {
  const f = world({ seed: seedOf([template('synthetic_disabled', { enabled: false })]) });
  const result = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.deepEqual(
    result.items.map((item) => item.taskId),
    DEFAULT_TASKS.map((row) => row._id),
  );
});

test('W6-JF-T06 a malformed official row fails the whole read and leaves other rows alone', async () => {
  const f = world({
    seed: seedOf([template('synthetic_keep'), template('synthetic_broken', { title: '' })]),
  });
  const before = JSON.stringify(f.fixture.inspect());
  const result = await f.call('synthetic_a', 'tasks.suggestions');
  error(result, 'INTERNAL_ERROR');
  assert.equal(result.data, undefined);
  assert.equal(JSON.stringify(f.fixture.inspect()), before);
  assert.deepEqual(
    keysStartingWith(f.fixture.inspect(), 'task_templates')
      .map(([, row]) => row._id)
      .sort(),
    ['synthetic_broken', 'synthetic_keep'],
  );
});

test('W6-JF-T07 a template read failure is explicit, has no fallback, and can be retried', async () => {
  let failing = true;
  const f = world({
    seed: seedOf([template('synthetic_keep')]),
    fail: ({ collection, operation }) =>
      failing && collection === 'task_templates' && operation === 'query',
  });
  const before = JSON.stringify(f.fixture.inspect());
  const failed = await f.call('synthetic_a', 'tasks.suggestions');
  error(failed, 'INTERNAL_ERROR');
  assert.equal(failed.data, undefined);
  assert.equal(JSON.stringify(f.fixture.inspect()), before);
  failing = false;
  const recovered = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.deepEqual(
    recovered.items.map((item) => item.taskId),
    ['synthetic_keep'],
  );
});

test('W6-JF-T08 an empty catalogue falls back to write-enabled built-in tasks', async () => {
  // Explicit product semantics: "all templates disabled" is an empty enabled
  // read, so the built-in three are both suggested and accepted by the write
  // path. If operations want "disabled" to mean "offline", that is a product
  // change, not a property of the current fallback.
  const f = world({ seed: {}, tasksWritesEnabled: true });
  const owner = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  const result = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'moodsky_01_walk', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_empty_catalogue_1' },
    ),
  );
  assert.deepEqual(result, {
    taskId: 'moodsky_01_walk',
    date: '2026-11-18',
    state: 'selected',
    replayed: false,
  });
  const rows = ownerHistory(f.fixture.inspect(), owner);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1].taskId, 'moodsky_01_walk');
});

test('W6-JF-Q01 enabled quickChoice does not claim task writes are unavailable', async () => {
  const f = world({ seed: {}, tasksWritesEnabled: true });
  const quick = ok(await f.call('synthetic_a', 'tasks.quickChoice'));
  assert.deepEqual(quick.entries, [{ kind: 'tasks', label: '浏览小任务', enabled: true }]);
  assert.equal(quick.notice, '无需保存日记即可浏览任务。');
});

test('W6-JF-S01 readOnly serves suggestions and own state but refuses every write', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]), tasksWritesEnabled: false });
  ok(await f.call('synthetic_a', 'account.session'));
  const suggestions = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.equal(suggestions.readOnly, true);
  const mine = ok(await f.call('synthetic_a', 'tasks.mine'));
  assert.equal(mine.readOnly, true);
  assert.equal(mine.items[0].state, null);
  const write = await f.call(
    'synthetic_a',
    'tasks.transition',
    { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
    { requestId: 'req_w6_jf_readonly_1' },
  );
  error(write, 'FORBIDDEN');
  assert.equal(ownerHistory(f.fixture.inspect(), accountId(config, 'synthetic_a')).length, 0);
  assert.equal(ownerReceipts(f.fixture.inspect(), accountId(config, 'synthetic_a')).length, 0);
});

test('W6-JF-S02 enabled select then complete writes one row per task and day', async () => {
  const f = world({ seed: seedOf([template('synthetic_one'), template('synthetic_two')]) });
  const owner = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  const suggestions = ok(await f.call('synthetic_a', 'tasks.suggestions'));
  assert.equal(suggestions.readOnly, false);
  const select = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_select_1' },
    ),
  );
  assert.deepEqual(select, {
    taskId: 'synthetic_one',
    date: '2026-11-18',
    state: 'selected',
    replayed: false,
  });
  const complete = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_complete_1' },
    ),
  );
  assert.equal(complete.state, 'completed');
  const stored = ownerHistory(f.fixture.inspect(), owner).map(([, row]) => row);
  assert.deepEqual(
    stored.map((row) => [row.taskId, row.date, row.state]),
    [['synthetic_one', '2026-11-18', 'completed']],
  );
  assert.equal(stored.length, 1);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, 2);
});

test('W6-JF-S03 replace writes the replaced row and the new selection in one operation', async () => {
  const f = world({ seed: seedOf([template('synthetic_one'), template('synthetic_two')]) });
  const owner = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_replace_0' },
    ),
  );
  const replaced = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      {
        taskId: 'synthetic_one',
        transition: 'replace',
        replacementTaskId: 'synthetic_two',
        expectedDate: '2026-11-18',
      },
      { requestId: 'req_w6_jf_replace_1' },
    ),
  );
  assert.deepEqual(replaced, {
    taskId: 'synthetic_one',
    date: '2026-11-18',
    state: 'replaced',
    replacementTaskId: 'synthetic_two',
    replacementState: 'selected',
    replayed: false,
  });
  const mine = ok(await f.call('synthetic_a', 'tasks.mine'));
  const byId = Object.fromEntries(mine.items.map((item) => [item.taskId, item.state]));
  assert.equal(byId.synthetic_one, 'replaced');
  assert.equal(byId.synthetic_two, 'selected');
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 2);
});

test('W6-JF-S04 skip is terminal and a different target afterwards conflicts', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]) });
  ok(await f.call('synthetic_a', 'account.session'));
  const skip = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'skip', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_skip_1' },
    ),
  );
  assert.equal(skip.state, 'skipped');
  const conflict = await f.call(
    'synthetic_a',
    'tasks.transition',
    { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
    { requestId: 'req_w6_jf_skip_2' },
  );
  error(conflict, 'CONFLICT');
  assert.equal(ownerHistory(f.fixture.inspect(), accountId(config, 'synthetic_a')).length, 1);
});

test('W6-JF-R01 the same requestId and payload replays without a second write', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]) });
  const owner = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  const payload = {
    taskId: 'synthetic_one',
    transition: 'select',
    expectedDate: '2026-11-18',
  };
  const first = ok(
    await f.call('synthetic_a', 'tasks.transition', payload, { requestId: 'req_w6_jf_replay_1' }),
  );
  const replay = ok(
    await f.call('synthetic_a', 'tasks.transition', payload, { requestId: 'req_w6_jf_replay_1' }),
  );
  assert.equal(first.replayed, false);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 1);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, 1);
  const changed = await f.call(
    'synthetic_a',
    'tasks.transition',
    { ...payload, transition: 'complete' },
    { requestId: 'req_w6_jf_replay_1' },
  );
  error(changed, 'CONFLICT');
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 1);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, 1);
});

test('W6-JF-R02 a failed commit leaves no row or receipt and the original request retries', async () => {
  let failing = false;
  const f = world({
    seed: seedOf([template('synthetic_one')]),
    fail: ({ operation }) => failing && operation === 'commit',
  });
  ok(await f.call('synthetic_a', 'account.session'));
  failing = true;
  const payload = {
    taskId: 'synthetic_one',
    transition: 'select',
    expectedDate: '2026-11-18',
  };
  const failed = await f.call('synthetic_a', 'tasks.transition', payload, {
    requestId: 'req_w6_jf_commit_1',
  });
  error(failed, 'INTERNAL_ERROR');
  const owner = accountId(config, 'synthetic_a');
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 0);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, 0);
  failing = false;
  const retried = ok(
    await f.call('synthetic_a', 'tasks.transition', payload, {
      requestId: 'req_w6_jf_commit_1',
    }),
  );
  assert.equal(retried.state, 'selected');
  assert.equal(retried.replayed, false);
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 1);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, 1);
});

test('W6-JF-R03 an old dated request is refused on a new business day without writing', async () => {
  const f = world({ seed: seedOf([template('synthetic_one'), template('synthetic_two')]) });
  const owner = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_day_1' },
    ),
  );
  f.setNow('2026-11-19T04:00:00.000Z');
  const stale = await f.call(
    'synthetic_a',
    'tasks.transition',
    { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
    { requestId: 'req_w6_jf_day_2' },
  );
  error(stale, 'CONFLICT');
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 1);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, 1);
  const current = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_two', transition: 'select', expectedDate: '2026-11-19' },
      { requestId: 'req_w6_jf_day_3' },
    ),
  );
  assert.equal(current.date, '2026-11-19');
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 2);
});

test('W6-JF-R04 a committed dated request still replays after midnight with its original date', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]) });
  ok(await f.call('synthetic_a', 'account.session'));
  const payload = {
    taskId: 'synthetic_one',
    transition: 'select',
    expectedDate: '2026-11-18',
  };
  const first = ok(
    await f.call('synthetic_a', 'tasks.transition', payload, { requestId: 'req_w6_jf_midnight_1' }),
  );
  f.setNow('2026-11-19T04:00:00.000Z');
  const replay = ok(
    await f.call('synthetic_a', 'tasks.transition', payload, { requestId: 'req_w6_jf_midnight_1' }),
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.date, first.date);
  assert.equal(replay.date, '2026-11-18');
});

test('W6-JF-R05 a new requestId on the same terminal state adds a receipt, not history', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]) });
  const owner = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_terminal_1' },
    ),
  );
  ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_terminal_2' },
    ),
  );
  const before = ownerReceipts(f.fixture.inspect(), owner).length;
  const replay = ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_terminal_3' },
    ),
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.state, 'completed');
  assert.equal(ownerHistory(f.fixture.inspect(), owner).length, 1);
  assert.equal(ownerReceipts(f.fixture.inspect(), owner).length, before + 1);
});

test('W6-JF-A01 a second account cannot read or replay the first account', async () => {
  const f = world({ seed: seedOf([template('synthetic_one')]) });
  const ownerA = accountId(config, 'synthetic_a');
  const ownerB = accountId(config, 'synthetic_b');
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));
  ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_ab_1' },
    ),
  );
  const mineB = ok(await f.call('synthetic_b', 'tasks.mine'));
  assert.ok(mineB.items.every((item) => item.state === null));
  assert.equal(ownerHistory(f.fixture.inspect(), ownerA).length, 1);
  assert.equal(ownerHistory(f.fixture.inspect(), ownerB).length, 0);
  // B reusing A's requestId is a new operation under its own owner key.
  const replayB = ok(
    await f.call(
      'synthetic_b',
      'tasks.transition',
      { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_ab_1' },
    ),
  );
  assert.equal(replayB.replayed, false);
  assert.equal(ownerHistory(f.fixture.inspect(), ownerA).length, 1);
  assert.equal(ownerHistory(f.fixture.inspect(), ownerB).length, 1);
});

test('W6-JF-H01 production history returns one current row per task and business day', async () => {
  const seed = seedOf([template('synthetic_one')]);
  await withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      const scopes = {};
      const now = new Date('2026-11-18T04:00:00.000Z');
      let serial = 0;
      const entry = (who) =>
        createProductionEntry({
          tasksWritesEnabled: true,
          readIdentity: () => identity(who),
          readConfig: () => config,
          openDatabase: () => createProductionDatabase(nativeDb),
          now: () => now,
        });
      const call = async (who, action, payload = {}, requestId) => {
        const result = await entry(who)({
          apiVersion: '1',
          requestId: requestId || 'req_w6_jf_history_' + ++serial,
          action,
          payload,
          ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
        });
        if (action === 'account.session' && result.ok) {
          scopes[who] = result.data.scope;
        }
        return result;
      };
      ok(await call('synthetic_a', 'account.session'));
      ok(
        await call(
          'synthetic_a',
          'tasks.transition',
          { taskId: 'synthetic_one', transition: 'select', expectedDate: '2026-11-18' },
          'req_w6_jf_history_select',
        ),
      );
      ok(
        await call(
          'synthetic_a',
          'tasks.transition',
          { taskId: 'synthetic_one', transition: 'complete', expectedDate: '2026-11-18' },
          'req_w6_jf_history_complete',
        ),
      );
      const history = ok(
        await call('synthetic_a', 'tasks.history', {
          from: '2026-11-18',
          to: '2026-11-18',
        }),
      );
      assert.deepEqual(
        history.items.map((row) => [row.taskId, row.date, row.state]),
        [['synthetic_one', '2026-11-18', 'completed']],
      );
      assert.equal(history.nextCursor, null);
      const rows = Object.entries(inspect()).filter(([key]) => key.startsWith('task_history:'));
      assert.equal(rows.length, 1);
      assert.equal(rows[0][1].state, 'completed');
    },
    { nativeDatabase: true, taskStoreReads: true, conflictScope: 'written-documents' },
  );
});
