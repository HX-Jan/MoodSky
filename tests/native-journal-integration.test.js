const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { LAYOUT } = require('../tools/journal-storage/cloudbase-candidate');
const now = () => new Date('2026-10-23T04:00:00.000Z');
const account = (id, openid) => ({
  _id: id,
  openid,
  status: 'active',
  journalLayout: LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
});
const seed = () => ({
  'accounts:synthetic_a': account('synthetic_a', 'synthetic_openid_a'),
  'accounts:synthetic_b': account('synthetic_b', 'synthetic_openid_b'),
});
function client(db, nativeDb, options = {}) {
  const router = createWeek2Backend({
    ...(nativeDb ? { nativeDb } : { db }),
    receiptPolicy: createSyntheticReceiptPolicy(),
    now,
    ...options,
  });
  let serial = 0;
  return (action, payload, requestId = 'req_native_' + ++serial, openid = 'synthetic_openid_a') =>
    router({ apiVersion: '1', requestId, action, payload }, { OPENID: openid });
}
const save = (extra) => ({ date: '2026-10-23', weather: 'SUNNY', expectedVersion: 0, ...extra });

for (const nativeDatabase of [false, true]) {
  test(
    'assembled journal account-fence conflict: ' +
      (nativeDatabase ? 'native retries' : 'WX loses category'),
    async () => {
      let injected = false;
      await withOfflineWxDatabase(
        seed(),
        async ({ db, nativeDb, calls, inspect }) => {
          const result = await client(db, nativeDb)('journal.upsert', save());
          assert.equal(result.ok, nativeDatabase, JSON.stringify(result));
          if (!nativeDatabase) {
            assert.equal(result.error.code, 'INTERNAL_ERROR');
          }
          const starts = calls.filter((call) => call.action === 'database.startTransaction');
          assert.equal(starts.length, nativeDatabase ? 2 : 1);
          assert.equal(inspect()['accounts:synthetic_a'].journalRevision, nativeDatabase ? 1 : 0);
        },
        {
          nativeDatabase,
          fail: (action, params) => {
            if (
              action === 'database.modifyDocument' &&
              params.collectionName === 'accounts' &&
              !injected
            ) {
              injected = true;
              return 'DATABASE_TRANSACTION_CONFLICT';
            }
            return null;
          },
        },
      );
    },
  );
}

test('native journal backend keeps private custom weather, cross-month reads, replay and delete/recreate generations', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ db, nativeDb, inspect }) => {
      const call = client(db, nativeDb);
      const input = save({
        weather: 'CUSTOM',
        weatherName: '合成彩虹😀',
        text: 'SYNTHETIC private',
        tags: ['REST'],
      });
      const first = await call('journal.upsert', input, 'req_native_first');
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.data.entry.weatherName, '合成彩虹😀');
      assert.equal((await call('journal.upsert', input, 'req_native_first')).data.entry.version, 1);
      const previous = await call(
        'journal.upsert',
        save({ date: '2026-09-30', weather: 'TYPHOON' }),
      );
      assert.equal(previous.ok, true);
      const october = await call('review.monthArchive', { month: '2026-10' });
      assert.equal(october.data.cards[0].weatherName, input.weatherName);
      assert.doesNotMatch(JSON.stringify(october), /SYNTHETIC private|REST|ownerId|openid/);
      assert.equal((await call('review.calendar', { month: '2026-09' })).data.recordCount, 1);
      const other = await call(
        'journal.get',
        { date: input.date },
        undefined,
        'synthetic_openid_b',
      );
      assert.equal(other.data.entry, null);
      const edit = await call('journal.upsert', save({ expectedVersion: 1 }));
      assert.equal(edit.data.entry.id, first.data.entry.id);
      assert.equal(edit.data.entry.weatherName, undefined);
      const deletion = await call('journal.delete', { date: input.date, expectedVersion: 2 });
      assert.equal(deletion.data.deleted, true);
      assert.equal((await call('review.calendar', { month: '2026-10' })).data.recordCount, 0);
      const recreated = await call('journal.upsert', save());
      assert.equal(recreated.data.entry.version, 4);
      assert.notEqual(recreated.data.entry.id, first.data.entry.id);
      assert.equal(
        (await call('journal.upsert', input, 'req_native_first')).error.code,
        'CONFLICT',
      );
      assert.equal(inspect()['accounts:synthetic_a'].journalRevision, 5);
      assert.equal(inspect()['accounts:synthetic_b'].journalRevision, 0);
    },
    { nativeDatabase: true },
  );
});

