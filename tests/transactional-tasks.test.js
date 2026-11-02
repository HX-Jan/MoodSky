// Locked native SDK + synthetic transport. No real cloud/data isolation claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createNativeJournalDatabase } = require('../tools/journal-storage/native-database');
const {
  createTransactionalTasksStore,
  TASK_LAYOUT,
  historyId,
  receiptId,
} = require('../cloudfunctions/moodsky/stores/transactional-tasks');
const { createTasksDomain } = require('../cloudfunctions/moodsky/services/tasks-candidate');
const { createRepository } = require('../cloudfunctions/moodsky/domains/repository');
const NOW = '2026-10-25T04:00:00.000Z';
const DATE = '2026-10-25';
const OWNER = 'synthetic_task_owner';
const account = (patch = {}) => ({
  _id: OWNER,
  openid: 'synthetic_openid',
  status: 'active',
  journalLayout: 'deterministic-days-v1',
  taskLayout: TASK_LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
  ...patch,
});
const seed = (patch = {}) => ({
  ['accounts:' + OWNER]: account(),
  'task_templates:task_a': {
    _id: 'task_a',
    enabled: true,
    title: '合成测试 A',
    steps: ['仅测试'],
    durationMin: 2,
    tags: [],
  },
  'task_templates:task_b': {
    _id: 'task_b',
    enabled: true,
    title: '合成测试 B',
    steps: ['仅测试'],
    durationMin: 2,
    tags: [],
  },
  ...patch,
});
function world(nativeDb) {
  const db = createNativeJournalDatabase(nativeDb, { taskHistoryEnabled: true });
  const store = createTransactionalTasksStore({ db });
  const domain = createTasksDomain({ store, clock: () => new Date(NOW) });
  const call = (transition = 'select', requestId = 'req_tasks_001', extra = {}) =>
    domain.handle({
      action: 'tasks.transition',
      actor: { accountId: OWNER },
      requestId,
      payload: { taskId: 'task_a', transition, ...extra },
    });
  const history = (payload = {}) =>
    domain.handle({
      action: 'tasks.history',
      actor: { accountId: OWNER },
      payload: { from: DATE, to: DATE, ...payload },
    });
  return { db, store, domain, call, history };
}
const options = (extra) => ({
  nativeDatabase: true,
  taskStoreReads: true,
  conflictScope: 'written-documents',
  ...extra,
});
const historyRows = (data) =>
  Object.entries(data)
    .filter(([key]) => key.startsWith('task_history:'))
    .map(([, row]) => row);
const receipts = (data) =>
  Object.entries(data).filter(([key]) => key.startsWith('request_receipts:'));

test('task native candidate commits history and receipt atomically, replays and keeps first timestamp', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect, calls }) => {
      const { call, history } = world(nativeDb);
      assert.equal((await call()).state, 'selected');
      assert.equal((await call()).replayed, true);
      await assert.rejects(call('skip'), (error) => error.code === 'CONFLICT');
      assert.equal((await call('complete', 'req_tasks_002')).state, 'completed');
      const rows = historyRows(inspect());
      assert.equal(rows.length, 1);
      assert.equal(rows[0]._id, historyId(OWNER, 'task_a', DATE));
      assert.equal(rows[0].createdAt, NOW);
      assert.equal(receipts(inspect()).length, 2);
      assert.equal(inspect()['accounts:' + OWNER].exportEpoch, 2);
      assert.equal((await history()).entries[0].state, 'completed');
      assert.ok(
        calls
          .filter((c) => c.params.transactionId && c.action === 'database.getDocument')
          .every((c) => JSON.parse(c.params.query)._id),
      );
    },
    options(),
  );
});

for (const stage of ['task_history', 'request_receipts', 'accounts']) {
  test('task native failure rolls back all writes at ' + stage, async () => {
    let injected = false;
    await withOfflineWxDatabase(
      seed(),
      async ({ nativeDb, inspect }) => {
        const { call } = world(nativeDb);
        const original = inspect();
        await assert.rejects(call(), (error) => error.code === 'SYS_ERR');
        assert.deepEqual(inspect(), original);
        assert.equal((await call()).replayed, false);
        assert.equal(historyRows(inspect()).length, 1);
        assert.equal(receipts(inspect()).length, 1);
      },
      options({
        fail: (action, params) => {
          if (
            !injected &&
            action === 'database.modifyDocument' &&
            params.collectionName === stage
          ) {
            injected = true;
            return 'SYS_ERR';
          }
          return null;
        },
      }),
    );
  });
}

