const test = require('node:test');
const assert = require('node:assert/strict');
const { planJournalRecovery } = require('../tools/journal-storage/recovery-plan');
const { LAYOUT } = require('../tools/journal-storage/cloudbase-candidate');
function fixture() {
  const ownerId = 'synthetic_recovery_owner';
  return {
    accountId: ownerId,
    cutoff: '2026-10-18T02:00:00.000Z',
    backup: {
      ownerId,
      layout: LAYOUT,
      snapshotAt: '2026-10-18T00:00:00.000Z',
      journalRevision: 1,
      operationFence: 1,
      exportEpoch: 1,
      journals: [
        {
          layout: LAYOUT,
          ownerId,
          date: '2026-10-18',
          state: 'active',
          version: 1,
          entryId: 'synthetic_old',
          weather: 'SUNNY',
          tags: ['REST'],
          text: 'SYNTHETIC deleted writing',
          createdAt: '2026-10-17T23:00:00.000Z',
          updatedAt: '2026-10-17T23:00:00.000Z',
        },
      ],
    },
    ledger: {
      ownerId,
      independent: true,
      complete: true,
      from: '2026-10-17T00:00:00.000Z',
      through: '2026-10-18T02:00:00.000Z',
      accountStatus: 'active',
      journalRevision: 2,
      operationFence: 4,
      exportEpoch: 2,
      events: [
        {
          ownerId,
          date: '2026-10-18',
          entryId: 'synthetic_old',
          deletedVersion: 2,
          deletedAt: '2026-10-18T01:00:00.000Z',
        },
      ],
    },
  };
}

test('recovery preflight refuses incomplete or malformed active storage rows instead of planning to preserve them', () => {
  for (const patch of [
    { layout: undefined },
    { layout: 'legacy_random_ids' },
    { tags: undefined },
    { text: undefined },
    { createdAt: undefined },
    { updatedAt: undefined },
    { createdAt: '1' },
    { createdAt: '2026-02-30T00:00:00.000Z' },
    { updatedAt: '2026-10-17T22:59:59.999Z' },
  ]) {
    const f = fixture();
    f.ledger.events = [];
    Object.assign(f.backup.journals[0], patch);
    const result = planJournalRecovery(f);
    assert.equal(result.status, 'blocked', JSON.stringify(patch));
    assert.equal(result.reason, 'BACKUP_ROWS_INVALID');
    assert.equal(result.mayOpenPrivateServices, false);
    assert.deepEqual(result.actions, []);
    assert.doesNotMatch(JSON.stringify(result), /deleted writing|SUNNY|REST/);
  }
});

test('recovery preflight rejects timestamp-bearing tombstones just as the storage reader does', () => {
  for (const field of ['createdAt', 'updatedAt']) {
    const f = fixture();
    f.backup.journals = [
      {
        layout: LAYOUT,
        ownerId: f.accountId,
        date: '2026-10-18',
        state: 'deleted',
        version: 2,
        [field]: '2026-10-18T01:00:00.000Z',
      },
    ];
    const result = planJournalRecovery(f);
    assert.equal(result.reason, 'BACKUP_TOMBSTONE_CONTAINS_CONTENT');
    assert.equal(result.mayOpenPrivateServices, false);
    assert.deepEqual(result.actions, []);
  }
});

test('recovery preflight plans a no-body generation tombstone and never opens services', () => {
  const input = fixture();
  const original = JSON.stringify(input);
  const plan = planJournalRecovery(input);
  assert.equal(plan.status, 'plan');
  assert.equal(plan.mayOpenPrivateServices, false);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].replacement.version, 2);
  assert.equal(plan.actions[0].replacement.state, 'deleted');
  assert.equal(plan.minimumMetadata.exportEpoch, 2);
  assert.doesNotMatch(JSON.stringify(plan), /deleted writing|SUNNY|REST/);
  assert.equal(JSON.stringify(input), original);
});

