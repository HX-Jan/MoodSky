// W4 JF05 - candidate collections stay out of the production account-deletion path.
// Synthetic local doubles only: no real cloud, storage or cleanup executor.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  createProductionCleanup,
  COLLECTIONS: PRODUCTION_COLLECTIONS,
} = require('../cloudfunctions/moodsky/production/cleanup');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const { createCleanupService, markerId } = require('../cloudfunctions/moodsky/domains/cleanup');
const { LINK_LAYOUT } = require('../cloudfunctions/moodsky/stores/task-checkin-links');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');

const OWNER = 'synthetic_isolation_owner';
const OTHER = 'synthetic_isolation_other';
const JOB = 'synthetic_isolation_job';
// The collections the simulated target environment has actually deployed.
// `task_checkin_links` is deliberately absent: database/collections.json still
// marks it SOURCE PLAN ONLY / Not deployed, so querying it must fail there.
const PRESENT = [
  'journals',
  'favorites',
  'place_checkins',
  'campus_checkin_states',
  'task_history',
  'preferences',
  'month_decorations',
  'request_receipts',
  'export_jobs',
  'place_corrections',
];
const AVAILABLE = [
  ...PRESENT,
  'accounts',
  'cleanup_jobs',
  'deletion_markers',
  'places',
  'task_templates',
];
const row = (collection) => ({
  _id: 'synthetic_' + collection,
  ownerId: OWNER,
  privateBody: '合成待清理内容',
});
const productionSeed = (changes = {}) => ({
  ['accounts:' + OWNER]: {
    _id: OWNER,
    identityKind: 'wechat-hmac-v1',
    status: 'disabled',
    journalLayout: 'deterministic-days-v1',
  },
  ['cleanup_jobs:' + JOB]: {
    _id: JOB,
    ownerId: OWNER,
    state: 'pending',
    exportAccessRevoked: true,
    progress: {},
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
  },
  ...Object.fromEntries(
    PRESENT.map((collection) => [collection + ':synthetic_' + collection, row(collection)]),
  ),
  ['places:public_place']: { _id: 'public_place', name: '公共地点资料' },
  ['task_templates:public_template']: {
    _id: 'public_template',
    enabled: true,
    title: '公共任务模板',
  },
  ...changes,
});
// Models the deployed environment: a collection missing from AVAILABLE behaves
// like an undeployed collection and rejects every access instead of answering
// "empty", which is what the real target environment does.
function targetEnvironment(seed) {
  const f = databaseFixture(seed);
  const deployed = (name) => {
    if (!AVAILABLE.includes(name)) {
      throw new TypeError('Collection is not deployed in the target environment: ' + name);
    }
    return name;
  };
  return {
    calls: f.calls,
    inspect: f.inspect,
    db: {
      config: f.db.config,
      command: f.db.command,
      serverDate: f.db.serverDate,
      collection: (name) => f.db.collection(deployed(name)),
      runTransaction: (work) =>
        f.db.runTransaction((tx) => work({ collection: (name) => tx.collection(deployed(name)) })),
    },
  };
}
const drain = async (cleanup, jobId) => {
  let result;
  for (let count = 0; count < 30; count++) {
    result = await cleanup.step(jobId);
    if (result.state === 'completed') {
      return result;
    }
  }
  return result;
};
function assertCleaned(rows, result) {
  assert.equal(result.state, 'completed');
  assert.equal(result.jobId, JOB);
  assert.deepEqual(Object.keys(result.progress).sort(), [...PRESENT].sort());
  PRESENT.forEach((collection) => assert.equal(result.progress[collection], 1, collection));
  PRESENT.forEach((collection) =>
    assert.equal(rows[collection + ':synthetic_' + collection], undefined, collection),
  );
  assert.equal(rows['places:public_place'].name, '公共地点资料');
  assert.equal(rows['task_templates:public_template'].enabled, true);
  // Only the (completed) job row keeps the closed owner.
  assert.deepEqual(
    Object.entries(rows)
      .filter(([, value]) => value.ownerId === OWNER)
      .map(([key]) => key),
    ['cleanup_jobs:' + JOB],
  );
  assert.equal(rows['accounts:' + OWNER].status, 'disabled');
}

test('JF05-W4-10 a target environment without task_checkin_links still completes production cleanup', async () => {
  const env = targetEnvironment(productionSeed());
  const cleanup = createProductionCleanup({ db: env.db });
  const result = await drain(cleanup, JOB);
  assertCleaned(env.inspect(), result);
  // The missing collection was never queried: no silent empty answer, no retry.
  assert.equal(
    env.calls.some((call) => call.collection === 'task_checkin_links'),
    false,
  );
  PRESENT.forEach((collection) =>
    assert.ok(
      env.calls.some((call) => call.collection === collection && call.operation === 'query'),
      collection,
    ),
  );
  // A drained job repeats its terminal projection without re-querying.
  assert.deepEqual(await cleanup.step(JOB), result);

  // The installed production adapter drains the same environment offline.
  await withOfflineWxDatabase(
    productionSeed(),
    async ({ nativeDb, inspect }) => {
      const drained = await drain(
        createProductionCleanup({ db: createProductionDatabase(nativeDb) }),
        JOB,
      );
      assertCleaned(inspect(), drained);
    },
    { nativeDatabase: true, productionMaintenanceReads: true },
  );
});

