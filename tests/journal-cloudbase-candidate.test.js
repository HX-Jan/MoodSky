const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCandidateRouter: createRouter,
} = require('../cloudfunctions/moodsky/candidate-router');
const {
  createCloudJournalRepository,
  LAYOUT,
  dayId,
  receiptId,
  decorationId,
} = require('../tools/journal-storage/cloudbase-candidate');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { error } = require('./helpers/backend-fixture');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const api = require('../miniprogram/services/api');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const ACCOUNT = 'synthetic_account_a';
const accountSeed = (overrides = {}) => ({
  ['accounts:' + ACCOUNT]: {
    _id: ACCOUNT,
    status: 'active',
    journalLayout: LAYOUT,
    journalRevision: 0,
    operationFence: 0,
    exportEpoch: 0,
    unrelated: 'SYNTHETIC preserved',
    ...overrides,
  },
});
function client(db, decorationCatalogue) {
  const repository = createCloudJournalRepository(db);
  const router = createRouter({
    journalRepository: repository,
    journalReceiptPolicy: createSyntheticReceiptPolicy(),
    decorationCatalogue,
    now: () => new Date('2026-10-18T00:00:00Z'),
    resolveAccount: async () => ({ id: ACCOUNT, status: 'active' }),
  });
  let serial = 0;
  return {
    repository,
    call: (action, payload, requestId = 'req_sdk_backend_' + ++serial) =>
      router({ apiVersion: '1', action, payload, requestId }, { OPENID: 'synthetic_trusted' }),
  };
}
const input = {
  date: '2026-10-18',
  weather: 'SUNNY',
  tags: ['REST'],
  text: 'SYNTHETIC secret writing',
  expectedVersion: 0,
};

test('cloud candidate refuses ambiguous or reversed stored timestamps instead of projecting them as valid records', async () => {
  const key = 'journals:' + dayId(ACCOUNT, input.date);
  const row = {
    layout: LAYOUT,
    ownerId: ACCOUNT,
    date: input.date,
    state: 'active',
    version: 1,
    entryId: 'synthetic_timestamp_entry',
    weather: input.weather,
    tags: input.tags,
    text: input.text,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  };
  for (const changes of [
    { createdAt: '1' },
    { updatedAt: '2026-02-30T00:00:00.000Z' },
    { updatedAt: '2026-10-18T08:00:00.000+08:00' },
    { updatedAt: '2026-10-17T23:59:59.999Z' },
  ]) {
    await withOfflineWxDatabase(
      { ...accountSeed(), [key]: { ...row, ...changes } },
      async ({ db }) => {
        error(await client(db).call('journal.get', { date: input.date }), 'INTERNAL_ERROR');
        error(await client(db).call('review.calendar', { month: '2026-10' }), 'INTERNAL_ERROR');
      },
    );
  }
});

test('cloud candidate crosses the locked SDK serialization boundary for save, read, delete and retry', async () => {
  await withOfflineWxDatabase(accountSeed(), async ({ db, calls, inspect }) => {
    const f = client(db);
    const saved = await f.call('journal.upsert', input, 'req_sdk_original');
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.data.entry.version, 1);
    assert.deepEqual(await f.call('journal.upsert', input, 'req_sdk_original'), saved);
    assert.deepEqual(
      (await f.call('journal.get', { date: input.date })).data.entry,
      saved.data.entry,
    );
    const afterSave = inspect();
    assert.equal(afterSave['accounts:' + ACCOUNT].journalRevision, 1);
    assert.equal(afterSave['accounts:' + ACCOUNT].operationFence, 2);
    assert.equal(afterSave['accounts:' + ACCOUNT].exportEpoch, 1);
    assert.equal(afterSave['accounts:' + ACCOUNT].unrelated, 'SYNTHETIC preserved');
    const receipt =
      afterSave['request_receipts:' + receiptId(ACCOUNT, 'journal.upsert', 'req_sdk_original')];
    assert.doesNotMatch(JSON.stringify(receipt), /secret writing|SUNNY|REST/);
    const deleted = await f.call(
      'journal.delete',
      { date: input.date, expectedVersion: 1 },
      'req_sdk_delete',
    );
    assert.equal(deleted.data.deleted, true);
    const tombstone = inspect()['journals:' + dayId(ACCOUNT, input.date)];
    assert.deepEqual(Object.keys(tombstone).sort(), [
      '_id',
      'date',
      'layout',
      'ownerId',
      'state',
      'version',
    ]);
    assert.equal(tombstone.state, 'deleted');
    assert.equal((await f.call('journal.get', { date: input.date })).data.entry, null);
    error(await f.call('journal.upsert', input, 'req_sdk_original'), 'CONFLICT');
    assert.ok(
      calls
        .filter(
          (call) =>
            call.action === 'database.modifyDocument' && call.params.collectionName === 'journals',
        )
        .every((call) => call.params.merge === false),
    );
  });
});

