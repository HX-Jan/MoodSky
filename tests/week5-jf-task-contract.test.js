// W5 JF (Jiawei Fang) — 普通任务契约的第五周定向验证。
// 覆盖：原请求已完成但丢响应后按原回执恢复、重开后可读、跨日首次送达的旧请求被拒绝、
// 切号后不重放。全部为合成替身（离线原生 SDK 数据库），不涉及真实云、真实设备或网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createNativeJournalDatabase } = require('../tools/journal-storage/native-database');
const {
  createTransactionalTasksStore,
  TASK_LAYOUT,
} = require('../cloudfunctions/moodsky/stores/transactional-tasks');
const { createTasksDomain } = require('../cloudfunctions/moodsky/services/tasks-candidate');

const OWNER_A = 'owner_week5_alpha';
const OWNER_B = 'owner_week5_beta';
const DAY_ONE = '2026-11-10T04:00:00.000Z'; // 2026-11-10 12:00 Asia/Shanghai
const DAY_TWO = '2026-11-11T04:00:00.000Z';
const DATE_ONE = '2026-11-10';
const DATE_TWO = '2026-11-11';

const account = (id, openid, patch = {}) => ({
  _id: id,
  openid,
  status: 'active',
  journalLayout: 'deterministic-days-v1',
  taskLayout: TASK_LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
  ...patch,
});
const template = (id, title) => ({
  _id: id,
  enabled: true,
  title,
  steps: ['仅合成测试'],
  durationMin: 2,
  tags: [],
});
const seed = (patch = {}) => ({
  ['accounts:' + OWNER_A]: account(OWNER_A, 'openid_week5_alpha'),
  ['accounts:' + OWNER_B]: account(OWNER_B, 'openid_week5_beta'),
  'task_templates:task_walk': template('task_walk', '在安全开放区域走 10 分钟'),
  'task_templates:task_water': template('task_water', '喝一杯水'),
  ...patch,
});
const options = { nativeDatabase: true, taskStoreReads: true, conflictScope: 'written-documents' };

function world(nativeDb, now = DAY_ONE) {
  const clock = { now: new Date(now) };
  const build = () => {
    const db = createNativeJournalDatabase(nativeDb, { taskHistoryEnabled: true });
    const store = createTransactionalTasksStore({ db });
    const domain = createTasksDomain({ store, clock: () => clock.now });
    return { db, store, domain };
  };
  let current = build();
  const call = (action, payload, requestId, ownerId = OWNER_A) =>
    current.domain.handle({
      action,
      actor: { accountId: ownerId },
      requestId,
      payload,
    });
  const transition = (payload, requestId, ownerId) =>
    call('tasks.transition', payload, requestId, ownerId);
  const history = (ownerId = OWNER_A) =>
    call('tasks.history', { from: DATE_ONE, to: DATE_TWO }, 'req_week5_history', ownerId);
  const rows = (data) =>
    Object.entries(data)
      .filter(([key]) => key.startsWith('task_history:'))
      .map(([, row]) => row);
  const receipts = (data) =>
    Object.entries(data).filter(([key]) => key.startsWith('request_receipts:'));
  return {
    clock,
    call,
    transition,
    history,
    rows,
    receipts,
    setNow: (value) => {
      clock.now = new Date(value);
    },
    // A reopen means a brand-new store and domain over the same persisted data.
    reopen: (value) => {
      if (value) {
        clock.now = new Date(value);
      }
      current = build();
      return current;
    },
    get domain() {
      return current.domain;
    },
  };
}

test('W5-JF-R13-01 a lost response is recovered by replaying the original request', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const w = world(nativeDb);
      const first = await w.transition(
        { taskId: 'task_walk', transition: 'select' },
        'req_week5_lost_001',
      );
      assert.equal(first.state, 'selected');
      // The client never saw the response; the retry must reuse the same request.
      const retry = await w.transition(
        { taskId: 'task_walk', transition: 'select' },
        'req_week5_lost_001',
      );
      assert.equal(retry.replayed, true);
      assert.equal(retry.state, 'selected');
      assert.equal(w.rows(inspect()).length, 1);
      assert.equal(w.receipts(inspect()).length, 1);
    },
    options,
  );
});