test('parallel native requests retry the shared fence and keep a single daily task row', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect, calls }) => {
      const { call } = world(nativeDb);
      const result = await Promise.all([
        call('select', 'req_parallel_a'),
        call('select', 'req_parallel_b'),
      ]);
      assert.equal(
        result.every((row) => row.state === 'selected'),
        true,
      );
      assert.equal(historyRows(inspect()).length, 1);
      assert.equal(receipts(inspect()).length, 2);
      assert.equal(inspect()['accounts:' + OWNER].exportEpoch, 1);
      assert.ok(calls.filter((c) => c.action === 'database.startTransaction').length > 2);
    },
    options(),
  );
});

test('parallel requests with identical id create only one receipt and replay once', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const { call } = world(nativeDb);
      const result = await Promise.all([call(), call()]);
      assert.deepEqual(result.map((r) => r.replayed).sort(), [false, true]);
      assert.equal(receipts(inspect()).length, 1);
      assert.equal(historyRows(inspect()).length, 1);
    },
    options(),
  );
});

test('replace writes both rows with the receipt or rolls them all back', async () => {
  let injected = false;
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const { call } = world(nativeDb);
      await assert.rejects(call('replace', 'req_replace_1', { replacementTaskId: 'task_b' }));
      assert.equal(historyRows(inspect()).length, 0);
      assert.equal(receipts(inspect()).length, 0);
      const result = await call('replace', 'req_replace_1', { replacementTaskId: 'task_b' });
      assert.equal(result.replacementTaskId, 'task_b');
      assert.deepEqual(
        historyRows(inspect())
          .map((row) => row.state)
          .sort(),
        ['replaced', 'selected'],
      );
    },
    options({
      fail: (action, params) => {
        if (
          !injected &&
          action === 'database.modifyDocument' &&
          params.collectionName === 'task_history' &&
          JSON.parse(params.query)._id === historyId(OWNER, 'task_b', DATE)
        ) {
          injected = true;
          return 'SYS_ERR';
        }
        return null;
      },
    }),
  );
});

for (const patch of [
  { status: 'disabled' },
  { taskLayout: undefined },
  { journalLayout: 'legacy' },
  { operationFence: Number.MAX_SAFE_INTEGER },
]) {
  test('native private task gate refuses ' + JSON.stringify(patch), async () => {
    await withOfflineWxDatabase(
      seed({ ['accounts:' + OWNER]: account(patch) }),
      async ({ nativeDb, inspect }) => {
        const original = inspect();
        await assert.rejects(world(nativeDb).call(), (error) =>
          ['ACCOUNT_DISABLED', 'NOT_IMPLEMENTED', 'CONFLICT'].includes(error.code),
        );
        assert.deepEqual(inspect(), original);
      },
      options(),
    );
  });
}

test('legacy daily rows refuse mutation without overwriting retained data', async () => {
  await withOfflineWxDatabase(
    seed({
      'task_history:legacy': {
        _id: 'legacy',
        ownerId: OWNER,
        taskId: 'task_a',
        date: DATE,
        state: 'selected',
        createdAt: NOW,
      },
    }),
    async ({ nativeDb, inspect }) => {
      const original = inspect();
      await assert.rejects(world(nativeDb).call(), (error) => error.code === 'CONFLICT');
      assert.deepEqual(inspect(), original);
    },
    options(),
  );
});

test('history pagination is stable and excludes another owner', async () => {
  const foreignId = historyId('foreign_owner', 'task_b', DATE);
  await withOfflineWxDatabase(
    seed({
      ['task_history:' + foreignId]: {
        _id: foreignId,
        layout: TASK_LAYOUT,
        ownerId: 'foreign_owner',
        taskId: 'task_b',
        date: DATE,
        state: 'selected',
        createdAt: NOW,
      },
    }),
    async ({ nativeDb, inspect }) => {
      const { call, history } = world(nativeDb);
      await call();
      await call('select', 'req_other_task', { taskId: 'task_b' });
      const first = await history({ limit: 1 });
      assert.equal(first.entries.length, 1);
      assert.equal(typeof first.nextCursor, 'string');
      const second = await history({ limit: 1, cursor: first.nextCursor });
      assert.equal(second.entries.length, 1);
      assert.notEqual(second.entries[0].taskId, first.entries[0].taskId);
      assert.equal(second.nextCursor, null);
      assert.equal(inspect()['accounts:' + OWNER].journalRevision, 0);
    },
    options(),
  );
});

