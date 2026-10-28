const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTurn } = require('node:timers/promises');
const {
  createCloudJournalRepository,
  LAYOUT,
  dayId,
} = require('../tools/journal-storage/cloudbase-candidate');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const parallelRepository = (db) => createCloudJournalRepository(db, { snapshotReadBatchSize: 6 });
const owner = 'synthetic_parallel_snapshot';
const dates = Array.from({ length: 90 }, (_, i) =>
  new Date(Date.UTC(2026, 9, 27) - (89 - i) * 86400000).toISOString().slice(0, 10),
);
const range = { startDate: dates[0], endDate: dates.at(-1) };
function seed() {
  return {
    ['accounts:' + owner]: {
      _id: owner,
      openid: 'synthetic_parallel_openid',
      status: 'active',
      journalLayout: LAYOUT,
      journalRevision: 90,
      operationFence: 90,
      exportEpoch: 90,
    },
    ...Object.fromEntries(
      dates.map((date, i) => [
        'journals:' + dayId(owner, date),
        {
          _id: dayId(owner, date),
          layout: LAYOUT,
          ownerId: owner,
          date,
          state: 'active',
          version: 1,
          entryId: 'synthetic_parallel_' + i,
          weather: 'SUNNY',
          tags: ['REST'],
          text: 'SYNTHETIC PRIVATE SNAPSHOT',
          createdAt: date + 'T04:00:00.000Z',
          updatedAt: date + 'T04:00:00.000Z',
        },
      ]),
    ),
  };
}
const isDayRead = (action, params) =>
  params.collectionName === 'journals' &&
  ['database.getDocument', 'database.getInTransaction'].includes(action);

for (const nativeDatabase of [false, true]) {
  test(
    'snapshot overlaps bounded day reads in one locked SDK transaction: native=' + nativeDatabase,
    async () => {
      let active = 0;
      let peak = 0;
      let dispatched = 0;
      await withOfflineWxDatabase(
        seed(),
        async ({ db, calls, inspect }) => {
          const before = inspect();
          const result = await parallelRepository(db).readSnapshot(owner, range);
          assert.equal(result.revision, 90);
          assert.deepEqual(
            result.entries.map((row) => row.date),
            dates,
          );
          assert.equal(peak, 6);
          assert.equal(active, 0);
          assert.doesNotMatch(JSON.stringify(result), /PRIVATE|ownerId|tags|"text"/);
          const reads = calls.filter((call) => isDayRead(call.action, call.params));
          assert.equal(reads.length, 90);
          assert.equal(new Set(reads.map((call) => call.params.transactionId)).size, 1);
          assert.ok(reads.every((call) => call.params.transactionId));
          assert.equal(
            calls.filter((call) => call.action === 'database.commitTransaction').length,
            1,
          );
          assert.equal(calls.filter((call) => call.action === 'database.modifyDocument').length, 0);
          assert.deepEqual(inspect(), before);
        },
        {
          nativeDatabase,
          fail: async (action, params) => {
            if (!isDayRead(action, params)) {
              return null;
            }
            active++;
            peak = Math.max(peak, active);
            for (let i = 0, turns = 6 - (dispatched++ % 6); i < turns; i++) {
              await nextTurn();
            }
            active--;
            return null;
          },
        },
      );
    },
  );
}

test('decoration month marks share the bounded reader and preserve deleted/missing day projection', async () => {
  const input = seed();
  const date = '2026-10-02';
  input['journals:' + dayId(owner, date)] = {
    layout: LAYOUT,
    ownerId: owner,
    date,
    state: 'deleted',
    version: 2,
  };
  let active = 0;
  let peak = 0;
  await withOfflineWxDatabase(
    input,
    async ({ db, calls }) => {
      const marks = await parallelRepository(db).transact(owner, (tx) =>
        tx.listMonthMarks('2026-10'),
      );
      assert.equal(peak, 6);
      assert.deepEqual(
        marks.map((row) => row.date),
        dates.filter((day) => day.startsWith('2026-10') && day !== date),
      );
      assert.equal(calls.filter((call) => isDayRead(call.action, call.params)).length, 31);
      assert.doesNotMatch(JSON.stringify(marks), /PRIVATE|ownerId|tags|"text"/);
    },
    {
      nativeDatabase: true,
      fail: async (action, params) => {
        if (!isDayRead(action, params)) {
          return null;
        }
        active++;
        peak = Math.max(peak, active);
        await nextTurn();
        active--;
        return null;
      },
    },
  );
});

