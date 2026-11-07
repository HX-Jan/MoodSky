// W4 JF05 - export coverage and close cleanup for check-ins (Jiawei Fang).
// Synthetic local doubles only: no real cloud, storage or cleanup executor.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createCleanupService, markerId } = require('../cloudfunctions/moodsky/domains/cleanup');
const { createExportService } = require('../cloudfunctions/moodsky/domains/export');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production/index');
const {
  accountId,
  sessionScope,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');
const { LINK_LAYOUT } = require('../cloudfunctions/moodsky/stores/task-checkin-links');
const { databaseFixture } = require('./helpers/w2-database');

const OWNER = 'synthetic_w4_cleanup_owner';
const OTHER = 'synthetic_w4_cleanup_other';
const JOB = 'synthetic_w4_cleanup_job';
const options = { jobId: JOB, batchSize: 10 };
const seed = (changes = {}) => ({
  ['accounts:' + OWNER]: { _id: OWNER, status: 'disabled' },
  ['cleanup_jobs:' + JOB]: {
    _id: JOB,
    ownerId: OWNER,
    state: 'pending',
    progress: {},
    exportAccessRevoked: true,
  },
  ...changes,
});
const checkin = (id, ownerId = OWNER, extra = {}) => ({
  _id: id,
  ownerId,
  placeId: 'fzu-qishan-fuyou-pavilion',
  date: '2026-11-05',
  completedAt: '2026-11-04T16:00:00.000Z',
  ...extra,
});
const legacy = (id, ownerId = OWNER) => ({
  _id: id,
  ownerId,
  owner: ownerId,
  visits: [
    {
      placeId: 'fzu-qishan-wangshu-lake',
      date: '2026-11-04',
      completedAt: '2026-11-04T00:00:00.000Z',
    },
  ],
  requests: [],
  revision: 1,
});

test('JF05-W4-01 close cleanup removes the owner check-ins and keeps public material', async () => {
  const f = databaseFixture(
    seed({
      ['place_checkins:' + 'checkin_a']: checkin('checkin_a'),
      ['place_checkins:' + 'checkin_b']: checkin('checkin_b', OWNER, {
        placeId: 'fzu-qishan-wangshu-lake',
        date: '2026-11-04',
      }),
      ['place_checkins:' + 'checkin_other']: checkin('checkin_other', OTHER),
      ['campus_checkin_states:' + 'legacy_owner']: legacy('legacy_owner'),
      ['campus_checkin_states:' + 'legacy_other']: legacy('legacy_other', OTHER),
      ['task_templates:' + 'tpl_public']: {
        _id: 'tpl_public',
        title: '公共任务模板',
        enabled: true,
      },
      ['places:' + 'place_public']: { _id: 'place_public', name: '公共地点资料' },
    }),
  );
  const service = createCleanupService({ db: f.db });
  const result = await service.executeAccountCleanup(OWNER, options);
  assert.equal(result.state, 'completed');
  assert.equal(result.progress.place_checkins, 2);
  assert.equal(result.progress.campus_checkin_states, 1);
  assert.equal(result.totalDeleted, 3);

  const rows = f.inspect();
  assert.equal(rows['place_checkins:checkin_a'], undefined);
  assert.equal(rows['place_checkins:checkin_b'], undefined);
  assert.equal(rows['campus_checkin_states:legacy_owner'], undefined);
  assert.ok(rows['place_checkins:checkin_other']);
  assert.ok(rows['campus_checkin_states:legacy_other']);
  assert.ok(rows['task_templates:tpl_public']);
  assert.ok(rows['places:place_public']);

  // The deletion ledger carries metadata only, never place text or owner payloads.
  const marker = rows['deletion_markers:' + markerId(OWNER, 'place_checkins', 'checkin_a')];
  assert.deepEqual(
    { ownerId: marker.ownerId, collection: marker.collection, docId: marker.docId },
    { ownerId: OWNER, collection: 'place_checkins', docId: 'checkin_a' },
  );
  assert.equal(JSON.stringify(marker).includes('fzu-qishan'), false);
});

test('JF05-W4-02 repeating a completed close returns the same persisted result', async () => {
  const f = databaseFixture(
    seed({
      ['place_checkins:checkin_a']: checkin('checkin_a'),
      ['campus_checkin_states:legacy_owner']: legacy('legacy_owner'),
    }),
  );
  const service = createCleanupService({ db: f.db });
  const first = await service.executeAccountCleanup(OWNER, options);
  const second = await service.executeAccountCleanup(OWNER, options);
  assert.deepEqual(second, first);
  assert.equal(f.inspect()['cleanup_jobs:' + JOB].state, 'completed');
  assert.equal(f.inspect()['cleanup_jobs:' + JOB].totalDeleted, 2);
});

test('JF05-W4-03 a partial failure leaves committed counts and a retry finishes once', async () => {
  let armed = true;
  const f = databaseFixture(
    seed({
      ['place_checkins:checkin_a']: checkin('checkin_a'),
      ['place_checkins:checkin_b']: checkin('checkin_b'),
      ['campus_checkin_states:legacy_owner']: legacy('legacy_owner'),
    }),
    {
      fail: ({ operation, collection }) => {
        if (armed && operation === 'remove' && collection === 'campus_checkin_states') {
          armed = false;
          return true;
        }
        return false;
      },
    },
  );
  const service = createCleanupService({ db: f.db });
  await assert.rejects(service.executeAccountCleanup(OWNER, options), /SIMULATED_FAILURE/);
  const job = f.inspect()['cleanup_jobs:' + JOB];
  assert.notEqual(job.state, 'completed');
  assert.equal(job.progress.place_checkins, 2);
  assert.equal(job.progress.campus_checkin_states, undefined);
  assert.equal(Object.hasOwn(job, 'totalDeleted'), false);
  assert.ok(f.inspect()['campus_checkin_states:legacy_owner']);

  const result = await service.executeAccountCleanup(OWNER, options);
  assert.equal(result.state, 'completed');
  assert.equal(result.progress.place_checkins, 2);
  assert.equal(result.progress.campus_checkin_states, 1);
  assert.equal(result.totalDeleted, 3);
  assert.equal(f.inspect()['campus_checkin_states:legacy_owner'], undefined);
  assert.deepEqual(await service.executeAccountCleanup(OWNER, options), result);
});

test('JF05-W4-04 an active account or foreign job cannot delete check-ins', async () => {
  const active = databaseFixture(
    seed({
      ['accounts:' + OWNER]: { _id: OWNER, status: 'active' },
      ['place_checkins:checkin_a']: checkin('checkin_a'),
    }),
  );
  await assert.rejects(
    createCleanupService({ db: active.db }).executeAccountCleanup(OWNER, options),
    { code: 'FORBIDDEN' },
  );
  assert.ok(active.inspect()['place_checkins:checkin_a']);

  const foreign = databaseFixture(
    seed({
      ['cleanup_jobs:' + JOB]: {
        _id: JOB,
        ownerId: OTHER,
        state: 'pending',
        progress: {},
        exportAccessRevoked: true,
      },
      ['place_checkins:checkin_a']: checkin('checkin_a'),
    }),
  );
  await assert.rejects(
    createCleanupService({ db: foreign.db }).executeAccountCleanup(OWNER, options),
    { code: 'FORBIDDEN' },
  );
  assert.ok(foreign.inspect()['place_checkins:checkin_a']);
});

test('JF05-W4-05 export covers check-ins and task history without inventing a link', async () => {
  const ownerId = 'synthetic_w4_export_owner';
  const f = databaseFixture({
    ['accounts:' + ownerId]: {
      _id: ownerId,
      status: 'active',
      operationFence: 0,
      exportEpoch: 1,
      journalRevision: 1,
    },
    ['place_checkins:checkin_one']: checkin('checkin_one', ownerId),
    ['campus_checkin_states:legacy_one']: legacy('legacy_one', ownerId),
    ['task_history:task_one']: {
      _id: 'task_one',
      ownerId,
      taskId: 'task_a',
      taskTitle: '给朋友发条消息',
      date: '2026-11-05',
      state: 'completed',
      createdAt: '2026-11-04T16:10:00.000Z',
    },
    ['favorites:favorite_one']: {
      _id: 'favorite_one',
      ownerId,
      placeId: 'fzu-qishan-fuyou-pavilion',
      placeName: '福友阁',
      createdAt: '2026-11-05T00:00:00.000Z',
    },
    ['preferences:pref_' + ownerId]: {
      _id: 'pref_' + ownerId,
      ownerId,
      cardTextPreview: true,
      decorationsEnabled: false,
      updatedAt: '2026-11-05T00:00:00.000Z',
    },
    ['month_decorations:decoration_one']: {
      _id: 'decoration_one',
      ownerId,
      month: '2026-11',
      version: 1,
      stickers: [],
      backgroundId: 'bg-1',
    },
  });
  const source = async (id, tx) => {
    const account = (await tx.collection('accounts').doc(id).get()).data;
    return {
      ownerId: id,
      status: account.status,
      epoch: account.exportEpoch,
      revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
    };
  };
  const result = await createExportService({
    db: f.db,
    readSourceState: source,
    maxRecords: 100,
    now: () => new Date('2026-11-07T04:00:00.000Z'),
  }).gatherExportData(ownerId);

  assert.deepEqual(result.checkins, [
    {
      ownerId,
      placeId: 'fzu-qishan-fuyou-pavilion',
      date: '2026-11-05',
      completedAt: '2026-11-04T16:00:00.000Z',
    },
  ]);
  assert.deepEqual(result.campusCheckins, [
    {
      placeId: 'fzu-qishan-wangshu-lake',
      date: '2026-11-04',
      completedAt: '2026-11-04T00:00:00.000Z',
      ownerId,
    },
  ]);
  assert.deepEqual(result.taskHistory, [
    {
      ownerId,
      taskId: 'task_a',
      taskTitle: '给朋友发条消息',
      date: '2026-11-05',
      state: 'completed',
      createdAt: '2026-11-04T16:10:00.000Z',
    },
  ]);
  assert.equal(result.preferences.cardTextPreview, true);
  assert.equal(result.preferences.decorationsEnabled, false);
  assert.equal(result.favorites.length, 1);
  assert.equal(result.monthDecorations.length, 1);
  // The contract is explicit: check-in rows carry no task link and task rows carry
  // no place link. JF03 must define the association before export can add one.
  assert.equal(Object.hasOwn(result.checkins[0], 'taskId'), false);
  assert.equal(Object.hasOwn(result.taskHistory[0], 'placeId'), false);
  assert.doesNotMatch(JSON.stringify(result.checkins), /taskId|taskTitle/);
  assert.doesNotMatch(JSON.stringify(result.taskHistory), /placeId|placeName/);
});

test('JF05-W4-06 a repeated close returns the same job and afterwards refuses private actions', async () => {
  const config = {
    identityKey: Buffer.from('77'.repeat(32), 'hex'),
    sessionKey: Buffer.from('88'.repeat(32), 'hex'),
    receiptKey: Buffer.from('99'.repeat(32), 'hex'),
  };
  const openid = 'trusted_openid_close';
  const fixture = databaseFixture({});
  let sequence = 0;
  const entry = createProductionEntry({
    readIdentity: () => ({
      identityFromCurrentInvocation: true,
      APPID: APP_ID,
      ENV: ENV_ID,
      SOURCE: 'wx_client',
      OPENID: openid,
    }),
    readConfig: () => config,
    openDatabase: () => fixture.db,
    now: () => new Date('2026-11-07T05:00:00.000Z'),
  });
  const ownerId = accountId(config, openid);
  const scope = sessionScope(config, ownerId);
  const send = (action, payload = {}) =>
    entry({
      apiVersion: '1',
      requestId: 'req_week4_jf05_' + ++sequence,
      action,
      payload,
      ...(action === 'account.session' ? {} : { sessionScope: scope }),
    });
  assert.equal((await send('account.session')).ok, true);
  const first = await send('account.close', { confirm: 'CLOSE' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.accountStatus, 'disabled');
  const second = await send('account.close', { confirm: 'CLOSE' });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.data.cleanup.jobId, first.data.cleanup.jobId);
  assert.equal(
    Object.keys(fixture.inspect()).filter((key) => key.startsWith('cleanup_jobs:')).length,
    1,
  );
  const denied = await send('account.preferences', { operation: 'get' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'ACCOUNT_DISABLED');
});

test('JF05-W4-07 close cleanup removes the owner task-checkin link document', async () => {
  const ownerLinkId = createHash('sha256').update(OWNER).digest('hex');
  const otherLinkId = createHash('sha256').update(OTHER).digest('hex');
  const linkDoc = (id, ownerId) => ({
    _id: id,
    layout: LINK_LAYOUT,
    owner: ownerId,
    ownerId,
    links: [
      {
        requestId: 'req_w4_cleanup_link_' + ownerId.slice(-1),
        digest: JSON.stringify(['tpl_cleanup', 'place_cleanup']),
        taskId: 'tpl_cleanup',
        placeId: 'place_cleanup',
        status: 'committed',
        createdAt: '2026-11-05T00:00:00.000Z',
        result: {
          taskId: 'tpl_cleanup',
          placeId: 'place_cleanup',
          linkedDate: '2026-11-05',
          task: {
            taskId: 'tpl_cleanup',
            date: '2026-11-05',
            state: 'completed',
            replayed: false,
          },
          checkin: {
            placeId: 'place_cleanup',
            date: '2026-11-05',
            completedAt: '2026-11-05T00:00:00.000Z',
            placeName: null,
            duplicated: false,
          },
          linkedAt: '2026-11-05T00:00:00.000Z',
          created: true,
          replayed: false,
        },
      },
    ],
    requests: [],
    revision: 1,
  });
  const f = databaseFixture(
    seed({
      ['task_checkin_links:' + ownerLinkId]: linkDoc(ownerLinkId, OWNER),
      ['task_checkin_links:' + otherLinkId]: linkDoc(otherLinkId, OTHER),
      ['task_templates:' + 'tpl_public']: {
        _id: 'tpl_public',
        title: '公共任务模板',
        enabled: true,
      },
      ['places:' + 'place_public']: { _id: 'place_public', name: '公共地点资料' },
    }),
  );
  const result = await createCleanupService({ db: f.db }).executeAccountCleanup(OWNER, options);
  assert.equal(result.state, 'completed');
  assert.equal(result.progress.task_checkin_links, 1);
  assert.equal(result.totalDeleted, 1);
  const rows = f.inspect();
  assert.equal(rows['task_checkin_links:' + ownerLinkId], undefined);
  assert.ok(rows['task_checkin_links:' + otherLinkId]);
  assert.ok(rows['task_templates:tpl_public']);
  assert.ok(rows['places:place_public']);
  const marker = rows['deletion_markers:' + markerId(OWNER, 'task_checkin_links', ownerLinkId)];
  assert.deepEqual(
    { ownerId: marker.ownerId, collection: marker.collection, docId: marker.docId },
    { ownerId: OWNER, collection: 'task_checkin_links', docId: ownerLinkId },
  );
  // The deletion ledger stays metadata-only; the export projection for this
  // collection is covered by JF05-W4-08.
  assert.equal(JSON.stringify(marker).includes('place_cleanup'), false);
});

test('JF05-W4-08 export projects only the owner committed task-checkin links', async () => {
  const ownerLinkId = createHash('sha256').update(OWNER).digest('hex');
  const otherLinkId = createHash('sha256').update(OTHER).digest('hex');
  const linkRow = (taskId, placeId, linkedAt) => ({
    requestId: 'req_w4_export_' + taskId,
    digest: JSON.stringify([taskId, placeId]),
    taskId,
    placeId,
    status: 'committed',
    createdAt: '2026-11-05T00:00:00.000Z',
    result: {
      taskId,
      placeId,
      linkedDate: '2026-11-05',
      linkedAt,
    },
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
  const account = (id) => ({
    _id: id,
    status: 'active',
    operationFence: 0,
    exportEpoch: 1,
    journalRevision: 1,
  });
  const pending = {
    requestId: 'req_w4_export_pending',
    digest: JSON.stringify(['tpl_pending', 'place_pending']),
    taskId: 'tpl_pending',
    placeId: 'place_pending',
    status: 'pending',
    createdAt: '2026-11-05T00:00:00.000Z',
  };
  const f = databaseFixture({
    ['accounts:' + OWNER]: account(OWNER),
    ['accounts:' + OTHER]: account(OTHER),
    ['task_checkin_links:' + ownerLinkId]: linkDoc(
      OWNER,
      [linkRow('tpl_export', 'place_export', '2026-11-05T01:00:00.000Z')],
      [pending],
    ),
    // A document that only holds an unconfirmed intent has no association to
    // export: the output key must stay absent rather than become an empty array.
    ['task_checkin_links:' + otherLinkId]: linkDoc(OTHER, [], [pending]),
  });
  const source = async (id, tx) => {
    const row = (await tx.collection('accounts').doc(id).get()).data;
    return {
      ownerId: id,
      status: row.status,
      epoch: row.exportEpoch,
      revisions: { journals: 1, favorites: 0, tasks: 0, preferences: 0, decorations: 0 },
    };
  };
  const service = createExportService({
    db: f.db,
    readSourceState: source,
    maxRecords: 100,
    now: () => new Date('2026-11-07T04:00:00.000Z'),
  });

  const result = await service.gatherExportData(OWNER);
  assert.deepEqual(result.taskCheckins, [
    {
      ownerId: OWNER,
      taskId: 'tpl_export',
      placeId: 'place_export',
      linkedDate: '2026-11-05',
      linkedAt: '2026-11-05T01:00:00.000Z',
    },
  ]);
  // Only the minimal association keys are exported: no pending intent, no
  // request mapping, no digest or result internals.
  assert.deepEqual(Object.keys(result.taskCheckins[0]).sort(), [
    'linkedAt',
    'linkedDate',
    'ownerId',
    'placeId',
    'taskId',
  ]);
  assert.equal(Object.hasOwn(result, 'task_checkin_links'), false);
  assert.doesNotMatch(JSON.stringify(result.taskCheckins), /req_w4_export|pending|digest/);

  const other = await service.gatherExportData(OTHER);
  assert.equal(Object.hasOwn(other, 'taskCheckins'), false);
});