test('cloud candidate refuses unreviewed layouts and rechecks account status inside every transaction', async () => {
  for (const [overrides, expected] of [
    [{ journalLayout: undefined }, 'NOT_IMPLEMENTED'],
    [{ status: 'disabled' }, 'ACCOUNT_DISABLED'],
    [{ journalRevision: -1 }, 'INTERNAL_ERROR'],
  ]) {
    await withOfflineWxDatabase(accountSeed(overrides), async ({ db, calls }) => {
      const result = await client(db).call('journal.upsert', input);
      error(result, expected);
      assert.equal(calls.filter((call) => call.action === 'database.modifyDocument').length, 0);
    });
  }
  await withOfflineWxDatabase({}, async ({ db }) => {
    error(await client(db).call('journal.get', { date: input.date }), 'UNAUTHENTICATED');
  });
});

test('cloud candidate reads a 90-day consistent transaction without query defaults or pagination', async () => {
  await withOfflineWxDatabase(accountSeed(), async ({ db, calls }) => {
    const f = client(db);
    await f.call('journal.upsert', input);
    const start = calls.length;
    const view = await f.call('review.timeline', { windowDays: 90 });
    assert.equal(view.ok, true, JSON.stringify(view));
    assert.equal(view.data.recordCount, 1);
    assert.equal(view.data.sourceRevision, 1);
    const reads = calls.slice(start).filter((call) => call.action === 'database.getDocument');
    assert.equal(reads.length, 91);
    assert.equal(new Set(reads.map((call) => call.params.transactionId)).size, 1);
    assert.doesNotMatch(JSON.stringify(view), /secret writing|ownerId|REST/);
  });
});

test('cloud candidate rollback leaves no partial journal, receipt or source version on a write failure', async () => {
  await withOfflineWxDatabase(
    accountSeed(),
    async ({ db, inspect, calls }) => {
      const result = await client(db).call('journal.upsert', input);
      error(result, 'INTERNAL_ERROR');
      assert.deepEqual(inspect(), accountSeed());
      assert.ok(calls.some((call) => call.action === 'database.abortTransaction'));
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC injected|secret writing/);
    },
    {
      fail: (action, params) =>
        action === 'database.modifyDocument' && params.collectionName === 'request_receipts'
          ? 'SYS_ERR'
          : null,
    },
  );
});

test('cloud candidate uses only SDK conflict retries and reexecutes the transaction after a commit conflict', async () => {
  let conflicts = 0;
  await withOfflineWxDatabase(
    accountSeed(),
    async ({ db, inspect, calls }) => {
      const f = client(db);
      assert.equal((await f.call('journal.upsert', input)).ok, true);
      assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 1);
      assert.equal(calls.filter((call) => call.action === 'database.startTransaction').length, 2);
    },
    {
      fail: (action) =>
        action === 'database.commitTransaction' && conflicts++ === 0
          ? 'DATABASE_TRANSACTION_CONFLICT'
          : null,
    },
  );
});

test('cloud candidate never hides a mismatched owner/date or malformed stored receipt', async () => {
  const rowKey = 'journals:' + dayId(ACCOUNT, input.date);
  const seed = {
    ...accountSeed(),
    [rowKey]: {
      layout: LAYOUT,
      ownerId: 'synthetic_other',
      date: input.date,
      version: 1,
      state: 'deleted',
    },
  };
  await withOfflineWxDatabase(seed, async ({ db }) => {
    error(await client(db).call('journal.get', { date: input.date }), 'INTERNAL_ERROR');
  });
  const key = 'request_receipts:' + receiptId(ACCOUNT, 'journal.upsert', 'req_sdk_bad_receipt');
  await withOfflineWxDatabase(
    {
      ...accountSeed(),
      [key]: {
        layout: LAYOUT,
        ownerId: ACCOUNT,
        action: 'journal.upsert',
        requestId: 'req_sdk_bad_receipt',
        digest: 'bad',
        version: 1,
        entryId: 'synthetic_id',
      },
    },
    async ({ db }) => {
      error(
        await client(db).call('journal.upsert', input, 'req_sdk_bad_receipt'),
        'INTERNAL_ERROR',
      );
    },
  );
});