test('failed read drains every outstanding request before rollback and starts no next batch', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  let finished = false;
  await withOfflineWxDatabase(
    seed(),
    async ({ db, calls }) => {
      const result = parallelRepository(db)
        .readSnapshot(owner, range)
        .then(
          (value) => {
            finished = true;
            return { value };
          },
          (error) => {
            finished = true;
            return { error };
          },
        );
      try {
        for (let i = 0; i < 10 && started < 6; i++) {
          await nextTurn();
        }
        await nextTurn();
        assert.equal(started, 6);
        assert.equal(finished, false);
        assert.equal(calls.filter((call) => call.action === 'database.abortTransaction').length, 0);
      } finally {
        release();
        const outcome = await result;
        assert.equal(outcome.error.code, 'SYS_ERR');
      }
      assert.equal(started, 6);
      assert.equal(calls.filter((call) => call.action === 'database.abortTransaction').length, 1);
      assert.equal(calls.filter((call) => call.action === 'database.commitTransaction').length, 0);
    },
    {
      nativeDatabase: true,
      fail: async (action, params) => {
        if (!isDayRead(action, params)) {
          return null;
        }
        if (++started === 1) {
          return 'SYS_ERR';
        }
        await gate;
        return null;
      },
    },
  );
});

test('parallel reading remains opt-in, invalid limits fail before database access and disabled accounts never fan out', async () => {
  let active = 0;
  let peak = 0;
  await withOfflineWxDatabase(
    seed(),
    async ({ db, calls }) => {
      await createCloudJournalRepository(db).readSnapshot(owner, range);
      assert.equal(peak, 1);
      const count = calls.length;
      for (const value of [0, 7, -1, 1.5, '6', NaN, Infinity]) {
        assert.throws(
          () => createCloudJournalRepository(db, { snapshotReadBatchSize: value }),
          TypeError,
        );
      }
      assert.equal(calls.length, count);
    },
    {
      nativeDatabase: true,
      fail: async (action, params) => {
        if (!isDayRead(action, params)) {
          return null;
        }
        active++;
        peak = Math.max(peak, active);
        await nextTurn();
        active--;
        return null;
      },
    },
  );
  const disabled = seed();
  disabled['accounts:' + owner].status = 'disabled';
  await withOfflineWxDatabase(
    disabled,
    async ({ db, calls }) => {
      await assert.rejects(
        parallelRepository(db).readSnapshot(owner, range),
        (error) => error.code === 'ACCOUNT_DISABLED',
      );
      assert.equal(calls.filter((call) => isDayRead(call.action, call.params)).length, 0);
      assert.equal(calls.filter((call) => call.action === 'database.commitTransaction').length, 0);
    },
    { nativeDatabase: true },
  );
});

test('exact read conflict retries a fresh full snapshot only after its first batch drains', async () => {
  let dayReads = 0;
  let active = 0;
  await withOfflineWxDatabase(
    seed(),
    async ({ db, calls }) => {
      const result = await parallelRepository(db).readSnapshot(owner, range);
      assert.equal(result.entries.length, 90);
      assert.equal(dayReads, 96);
      assert.equal(calls.filter((call) => call.action === 'database.startTransaction').length, 2);
      assert.equal(calls.filter((call) => call.action === 'database.commitTransaction').length, 1);
    },
    {
      nativeDatabase: true,
      fail: async (action, params) => {
        if (action === 'database.startTransaction') {
          assert.equal(active, 0);
        }
        if (!isDayRead(action, params)) {
          return null;
        }
        const number = ++dayReads;
        active++;
        await nextTurn();
        active--;
        return number === 1 ? 'DATABASE_TRANSACTION_CONFLICT' : null;
      },
    },
  );
});