test('account disabled during a scan invalidates the old transaction and preserves no task writes', async () => {
  let scanned;
  const scanReached = new Promise((resolve) => {
    scanned = resolve;
  });
  let release;
  const waitForDisable = new Promise((resolve) => {
    release = resolve;
  });
  let paused = false;
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, inspect }) => {
      const { db, call } = world(nativeDb);
      const pending = call();
      await scanReached;
      await db.runTransaction(async (tx) => {
        await tx
          .collection('accounts')
          .doc(OWNER)
          .update({ data: { status: 'disabled' } });
      });
      release();
      await assert.rejects(pending, (error) => error.code === 'ACCOUNT_DISABLED');
      assert.equal(historyRows(inspect()).length, 0);
      assert.equal(receipts(inspect()).length, 0);
    },
    options({
      fail: async (action, params) => {
        if (
          !paused &&
          action === 'database.getDocument' &&
          !params.transactionId &&
          params.collectionName === 'task_history'
        ) {
          paused = true;
          scanned();
          await waitForDisable;
        }
        return null;
      },
    }),
  );
});

test('unknown native failures do not retry, and explicit transaction conflicts retry only within SDK limit', async () => {
  for (const code of ['UNKNOWN_NATIVE_FAILURE', 'DATABASE_TRANSACTION_CONFLICT']) {
    await withOfflineWxDatabase(
      seed(),
      async ({ nativeDb, inspect, calls }) => {
        await assert.rejects(world(nativeDb).call());
        assert.equal(historyRows(inspect()).length, 0);
        assert.equal(receipts(inspect()).length, 0);
        const attempts = calls.filter((c) => c.action === 'database.startTransaction').length;
        assert.ok(
          code === 'UNKNOWN_NATIVE_FAILURE' ? attempts === 1 : attempts > 1 && attempts <= 4,
        );
      },
      options({
        fail: (action, params) =>
          action === 'database.modifyDocument' && params.collectionName === 'accounts'
            ? code
            : null,
      }),
    );
  }
});

test('task-history collection remains closed without explicit native adapter opt-in', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb }) => {
      assert.throws(
        () => createNativeJournalDatabase(nativeDb).collection('task_history'),
        /Unsupported/,
      );
    },
    options(),
  );
});

test('only explicitly provisioned new accounts get task layout; existing rows are never migrated', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const db = createNativeJournalDatabase(nativeDb);
      assert.throws(() => createRepository({ db, newAccountTaskLayout: TASK_LAYOUT }), /explicit/);
      const repo = createRepository({
        db,
        accountUniqueIndexReady: true,
        newAccountJournalLayout: 'deterministic-days-v1',
        newAccountTaskLayout: TASK_LAYOUT,
      });
      const created = await repo.getOrCreateAccount('synthetic_new_openid');
      assert.equal(inspect()['accounts:' + created.id].taskLayout, TASK_LAYOUT);
    },
    options(),
  );
  await withOfflineWxDatabase(
    seed({ ['accounts:' + OWNER]: account({ taskLayout: undefined }) }),
    async ({ nativeDb, inspect }) => {
      const original = inspect();
      await createRepository({
        db: createNativeJournalDatabase(nativeDb),
        accountUniqueIndexReady: true,
        newAccountJournalLayout: 'deterministic-days-v1',
        newAccountTaskLayout: TASK_LAYOUT,
      }).getOrCreateAccount('synthetic_openid');
      assert.deepEqual(inspect(), original);
    },
    options(),
  );
});

test('receipt keys are scoped by owner/action and contain no raw identity', () => {
  assert.notEqual(
    receiptId(OWNER, 'tasks.transition', 'req_tasks_001'),
    receiptId('another_owner', 'tasks.transition', 'req_tasks_001'),
  );
  assert.notEqual(
    receiptId(OWNER, 'tasks.transition', 'req_tasks_001'),
    receiptId(OWNER, 'journal.upsert', 'req_tasks_001'),
  );
  assert.doesNotMatch(receiptId(OWNER, 'tasks.transition', 'req_tasks_001'), new RegExp(OWNER));
});

test('corrupt stored task receipts cannot manufacture a successful replay', async () => {
  const id = receiptId(OWNER, 'tasks.transition', 'req_tasks_001');
  for (const result of [
    1,
    { taskId: 'another_task', date: DATE, state: 'selected', replayed: false },
  ]) {
    const receipt = {
      _id: id,
      ownerId: OWNER,
      action: 'tasks.transition',
      requestId: 'req_tasks_001',
      layout: TASK_LAYOUT,
      digest: JSON.stringify(['task_a', 'select', null]),
      result,
    };
    await withOfflineWxDatabase(
      seed({ ['request_receipts:' + id]: receipt }),
      async ({ nativeDb, inspect }) => {
        const original = inspect();
        await assert.rejects(world(nativeDb).call(), (error) => error.code === 'CONFLICT');
        assert.deepEqual(inspect(), original);
      },
      options(),
    );
  }
});