test('JF05-W4-11 permission and network failures on an existing collection abort cleanup', async (t) => {
  const failingRead = (collection, code) => (action, params) =>
    action === 'database.getDocument' &&
    !params.transactionId &&
    params.collectionName === collection
      ? code
      : null;
  await t.test('PERMISSION_DENIED', async () => {
    await withOfflineWxDatabase(
      productionSeed(),
      async ({ nativeDb, inspect }) => {
        const cleanup = createProductionCleanup({ db: createProductionDatabase(nativeDb) });
        await assert.rejects(cleanup.step(JOB), { code: 'PERMISSION_DENIED' });
        const job = inspect()['cleanup_jobs:' + JOB];
        assert.equal(job.state, 'pending');
        assert.equal(Object.hasOwn(job.progress, 'journals'), false);
        assert.equal(inspect()['journals:synthetic_journals'].ownerId, OWNER);
        // The scheduler records the failure as a retry instead of completing the job.
        assert.deepEqual(await cleanup.tick(), { examined: 1, completed: 0, retry: 1 });
      },
      {
        nativeDatabase: true,
        productionMaintenanceReads: true,
        fail: failingRead('journals', 'PERMISSION_DENIED'),
      },
    );
  });
  await t.test('network failure', async () => {
    await withOfflineWxDatabase(
      productionSeed(),
      async ({ nativeDb, inspect }) => {
        const cleanup = createProductionCleanup({ db: createProductionDatabase(nativeDb) });
        // journals drains first; the next collection then fails at transport level.
        assert.equal((await cleanup.step(JOB)).progress.journals, 1);
        await assert.rejects(cleanup.step(JOB), { code: 'NETWORK_ERROR' });
        const job = inspect()['cleanup_jobs:' + JOB];
        assert.equal(job.state, 'processing');
        assert.equal(Object.hasOwn(job.progress, 'favorites'), false);
        assert.equal(inspect()['favorites:synthetic_favorites'].ownerId, OWNER);
      },
      {
        nativeDatabase: true,
        productionMaintenanceReads: true,
        fail: failingRead('favorites', 'NETWORK_ERROR'),
      },
    );
  });
});

test('JF05-W4-12 candidate cleanup still deletes only the closing owner links', async () => {
  const ownerLinkId = createHash('sha256').update(OWNER).digest('hex');
  const otherLinkId = createHash('sha256').update(OTHER).digest('hex');
  const linkDoc = (id, ownerId) => ({
    _id: id,
    layout: LINK_LAYOUT,
    owner: ownerId,
    ownerId,
    links: [
      {
        requestId: 'req_isolation_' + ownerId,
        digest: JSON.stringify(['tpl_isolation', 'place_isolation']),
        taskId: 'tpl_isolation',
        placeId: 'place_isolation',
        status: 'committed',
        createdAt: '2026-11-07T00:00:00.000Z',
      },
    ],
    requests: [],
    revision: 1,
  });
  const f = databaseFixture({
    ['accounts:' + OWNER]: { _id: OWNER, status: 'disabled' },
    ['cleanup_jobs:' + JOB]: {
      _id: JOB,
      ownerId: OWNER,
      state: 'pending',
      progress: {},
      exportAccessRevoked: true,
    },
    ['task_checkin_links:' + ownerLinkId]: linkDoc(ownerLinkId, OWNER),
    ['task_checkin_links:' + otherLinkId]: linkDoc(otherLinkId, OTHER),
    ['places:place_public']: { _id: 'place_public', name: '公共地点资料' },
    ['task_templates:tpl_public']: { _id: 'tpl_public', enabled: true },
  });
  const result = await createCleanupService({ db: f.db }).executeAccountCleanup(OWNER, {
    jobId: JOB,
    batchSize: 10,
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.progress.task_checkin_links, 1);
  assert.equal(result.totalDeleted, 1);
  const rows = f.inspect();
  assert.equal(rows['task_checkin_links:' + ownerLinkId], undefined);
  assert.ok(rows['task_checkin_links:' + otherLinkId]);
  assert.equal(rows['places:place_public'].name, '公共地点资料');
  assert.ok(rows['task_templates:tpl_public']);
  const marker = rows['deletion_markers:' + markerId(OWNER, 'task_checkin_links', ownerLinkId)];
  assert.deepEqual(
    { ownerId: marker.ownerId, collection: marker.collection, docId: marker.docId },
    { ownerId: OWNER, collection: 'task_checkin_links', docId: ownerLinkId },
  );
  assert.equal(JSON.stringify(marker).includes('place_isolation'), false);
});

test('JF05-W4-13 production cleanup never references the candidate collection', async () => {
  assert.equal(PRODUCTION_COLLECTIONS.includes('task_checkin_links'), false);
  assert.deepEqual(PRODUCTION_COLLECTIONS, [
    'journals',
    'favorites',
    'place_checkins',
    'campus_checkin_states',
    'task_history',
    'preferences',
    'month_decorations',
    'request_receipts',
    'export_jobs',
    'deletion_markers',
    'place_corrections',
  ]);
  // `database/collections.json` still marks the candidate as Not deployed: the
  // production adapter must refuse it, and the offline double must not silently
  // answer its queries either.
  await withOfflineWxDatabase(
    productionSeed(),
    async ({ nativeDb }) => {
      assert.throws(
        () => createProductionDatabase(nativeDb).collection('task_checkin_links'),
        /Unknown production collection/,
      );
      await assert.rejects(
        nativeDb
          .collection('task_checkin_links')
          .where({ ownerId: OWNER })
          .orderBy('_id', 'asc')
          .limit(10)
          .get(),
      );
    },
    { nativeDatabase: true, productionMaintenanceReads: true },
  );
});