for (const code of ['SYS_ERR', 'SYNTHETIC_UNMAPPED_CODE', -501001]) {
  test(
    'native journal fails closed and retains original request recovery for ' + code,
    async () => {
      let inject = true;
      await withOfflineWxDatabase(
        seed(),
        async ({ db, nativeDb, calls, inspect }) => {
          const call = client(db, nativeDb);
          const before = inspect();
          const result = await call('journal.upsert', save(), 'req_native_uncertain');
          assert.equal(result.error.code, 'INTERNAL_ERROR');
          assert.doesNotMatch(JSON.stringify(result), /synthetic_a|transport failure/);
          assert.equal(
            calls.filter((call) => call.action === 'database.startTransaction').length,
            1,
          );
          assert.deepEqual(inspect(), before);
          inject = false;
          const recovery = await call('journal.upsert', save(), 'req_native_uncertain');
          assert.equal(recovery.data.entry.version, 1);
          assert.equal(inspect()['accounts:synthetic_a'].journalRevision, 1);
        },
        {
          nativeDatabase: true,
          fail: (action, params) =>
            inject && action === 'database.modifyDocument' && params.collectionName === 'accounts'
              ? code
              : null,
        },
      );
    },
  );
}

test('native new-account layout is still opt-in and initialized once without changing existing accounts', async () => {
  await withOfflineWxDatabase(
    seed(),
    async ({ db, nativeDb, inspect }) => {
      const closed = client(db, nativeDb);
      const result = await closed(
        'journal.get',
        { date: '2026-10-23' },
        undefined,
        'synthetic_new_openid',
      );
      assert.equal(result.error.code, 'NOT_IMPLEMENTED');
      assert.equal(Object.keys(inspect()).length, 2);
      const enabled = client(db, nativeDb, {
        accountUniqueIndexReady: true,
        newAccountJournalLayout: LAYOUT,
      });
      const created = await enabled('journal.upsert', save(), undefined, 'synthetic_new_openid');
      assert.equal(created.ok, true, JSON.stringify(created));
      const rows = Object.values(inspect()).filter((row) => row.openid === 'synthetic_new_openid');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].journalLayout, LAYOUT);
      assert.equal(rows[0].journalRevision, 1);
      assert.equal(inspect()['accounts:synthetic_a'].journalRevision, 0);
      assert.throws(() => createWeek2Backend({ db, nativeDb }), /never both/);
    },
    { nativeDatabase: true },
  );
});

test('native account disabled and unmigrated layout gates remain enforced', async () => {
  for (const [override, expected] of [
    [{ status: 'disabled' }, 'ACCOUNT_DISABLED'],
    [{ journalLayout: 'legacy' }, 'NOT_IMPLEMENTED'],
  ]) {
    const rows = seed();
    Object.assign(rows['accounts:synthetic_a'], override);
    await withOfflineWxDatabase(
      rows,
      async ({ db, nativeDb, inspect }) => {
        const before = inspect();
        const result = await client(db, nativeDb)('journal.upsert', save());
        assert.equal(result.error.code, expected);
        assert.deepEqual(inspect(), before);
      },
      { nativeDatabase: true },
    );
  }
});

test('native optional public catalogue keeps projections and never resolves an account', async () => {
  const row = {
    _id: 'synthetic_template',
    enabled: true,
    title: '合成任务',
    steps: ['合成步骤'],
    durationMin: 5,
    tags: ['indoor'],
    ownerId: 'SYNTHETIC_SECRET',
  };
  await withOfflineWxDatabase(
    { ['task_templates:' + row._id]: row },
    async ({ db, nativeDb, calls }) => {
      const call = client(db, nativeDb, { taskSuggestionsEnabled: true });
      const result = await call('tasks.suggestions', {});
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.items[0].taskId, row._id);
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|ownerId/);
      assert(calls.every((item) => item.params.collectionName === 'task_templates'));
      const before = calls.length;
      assert.throws(() => db.collection('operator_roles'), /Unsupported journal/);
      assert.equal(calls.length, before);
    },
    { nativeDatabase: true },
  );
});