test('cloud candidate rejects unknown SDK missing-document policy and oversized snapshots before reads', async () => {
  assert.throws(() => createCloudJournalRepository({ runTransaction() {}, config: {} }), TypeError);
  await withOfflineWxDatabase(accountSeed(), async ({ db, calls }) => {
    const repository = createCloudJournalRepository(db);
    assert.throws(() =>
      repository.readSnapshot(ACCOUNT, { startDate: '2026-01-01', endDate: '2026-12-31' }),
    );
    assert.equal(calls.length, 0);
  });
});

test('cloud candidate SDK decorations share transactional owner checks and filter deleted targets', async () => {
  await withOfflineWxDatabase(accountSeed(), async ({ db, calls, inspect }) => {
    const f = client(db, { stickers: ['synthetic_s1'], backgrounds: ['synthetic_b1'] });
    const saved = await f.call('journal.upsert', input);
    const payload = {
      operation: 'replace',
      month: '2026-10',
      expectedVersion: 0,
      stickers: [{ stickerId: 'synthetic_s1', targetEntryId: saved.data.entry.id }],
      backgroundId: 'synthetic_b1',
    };
    const start = calls.length;
    const decorated = await f.call('review.decorations', payload, 'req_sdk_decor');
    assert.equal(decorated.ok, true, JSON.stringify(decorated));
    assert.deepEqual(await f.call('review.decorations', payload, 'req_sdk_decor'), decorated);
    assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 1);
    const row = inspect()['month_decorations:' + decorationId(ACCOUNT, '2026-10')];
    assert.equal(row.ownerId, ACCOUNT);
    assert.equal(row.version, 1);
    assert.doesNotMatch(JSON.stringify(row), /secret writing|REST/);
    const firstTxId = calls.slice(start).find((call) => call.action === 'database.getDocument')
      .params.transactionId;
    const operations = calls
      .slice(start)
      .filter(
        (call) =>
          call.params.transactionId === firstTxId &&
          ['database.getDocument', 'database.modifyDocument'].includes(call.action),
      );
    assert.ok(operations.length <= 38);
    assert.equal(inspect()['accounts:' + ACCOUNT].exportEpoch, 2);
    await f.call('journal.delete', { date: input.date, expectedVersion: 1 });
    const read = await f.call('review.decorations', { operation: 'get', month: '2026-10' });
    assert.deepEqual(read.data.stickers, []);
    assert.equal(read.data.version, 1);
    const replay = await f.call('review.decorations', payload, 'req_sdk_decor');
    assert.deepEqual(replay.data.stickers, []);
    assert.equal(inspect()['accounts:' + ACCOUNT].exportEpoch, 3);
    const markers = Object.values(inspect()).filter(
      (row) => row.collection === 'journals' && row.cleanupState === 'pending',
    );
    assert.equal(markers.length, 1);
    assert.equal(markers[0].entryId, saved.data.entry.id);
    assert.equal(markers[0].deletedVersion, 2);
    assert.doesNotMatch(JSON.stringify(markers), /secret writing|weather|REST/);
  });
});

test('cloud candidate preserves an expired receipt key instead of admitting a new mutation', async () => {
  const requestId = 'req_sdk_expired_marker';
  const key = receiptId(ACCOUNT, 'journal.upsert', requestId);
  const seed = {
    ...accountSeed(),
    ['request_receipts:' + key]: {
      _id: key,
      layout: LAYOUT,
      ownerId: ACCOUNT,
      action: 'journal.upsert',
      requestId,
      state: 'expired',
    },
  };
  await withOfflineWxDatabase(seed, async ({ db, calls, inspect }) => {
    error(await client(db).call('journal.upsert', input, requestId), 'CONFLICT');
    assert.equal(calls.filter((call) => call.action === 'database.modifyDocument').length, 0);
    assert.deepEqual(inspect(), seed);
  });
});

test('cloud candidate deletion marker, account metadata, tombstone and receipt roll back as one unit', async () => {
  let armed = false;
  await withOfflineWxDatabase(
    accountSeed(),
    async ({ db, inspect }) => {
      const f = client(db);
      await f.call('journal.upsert', input);
      const before = inspect();
      armed = true;
      const payload = { date: input.date, expectedVersion: 1 };
      error(await f.call('journal.delete', payload, 'req_sdk_delete_atomic'), 'INTERNAL_ERROR');
      assert.deepEqual(inspect(), before);
      armed = false;
      assert.equal(
        (await f.call('journal.delete', payload, 'req_sdk_delete_atomic')).data.deleted,
        true,
      );
      assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 2);
      assert.equal(inspect()['accounts:' + ACCOUNT].exportEpoch, 2);
      assert.equal(inspect()['accounts:' + ACCOUNT].operationFence, 2);
      assert.equal(
        Object.values(inspect()).filter((row) => row.cleanupState === 'pending').length,
        1,
      );
    },
    {
      fail: (action, params) =>
        armed &&
        action === 'database.modifyDocument' &&
        params.collectionName === 'request_receipts'
          ? 'SYS_ERR'
          : null,
    },
  );
});