test('W5-JF-R13-02 a reopened service reads the committed state and still replays', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const w = world(nativeDb);
      await w.transition({ taskId: 'task_walk', transition: 'select' }, 'req_week5_reopen_001');
      await w.transition({ taskId: 'task_walk', transition: 'complete' }, 'req_week5_reopen_002');

      const reopened = w.reopen();
      assert.ok(reopened.domain);
      const history = await w.history();
      assert.equal(history.entries.length, 1);
      assert.equal(history.entries[0].state, 'completed');
      assert.equal(history.entries[0].date, DATE_ONE);

      const retry = await w.transition(
        { taskId: 'task_walk', transition: 'complete' },
        'req_week5_reopen_002',
      );
      assert.equal(retry.replayed, true);
      assert.equal(w.rows(inspect()).length, 1);
    },
    options,
  );
});

test('W5-JF-R13-03 an old dated request first delivered on a new day is refused', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const w = world(nativeDb);
      w.setNow(DAY_TWO);
      // First delivery of yesterday's request: nothing was committed for it.
      await assert.rejects(
        w.transition(
          { taskId: 'task_walk', transition: 'select', expectedDate: DATE_ONE },
          'req_week5_stale_001',
        ),
        (error) => error.code === 'CONFLICT',
      );
      assert.equal(w.rows(inspect()).length, 0);
      assert.equal(w.receipts(inspect()).length, 0);
      // Reading today's state stays available so the user can choose again.
      const mine = await w.call('tasks.mine', {}, 'req_week5_mine_001');
      assert.ok(Array.isArray(mine.items));
    },
    options,
  );
});

test('W5-JF-R13-04 a committed dated request still replays after midnight', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const w = world(nativeDb);
      const payload = { taskId: 'task_walk', transition: 'select', expectedDate: DATE_ONE };
      const first = await w.transition(payload, 'req_week5_dated_001');
      assert.equal(first.state, 'selected');
      w.setNow(DAY_TWO);
      const replay = await w.transition(payload, 'req_week5_dated_001');
      assert.equal(replay.replayed, true);
      assert.equal(replay.date, DATE_ONE);
      // Same requestId with a different date binding cannot be smuggled in.
      await assert.rejects(
        w.transition({ ...payload, expectedDate: DATE_TWO }, 'req_week5_dated_001'),
        (error) => error.code === 'CONFLICT',
      );
      assert.equal(w.rows(inspect()).length, 1);
      assert.equal(w.receipts(inspect()).length, 1);
    },
    options,
  );
});

test('W5-JF-R13-05 switching accounts never replays the previous owner request', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const w = world(nativeDb);
      await w.transition({ taskId: 'task_walk', transition: 'select' }, 'req_week5_shared_001');
      await w.transition({ taskId: 'task_walk', transition: 'complete' }, 'req_week5_shared_002');

      // The same requestId under another owner is a fresh operation, not a replay.
      const beta = await w.transition(
        { taskId: 'task_water', transition: 'select' },
        'req_week5_shared_002',
        OWNER_B,
      );
      assert.equal(beta.replayed, false);
      assert.equal(beta.state, 'selected');

      const betaHistory = await w.history(OWNER_B);
      assert.equal(betaHistory.entries.length, 1);
      assert.equal(betaHistory.entries[0].taskId, 'task_water');
      const alphaRows = w.rows(inspect()).filter((row) => row.ownerId === OWNER_A);
      const betaRows = w.rows(inspect()).filter((row) => row.ownerId === OWNER_B);
      assert.equal(alphaRows.length, 1);
      assert.equal(betaRows.length, 1);
      // Alpha's committed completion is invisible to Beta.
      assert.ok(betaHistory.entries.every((entry) => entry.taskId !== 'task_walk'));
    },
    options,
  );
});