test('mixed conflict and unknown read failures preserve fatal errors instead of retrying a partial batch', async () => {
  for (const code of ['SYS_ERR', -501001]) {
    let reads = 0;
    await withOfflineWxDatabase(
      seed(),
      async ({ db, calls }) => {
        await assert.rejects(
          parallelRepository(db).readSnapshot(owner, range),
          (error) => error.code === code,
        );
        assert.equal(reads, 6);
        assert.equal(calls.filter((call) => call.action === 'database.startTransaction').length, 1);
        assert.equal(
          calls.filter((call) => call.action === 'database.commitTransaction').length,
          0,
        );
      },
      {
        nativeDatabase: true,
        fail: async (action, params) => {
          if (!isDayRead(action, params)) {
            return null;
          }
          const number = ++reads;
          await nextTurn();
          return number === 1 ? 'DATABASE_TRANSACTION_CONFLICT' : number === 6 ? code : null;
        },
      },
    );
  }
});

test('parallel day requests keep a complete old snapshot when another transaction commits a newer revision', async () => {
  const input = seed();
  let update;
  let changed = false;
  await withOfflineWxDatabase(
    input,
    async ({ db }) => {
      update = () =>
        db.runTransaction(async (tx) => {
          await tx
            .collection('accounts')
            .doc(owner)
            .update({ data: { journalRevision: 91, operationFence: 91, exportEpoch: 91 } });
          const { _id, ...last } = input['journals:' + dayId(owner, dates.at(-1))];
          await tx
            .collection('journals')
            .doc(_id)
            .set({ data: { ...last, version: 2, weather: 'RAINY' } });
        });
      const repository = parallelRepository(db);
      const before = await repository.readSnapshot(owner, range);
      assert.equal(before.revision, 90);
      assert.ok(before.entries.every((row) => row.weather === 'SUNNY'));
      const after = await repository.readSnapshot(owner, range);
      assert.equal(after.revision, 91);
      assert.equal(after.entries.at(-1).weather, 'RAINY');
    },
    {
      nativeDatabase: true,
      conflictScope: 'written-documents',
      fail: async (action, params) => {
        if (isDayRead(action, params) && !changed) {
          changed = true;
          await update();
        }
        return null;
      },
    },
  );
});

test('native backend enables batching only from server construction and rejects client tuning fields', async () => {
  let active = 0;
  let peak = 0;
  await withOfflineWxDatabase(
    seed(),
    async ({ nativeDb, calls }) => {
      const options = { nativeDb, now: () => new Date('2026-10-27T04:00:00.000Z') };
      const current = createWeek2Backend(options);
      const context = { OPENID: 'synthetic_parallel_openid' };
      const request = (payload) => ({
        apiVersion: '1',
        action: 'review.timeline',
        requestId: 'req_snapshot_server_config',
        payload,
      });
      const denied = await current(request({ windowDays: 90, snapshotReadBatchSize: 6 }), context);
      assert.equal(denied.error.code, 'INVALID_INPUT');
      assert.equal(calls.filter((call) => isDayRead(call.action, call.params)).length, 0);
      const sequential = await current(request({ windowDays: 90 }), context);
      assert.equal(sequential.ok, true);
      assert.equal(peak, 1);
      peak = 0;
      const candidate = createWeek2Backend({ ...options, snapshotReadBatchSize: 6 });
      const parallel = await candidate(request({ windowDays: 90 }), context);
      assert.equal(parallel.ok, true);
      assert.equal(peak, 6);
      assert.deepEqual(parallel.data, sequential.data);
    },
    {
      nativeDatabase: true,
      fail: async (action, params) => {
        if (!isDayRead(action, params)) {
          return null;
        }
        active++;
        peak = Math.max(peak, active);
        await nextTurn();
        active--;
        return null;
      },
    },
  );
});