test('cloud candidate locked SDK admits one of sixteen different-ID concurrent creates', async () => {
  await withOfflineWxDatabase(accountSeed(), async ({ db, inspect }) => {
    const f = client(db);
    const replies = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        f.call('journal.upsert', input, 'req_sdk_parallel_' + index),
      ),
    );
    assert.equal(replies.filter((reply) => reply.ok).length, 1);
    assert.ok(
      replies.filter((reply) => !reply.ok).every((reply) => reply.error.code === 'CONFLICT'),
    );
    assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 1);
    assert.equal(inspect()['accounts:' + ACCOUNT].exportEpoch, 1);
  });
});

test('cloud candidate bounded SDK retries preserve one business result under same-ID contention', async (t) => {
  await withOfflineWxDatabase(accountSeed(), async ({ db, inspect }) => {
    const f = client(db);
    const requestId = 'req_sdk_parallel_same';
    const replies = await Promise.all(
      Array.from({ length: 16 }, () => f.call('journal.upsert', input, requestId)),
    );
    const successes = replies.filter((reply) => reply.ok).length;
    const unknown = replies.filter((reply) => !reply.ok);
    assert.ok(successes >= 1);
    assert.ok(unknown.every((reply) => reply.error.code === 'INTERNAL_ERROR'));
    t.diagnostic(
      'SIMULATED SDK contention: ' +
        successes +
        ' confirmed, ' +
        unknown.length +
        ' retry-budget unknown; one journal mutation.',
    );
    for (let index = 0; index < replies.length; index++) {
      assert.equal((await f.call('journal.upsert', input, requestId)).ok, true);
    }
    assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 1);
    assert.equal(inspect()['accounts:' + ACCOUNT].exportEpoch, 1);
    assert.equal(inspect()['journals:' + dayId(ACCOUNT, input.date)].version, 1);
    error(
      await f.call('journal.upsert', { ...input, text: 'SYNTHETIC changed original' }, requestId),
      'CONFLICT',
    );
  });
});

test('locked SDK ambiguous write error crosses the real API validator and preserves the controller original request', async () => {
  let armed = true;
  await withOfflineWxDatabase(
    accountSeed(),
    async ({ db, inspect }) => {
      const f = client(db);
      const requests = [];
      const apiClient = api.createApiClient(
        {
          cloud: {
            callFunction: async ({ data }) => {
              requests.push(data);
              return { result: await f.call(data.action, data.payload, data.requestId) };
            },
          },
        },
        { cloudEnabled: true, cloudEnvId: 'synthetic_no_network' },
      );
      const service = {
        get: (date) => apiClient.call(api.createRequest('journal.get', { date })),
        createSaveRequest: (payload) => api.createRequest('journal.upsert', payload),
        createDeleteRequest: (payload) => api.createRequest('journal.delete', payload),
        submit: (request) => apiClient.call(request),
      };
      const controller = createJournalController({
        service,
        now: () => new Date('2026-10-18T00:00:00.000Z'),
      });
      await controller.loadDate();
      controller.chooseWeather('SUNNY');
      controller.setText('SIMULATED SDK boundary draft');
      assert.equal(await controller.save(), false);
      assert.equal(controller.getState().errorCode, 'INTERNAL_ERROR');
      assert.equal(controller.getState().pendingRetry, true);
      assert.equal(controller.getState().text, 'SIMULATED SDK boundary draft');
      const original = requests.at(-1);
      assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 0);
      armed = false;
      assert.equal(await controller.retry(), true);
      assert.equal(requests.at(-1), original);
      assert.equal(controller.getState().entry.version, 1);
      assert.equal(inspect()['accounts:' + ACCOUNT].journalRevision, 1);
      controller.dispose();
    },
    {
      fail: (action, params) =>
        armed &&
        action === 'database.modifyDocument' &&
        params.collectionName === 'request_receipts'
          ? 'DATABASE_TRANSACTION_CONFLICT'
          : null,
    },
  );
});
