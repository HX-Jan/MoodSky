// W3 JF05 — source revision writer (export precondition). Local doubles only.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAccountDataSources,
  createSourceRevisionWriter,
  nextRevisions,
  SOURCE_DOMAINS,
} = require('../cloudfunctions/moodsky/services/account-data');
const { databaseFixture } = require('./helpers/w2-database');

const OWNER = 'account_w3_revision_owner';
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

function fixture(row = accountRow(), options) {
  return databaseFixture({ ['accounts:' + OWNER]: row }, options);
}

test('S01 every domain increments without touching the others', () => {
  for (const domain of SOURCE_DOMAINS) {
    const next = nextRevisions({ ...REVISIONS }, domain, REVISIONS.journals);
    assert.equal(next[domain], REVISIONS[domain] + 1, domain);
    for (const other of SOURCE_DOMAINS) {
      if (other !== domain) {
        assert.equal(next[other], REVISIONS[other], domain + '/' + other);
      }
    }
  }
});

test('S02 invalid maps and unknown domains fail closed', () => {
  assert.throws(() => nextRevisions({ ...REVISIONS }, 'diary', 3), { code: 'INVALID_INPUT' });
  assert.throws(() => nextRevisions(null, 'tasks', 3), { code: 'NOT_IMPLEMENTED' });

  const missing = { ...REVISIONS };
  delete missing.decorations;
  assert.throws(() => nextRevisions(missing, 'tasks', 3), { code: 'CONFLICT' });
  assert.throws(() => nextRevisions({ ...REVISIONS, tasks: -1 }, 'tasks', 3), { code: 'CONFLICT' });
  assert.throws(() => nextRevisions({ ...REVISIONS, tasks: 1.5 }, 'tasks', 3), {
    code: 'CONFLICT',
  });
  // journals must stay in step with journalRevision; a mismatch means the row is
  // inconsistent and an export must not trust any of it.
  assert.throws(() => nextRevisions({ ...REVISIONS }, 'tasks', 4), { code: 'CONFLICT' });
});

test('S03 the writer updates the account row inside the caller transaction', async () => {
  const f = fixture();
  const writer = createSourceRevisionWriter({ db: f.db });
  const result = await f.db.runTransaction((tx) => writer(OWNER, 'tasks', tx));
  assert.deepEqual(result.sourceRevisions, { ...REVISIONS, tasks: 5 });
  const row = f.inspect()['accounts:' + OWNER];
  assert.deepEqual(row.sourceRevisions, { ...REVISIONS, tasks: 5 });
  // The journal revision and the account fences are untouched by a source bump.
  assert.equal(row.journalRevision, 3);
  assert.equal(row.operationFence, 0);
  assert.equal(row.exportEpoch, 2);
});

test('S04 readSourceState observes a revision written by the same transaction', async () => {
  const f = fixture();
  const writer = createSourceRevisionWriter({ db: f.db });
  const sources = createAccountDataSources({ db: f.db });
  const observed = await f.db.runTransaction(async (tx) => {
    await writer(OWNER, 'preferences', tx);
    return sources.readSourceState(OWNER, tx);
  });
  assert.equal(observed.revisions.preferences, 3);
  assert.equal(observed.revisions.journals, 3);
});

test('S05 without a transaction the writer opens one and still validates', async () => {
  const f = fixture();
  const writer = createSourceRevisionWriter({ db: f.db });
  await writer(OWNER, 'decorations');
  assert.equal(f.inspect()['accounts:' + OWNER].sourceRevisions.decorations, 1);
  await assert.rejects(writer(OWNER, 'nope'), { code: 'INVALID_INPUT' });
  assert.equal(f.inspect()['accounts:' + OWNER].sourceRevisions.decorations, 1);
});

test('S06 disabled and legacy accounts cannot advance a revision', async () => {
  const disabled = fixture(accountRow({ status: 'disabled' }));
  await assert.rejects(createSourceRevisionWriter({ db: disabled.db })(OWNER, 'tasks'), {
    code: 'ACCOUNT_DISABLED',
  });

  const legacyRow = accountRow();
  delete legacyRow.sourceRevisions;
  const legacy = fixture(legacyRow);
  await assert.rejects(createSourceRevisionWriter({ db: legacy.db })(OWNER, 'tasks'), {
    code: 'NOT_IMPLEMENTED',
  });
});

test('S07 a lost update is a conflict, never a silent success', async () => {
  // A storage error propagates; the row is unchanged, so nothing claims success.
  const failing = fixture(accountRow(), {
    fail: ({ operation }) => operation === 'update',
  });
  await assert.rejects(createSourceRevisionWriter({ db: failing.db })(OWNER, 'tasks'));
  assert.deepEqual(failing.inspect()['accounts:' + OWNER].sourceRevisions, { ...REVISIONS });

  // A successful-looking write that updated no row is a conflict.
  const f = fixture();
  const zeroUpdate = {
    ...f.db,
    runTransaction: (work) =>
      f.db.runTransaction((tx) =>
        work({
          collection: (name) => ({
            doc: (id) => ({
              get: () => tx.collection(name).doc(id).get(),
              update: async () => ({ stats: { updated: 0 } }),
            }),
          }),
        }),
      ),
  };
  await assert.rejects(createSourceRevisionWriter({ db: zeroUpdate })(OWNER, 'tasks'), {
    code: 'CONFLICT',
  });
  assert.deepEqual(f.inspect()['accounts:' + OWNER].sourceRevisions, { ...REVISIONS });
});

test('S08 an overflow of the counter is rejected', () => {
  const atLimit = { ...REVISIONS, tasks: Number.MAX_SAFE_INTEGER };
  assert.throws(() => nextRevisions(atLimit, 'tasks', 3), { code: 'CONFLICT' });
});
