// W4 JF05 follow-up - candidate export sources stay isolated from the production
// export path. task_checkin_links is SOURCE PLAN ONLY / Not deployed, so the
// default export must never query it; only an explicit includeCandidateSources
// opt-in may read it. Synthetic local doubles only: no real cloud or storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { LINK_LAYOUT } = require('../cloudfunctions/moodsky/stores/task-checkin-links');
const { databaseFixture } = require('./helpers/w2-database');

const NOW = () => new Date('2026-11-07T04:00:00.000Z');
const account = (id) => ({
  _id: id,
  status: 'active',
  operationFence: 0,
  exportEpoch: 1,
  journalRevision: 1,
});
const journal = (ownerId) => ({
  _id: 'journal_one',
  ownerId,
  date: '2026-11-05',
  weather: 'sunny',
  weatherName: '晴',
  tags: [],
  text: '今天的合成记录。',
  version: 1,
  state: 'active',
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T00:00:00.000Z',
});
const linkRow = (taskId, placeId, linkedAt) => ({
  requestId: 'req_w4_isolation_' + taskId,
  digest: JSON.stringify([taskId, placeId]),
  taskId,
  placeId,
  status: 'committed',
  createdAt: '2026-11-05T00:00:00.000Z',
  result: { taskId, placeId, linkedDate: '2026-11-05', linkedAt },
});
const linkDoc = (ownerId, links, requests = []) => ({
  _id: createHash('sha256').update(ownerId).digest('hex'),
  layout: LINK_LAYOUT,
  owner: ownerId,
  ownerId,
  links,
  requests,
  revision: 1,
});
const readSourceState = async (id, tx) => {
  const row = (await tx.collection('accounts').doc(id).get()).data;
  return {
    ownerId: id,
    status: row.status,
    epoch: row.exportEpoch,
    revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
  };
};
const service = (db, extra = {}) =>
  createExportService({ db, readSourceState, maxRecords: 100, now: NOW, ...extra });
// Every owner-scoped page read goes through db.collection(name).where(...).get().
// f.calls records that collection name, which is what the isolation assertions use.
const queriedCollections = (f) =>
  f.calls.filter(({ operation }) => operation === 'query').map(({ collection }) => collection);
// A db double whose journal reads fail with the given transport/permission error.
const journalFailingDb = (f, error) => ({
  ...f.db,
  collection(name) {
    if (name !== 'journals') {
      return f.db.collection(name);
    }
    return Object.assign(f.db.collection(name), {
      where() {
        throw error;
      },
    });
  },
});
const codedError = (message, errCode) =>
  Object.assign(new Error(message), { errCode, errMsg: message });

test('JF05-W4-ISO-01 the default export never queries the undeployed candidate collection', async () => {
  const ownerId = 'synthetic_w4_iso_default_owner';
  const f = databaseFixture({
    ['accounts:' + ownerId]: account(ownerId),
    ['journals:journal_one']: journal(ownerId),
    // The candidate collection does exist in this synthetic store, so a query
    // would return the link document if the default path ever read it.
    ['task_checkin_links:' + createHash('sha256').update(ownerId).digest('hex')]: linkDoc(ownerId, [
      linkRow('tpl_default', 'place_default', '2026-11-05T01:00:00.000Z'),
    ]),
  });
  const result = await service(f.db).gatherExportData(ownerId);

  assert.equal(result.journals.length, 1);
  assert.equal(Object.hasOwn(result, 'taskCheckins'), false);
  const queried = queriedCollections(f);
  // Sanity check that the recording double is effective: the deployed journal
  // source was read, while the candidate collection never was.
  assert.ok(queried.includes('journals'), JSON.stringify(queried));
  assert.equal(queried.includes('task_checkin_links'), false, JSON.stringify(queried));
});

test('JF05-W4-ISO-02 a permission or network error on a deployed source fails the export', async () => {
  const ownerId = 'synthetic_w4_iso_error_owner';
  for (const [label, error] of [
    ['permission', codedError('permission denied by database rules', -502003)],
    ['network', codedError('request timeout while reading the database', -1)],
  ]) {
    const f = databaseFixture({
      ['accounts:' + ownerId]: account(ownerId),
      ['journals:journal_one']: journal(ownerId),
    });
    await assert.rejects(
      service(journalFailingDb(f, error)).gatherExportData(ownerId),
      /permission denied|request timeout/,
      label,
    );
  }
});

