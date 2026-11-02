const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { planJournalRecovery } = require('../tools/journal-storage/recovery-plan');
const { LAYOUT } = require('../tools/journal-storage/cloudbase-candidate');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const ownerId = 'synthetic_recovery_native';
const accountKey = 'accounts:' + ownerId;
const seed = {
  [accountKey]: {
    _id: ownerId,
    openid: 'synthetic_recovery_openid',
    status: 'active',
    journalLayout: LAYOUT,
    journalRevision: 0,
    operationFence: 0,
    exportEpoch: 0,
  },
};
const input = {
  date: '2026-10-26',
  weather: 'CUSTOM',
  weatherName: '合成已删名字',
  text: 'SYNTHETIC recovery private writing',
  tags: ['REST'],
  expectedVersion: 0,
};
const request = (action, payload, requestId) => ({ apiVersion: '1', action, payload, requestId });
const context = { OPENID: 'synthetic_recovery_openid' };

test('native offline deletion markers drive a no-content recovery model and reject old successful receipt replay', async () => {
  let material;
  await withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      let instant = '2026-10-26T04:00:00.000Z';
      const router = createWeek2Backend({
        nativeDb,
        receiptPolicy: createSyntheticReceiptPolicy(),
        now: () => new Date(instant),
      });
      const first = await router(
        request('journal.upsert', input, 'req_recovery_original'),
        context,
      );
      assert.equal(first.ok, true);
      const backupState = inspect();
      const backupRow = Object.entries(backupState).find(([key]) => key.startsWith('journals:'));
      instant = '2026-10-26T04:01:00.000Z';
      const deleted = await router(
        request('journal.delete', { date: input.date, expectedVersion: 1 }, 'req_recovery_delete'),
        context,
      );
      assert.equal(deleted.data.deleted, true);
      const deletedState = inspect();
      const events = Object.entries(deletedState)
        .filter(([key]) => key.startsWith('deletion_markers:'))
        .map(([, row]) => row);
      assert.equal(events.length, 1);
      assert.equal(events[0].docId, backupRow[0].slice('journals:'.length));
      const source = {
        accountId: ownerId,
        cutoff: instant,
        backup: {
          ...backupState[accountKey],
          ownerId,
          layout: LAYOUT,
          snapshotAt: '2026-10-26T04:00:00.000Z',
          journals: [backupRow[1]],
        },
        ledger: {
          ...deletedState[accountKey],
          ownerId,
          accountStatus: 'active',
          independent: true,
          complete: true,
          from: '2026-10-26T04:00:00.000Z',
          through: instant,
          events,
        },
      };
      const before = JSON.stringify(source);
      const plan = planJournalRecovery(source);
      assert.equal(plan.status, 'plan');
      assert.equal(plan.mayOpenPrivateServices, false);
      assert.equal(plan.actions.length, 1);
      assert.doesNotMatch(JSON.stringify(plan), /合成已删名字|private writing|REST|weatherName/);
      assert.equal(JSON.stringify(source), before);

      // A later legitimate generation is preserved with the same actual deletion ledger.
      instant = '2026-10-26T04:02:00.000Z';
      const recreated = await router(
        request(
          'journal.upsert',
          { ...input, weatherName: '合成新的代际' },
          'req_recovery_recreated',
        ),
        context,
      );
      assert.equal(recreated.data.entry.version, 3);
      const current = inspect();
      const later = planJournalRecovery({
        ...source,
        cutoff: instant,
        backup: {
          ...current[accountKey],
          ownerId,
          layout: LAYOUT,
          snapshotAt: instant,
          journals: [current[backupRow[0]]],
        },
        ledger: { ...source.ledger, ...current[accountKey], through: instant },
      });
      assert.equal(later.status, 'plan');
      assert.equal(later.preservedActiveCount, 1);
      assert.deepEqual(later.actions, []);
      material = { plan, backupState, deletedState, oldEntryId: first.data.entry.id };
    },
    { nativeDatabase: true },
  );

  // Assemble a fresh SYNTHETIC database from the plan. This is not a production replay executor.
  const restored = globalThis.structuredClone(material.backupState);
  for (const action of material.plan.actions) {
    restored['journals:' + action.docId] = { ...action.replacement, _id: action.docId };
  }
  Object.assign(restored[accountKey], material.plan.minimumMetadata, {
    status: material.plan.accountStatusRequired,
    exportEpoch: material.plan.minimumMetadata.exportEpoch + 1,
  });
  for (const [key, value] of Object.entries(material.deletedState)) {
    if (key.startsWith('deletion_markers:')) {
      restored[key] = value;
    }
  }
  await withOfflineWxDatabase(
    restored,
    async ({ nativeDb, inspect }) => {
      const router = createWeek2Backend({
        nativeDb,
        receiptPolicy: createSyntheticReceiptPolicy(),
        now: () => new Date('2026-10-26T04:03:00.000Z'),
      });
      const before = inspect();
      assert.equal(
        (await router(request('journal.get', { date: input.date }, 'req_recovery_get'), context))
          .data.entry,
        null,
      );
      for (const [action, payload] of [
        ['review.calendar', { month: '2026-10' }],
        ['review.monthArchive', { month: '2026-10' }],
        ['review.timeline', { windowDays: 90 }],
        ['review.distribution', { windowDays: 90 }],
      ]) {
        const result = await router(
          request(action, payload, 'req_recovery_read_' + action.replace('.', '_')),
          context,
        );
        assert.equal(result.data.recordCount, 0);
        assert.doesNotMatch(JSON.stringify(result), /合成已删名字|private writing/);
      }
      const replay = await router(
        request('journal.upsert', input, 'req_recovery_original'),
        context,
      );
      assert.equal(replay.error.code, 'CONFLICT');
      assert.deepEqual(inspect(), before);
      const fresh = await router(
        request(
          'journal.upsert',
          { date: input.date, weather: 'SUNNY', expectedVersion: 0 },
          'req_recovery_fresh',
        ),
        context,
      );
      assert.equal(fresh.data.entry.version, 3);
      assert.notEqual(fresh.data.entry.id, material.oldEntryId);
    },
    { nativeDatabase: true },
  );
});