test('recovery preflight refuses a rolled-back or incomplete deletion ledger and missing watermarks', () => {
  const f = fixture();
  for (const change of [
    { independent: false },
    { complete: false },
    { from: '2026-10-18T00:00:00.001Z' },
    { through: '2026-10-18T01:59:59.999Z' },
    { journalRevision: undefined },
  ]) {
    const result = planJournalRecovery({ ...f, ledger: { ...f.ledger, ...change } });
    assert.equal(result.status, 'blocked');
    assert.equal(result.mayOpenPrivateServices, false);
    assert.equal(result.actions.length, 0);
  }
});

test('recovery replay is idempotent for day tombstones and preserves a legitimate later generation', () => {
  const f = fixture();
  const plan = planJournalRecovery(f);
  f.backup.journals = plan.actions.map((action) => action.replacement);
  assert.equal(planJournalRecovery(f).actions.length, 0);
  f.backup.journals = [
    {
      ...fixture().backup.journals[0],
      entryId: 'synthetic_recreated',
      version: 3,
      text: 'SYNTHETIC newer writing',
    },
  ];
  const result = planJournalRecovery(f);
  assert.equal(result.status, 'plan');
  assert.equal(result.actions.length, 0);
  assert.equal(result.preservedActiveCount, 1);
});

test('recovery restores missing version tombstones instead of allowing generation one again', () => {
  const f = fixture();
  f.backup.journals = [];
  const result = planJournalRecovery(f);
  assert.equal(result.actions[0].operation, 'create-missing-tombstone');
  assert.equal(result.actions[0].replacement.version, 2);
  assert.equal(result.actions[0].expectedVersion, 0);
});

test('recovery refuses reused deleted IDs, malformed tombstones and contradictory ledger events', () => {
  const f = fixture();
  f.backup.journals[0].version = 3;
  assert.equal(planJournalRecovery(f).reason, 'DELETED_ID_REUSED_OR_GENERATION_CORRUPT');
  const content = fixture();
  content.backup.journals[0].state = 'deleted';
  assert.equal(planJournalRecovery(content).reason, 'BACKUP_TOMBSTONE_CONTAINS_CONTENT');
  const contradictory = fixture();
  contradictory.ledger.events.push({ ...contradictory.ledger.events[0], date: '2026-10-17' });
  assert.equal(planJournalRecovery(contradictory).reason, 'DELETION_LEDGER_CONTRADICTION');
});

test('recovery carries authoritative disabled status and rejects cross-account or unknown layouts', () => {
  const f = fixture();
  f.ledger.accountStatus = 'disabled';
  assert.equal(planJournalRecovery(f).accountStatusRequired, 'disabled');
  assert.equal(planJournalRecovery({ ...f, accountId: 'synthetic_other' }).status, 'blocked');
  assert.equal(
    planJournalRecovery({ ...f, backup: { ...f.backup, layout: 'legacy_random_ids' } }).status,
    'blocked',
  );
  f.ledger.events.push({ ...f.ledger.events[0] });
  assert.equal(planJournalRecovery(f).distinctDeletionEvents, 1);
});

test('recovery blocks inconsistent identities sharing a deleted generation instead of planning destructive guesses', () => {
  const f = fixture();
  f.backup.journals[0].entryId = 'synthetic_different_id';
  f.backup.journals[0].version = 2;
  assert.equal(planJournalRecovery(f).reason, 'ACTIVE_DELETION_GENERATION_COLLISION');
  for (const change of [{ entryId: 'synthetic_collision' }, { deletedVersion: 4 }]) {
    const conflict = fixture();
    conflict.ledger.events.push({ ...conflict.ledger.events[0], ...change });
    assert.equal(planJournalRecovery(conflict).reason, 'DELETION_LEDGER_CONTRADICTION');
  }
});

test('recovery rejects a deleted identity moved to another date even when its original day is absent', () => {
  for (const version of [1, 3]) {
    const f = fixture();
    f.backup.journals[0].date = '2026-10-17';
    f.backup.journals[0].version = version;
    const result = planJournalRecovery(f);
    assert.equal(result.reason, 'DELETED_ID_MOVED_TO_ANOTHER_DATE');
    assert.equal(result.mayOpenPrivateServices, false);
    assert.deepEqual(result.actions, []);
  }
});