test('JF05-W4-ISO-03 an opt-in export reads the candidate collection and keeps only the owner rows', async () => {
  const ownerId = 'synthetic_w4_iso_optin_owner';
  const otherId = 'synthetic_w4_iso_optin_other';
  const pending = {
    requestId: 'req_w4_isolation_pending',
    digest: JSON.stringify(['tpl_hidden', 'place_hidden']),
    taskId: 'tpl_hidden',
    placeId: 'place_hidden',
    status: 'pending',
    createdAt: '2026-11-05T00:00:00.000Z',
  };
  const f = databaseFixture({
    ['accounts:' + ownerId]: account(ownerId),
    ['accounts:' + otherId]: account(otherId),
    ['task_checkin_links:' + createHash('sha256').update(ownerId).digest('hex')]: linkDoc(
      ownerId,
      [linkRow('tpl_owner', 'place_owner', '2026-11-05T01:00:00.000Z')],
      [pending],
    ),
    ['task_checkin_links:' + createHash('sha256').update(otherId).digest('hex')]: linkDoc(otherId, [
      linkRow('tpl_other', 'place_other', '2026-11-05T02:00:00.000Z'),
    ]),
  });
  const optIn = service(f.db, { includeCandidateSources: true });

  const result = await optIn.gatherExportData(ownerId);
  assert.deepEqual(result.taskCheckins, [
    {
      ownerId,
      taskId: 'tpl_owner',
      placeId: 'place_owner',
      linkedDate: '2026-11-05',
      linkedAt: '2026-11-05T01:00:00.000Z',
    },
  ]);
  // Only the five minimal association keys, never requests/digest/layout or the
  // other owner's committed association.
  assert.deepEqual(Object.keys(result.taskCheckins[0]).sort(), [
    'linkedAt',
    'linkedDate',
    'ownerId',
    'placeId',
    'taskId',
  ]);
  assert.equal(Object.hasOwn(result, 'task_checkin_links'), false);
  assert.doesNotMatch(
    JSON.stringify(result.taskCheckins),
    /req_w4_isolation|pending|hidden|digest|layout|requests|place_other|tpl_other/,
  );
  assert.ok(queriedCollections(f).includes('task_checkin_links'));

  const other = await optIn.gatherExportData(otherId);
  assert.deepEqual(other.taskCheckins, [
    {
      ownerId: otherId,
      taskId: 'tpl_other',
      placeId: 'place_other',
      linkedDate: '2026-11-05',
      linkedAt: '2026-11-05T02:00:00.000Z',
    },
  ]);
});

test('JF05-W4-ISO-04 an opt-in export fails explicitly when the candidate collection is missing', async () => {
  const ownerId = 'synthetic_w4_iso_missing_owner';
  const f = databaseFixture({
    ['accounts:' + ownerId]: account(ownerId),
    ['journals:journal_one']: journal(ownerId),
  });
  // Model the real CloudBase behaviour for an undeployed collection (errCode
  // -502005) instead of a silent empty result. A synthetic store cannot model
  // absence, so this double throws at the collection handle.
  const missing = {
    ...f.db,
    collection(name) {
      if (name !== 'task_checkin_links') {
        return f.db.collection(name);
      }
      throw codedError('database collection not exists', -502005);
    },
  };
  // The default path still succeeds: the missing collection is irrelevant while
  // the candidate channel stays closed.
  assert.equal((await service(missing).gatherExportData(ownerId)).journals.length, 1);
  // Opt-in with a collection the environment never created must fail loudly
  // (CONFLICT), never look like an owner without associations.
  await assert.rejects(
    service(missing, { includeCandidateSources: true }).gatherExportData(ownerId),
    {
      code: 'CONFLICT',
    },
  );
});

test('JF05-W4-ISO-05 a non-boolean opt-in flag is rejected instead of falling back to the default', () => {
  const f = databaseFixture({});
  for (const invalid of ['true', 1, null, {}]) {
    assert.throws(() => service(f.db, { includeCandidateSources: invalid }), TypeError);
  }
});
