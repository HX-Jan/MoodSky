const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const { createProductionCleanup } = require('../cloudfunctions/moodsky/production/cleanup');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../cloudfunctions/moodsky/production/config');
const { PLACES } = require('../miniprogram/shared/campus-checkins');
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const placeId = PLACES[0].placeId;
function client(db) {
  let time = new Date('2026-11-04T15:59:59.000Z'),
    sequence = 0;
  const scopes = {};
  return {
    setNow(value) {
      time = new Date(value);
    },
    async call(who, action, payload = {}, id) {
      const entry = createProductionEntry({
        readIdentity: () => ({
          APPID: APP_ID,
          ENV: ENV_ID,
          SOURCE: 'wx_client',
          OPENID: who,
          identityFromCurrentInvocation: true,
        }),
        readConfig: () => config,
        openDatabase: () => db,
        now: () => time,
      });
      const result = await entry({
        apiVersion: '1',
        action,
        payload,
        requestId: id || 'req_checkin_' + ++sequence,
        ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
      });
      if (action === 'account.session' && result.ok) {
        scopes[who] = result.data.scope;
      }
      return result;
    },
  };
}
function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
function error(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code, JSON.stringify(result));
}
test('manual checkin uses trusted account/server day without location, verification rows or private identity payload', async () => {
  const f = databaseFixture({}),
    c = client(f.db);
  error(await c.call('a', 'campus.checkIn', { placeId }), 'UNAUTHENTICATED');
  ok(await c.call('a', 'account.session'));
  for (const extra of [
    { ownerId: 'b' },
    { latitude: 26 },
    { date: '2020-01-01' },
    { verified: true },
  ]) {
    error(
      await c.call('a', 'campus.checkIn', { placeId, ...extra }),
      'ownerId' in extra ? 'INVALID_REQUEST' : 'INVALID_INPUT',
    );
  }
  error(await c.call('a', 'campus.checkIn', { placeId: 'unknown' }), 'INVALID_INPUT');
  const row = ok(await c.call('a', 'campus.checkIn', { placeId }));
  assert.equal(row.date, '2026-11-04');
  assert.equal(row.placeId, placeId);
  assert.deepEqual(Object.keys(row).sort(), ['completedAt', 'date', 'placeId', 'replayed']);
  assert.equal(ok(await c.call('a', 'campus.checkins')).items.length, 1);
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('places:')).length, 0);
});
test('same-day new requests and concurrent taps keep one row; original retry across midnight replays old day', async () => {
  const f = databaseFixture({}),
    c = client(f.db);
  ok(await c.call('a', 'account.session'));
  const first = ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_original'));
  const result = await Promise.all([
    c.call('a', 'campus.checkIn', { placeId }),
    c.call('a', 'campus.checkIn', { placeId }, 'req_original'),
  ]);
  result.forEach(ok);
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('place_checkins:')).length, 1);
  c.setNow('2026-11-04T16:00:01.000Z');
  assert.deepEqual(ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_original')), {
    ...first,
    replayed: true,
  });
  assert.deepEqual(ok(await c.call('a', 'campus.checkins')), { date: '2026-11-05', items: [] });
  error(
    await c.call('a', 'campus.checkIn', { placeId: PLACES[1].placeId }, 'req_original'),
    'CONFLICT',
  );
  assert.equal(ok(await c.call('a', 'campus.checkIn', { placeId })).date, '2026-11-05');
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('place_checkins:')).length, 2);
});
test('manual checkins isolate accounts, invalidate exports and are exported in JSON and Markdown', async () => {
  const f = databaseFixture({}),
    c = client(f.db);
  ok(await c.call('a', 'account.session'));
  ok(await c.call('b', 'account.session'));
  const job = ok(await c.call('a', 'account.requestExport', { format: 'json' }));
  const before = f.inspect()['accounts:' + accountId(config, 'a')];
  ok(await c.call('a', 'campus.checkIn', { placeId }));
  const after = f.inspect()['accounts:' + accountId(config, 'a')];
  assert.equal(after.sourceRevisions.tasks, before.sourceRevisions.tasks + 1);
  assert.equal(after.exportEpoch, before.exportEpoch + 1);
  assert.equal(ok(await c.call('b', 'campus.checkins')).items.length, 0);
  error(
    await c.call('b', 'campus.checkins', { ownerId: accountId(config, 'a') }),
    'INVALID_REQUEST',
  );
  error(await c.call('a', 'account.downloadExport', { jobId: job.jobId }), 'CONFLICT');
  const json = ok(await c.call('a', 'account.requestExport', { format: 'json' }));
  const data = JSON.parse(
    ok(await c.call('a', 'account.downloadExport', { jobId: json.jobId })).content,
  ).data;
  assert.deepEqual(
    data.checkins.map((r) => r.placeId),
    [placeId],
  );
  assert.deepEqual(data.taskHistory, []);
  const md = ok(await c.call('a', 'account.requestExport', { format: 'markdown' }));
  assert.match(
    ok(await c.call('a', 'account.downloadExport', { jobId: md.jobId })).content,
    /地点打卡（1 条）/,
  );
});
test('disabled account cannot check in or read; cleanup deletes only its private checkins and receipts', async () => {
  const f = databaseFixture({}),
    c = client(f.db);
  for (const who of ['a', 'b']) {
    ok(await c.call(who, 'account.session'));
    ok(await c.call(who, 'campus.checkIn', { placeId }));
  }
  const close = ok(await c.call('a', 'account.close', { confirm: 'CLOSE' }));
  error(await c.call('a', 'campus.checkIn', { placeId }), 'ACCOUNT_DISABLED');
  error(await c.call('a', 'campus.checkins'), 'ACCOUNT_DISABLED');
  const cleanup = createProductionCleanup({ db: f.db });
  let result;
  for (let i = 0; i < 20; i++) {
    result = await cleanup.step(close.cleanup.jobId);
    if (result.state === 'completed') {
      break;
    }
  }
  assert.equal(result.state, 'completed');
  assert.equal(
    Object.values(f.inspect()).filter(
      (r) => r.ownerId === accountId(config, 'a') && r.placeId === placeId,
    ).length,
    0,
  );
  assert.equal(ok(await c.call('b', 'campus.checkins')).items.length, 1);
});
test('installed native SDK executes manual checkin, retry and export through the production adapter offline', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const c = client(createProductionDatabase(nativeDb));
      ok(await c.call('a', 'account.session'));
      ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_sdk_checkin'));
      assert.equal(
        ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_sdk_checkin')).replayed,
        true,
      );
      assert.equal(ok(await c.call('a', 'campus.checkins')).items.length, 1);
      const job = ok(await c.call('a', 'account.requestExport', { format: 'json' }));
      assert.match(
        ok(await c.call('a', 'account.downloadExport', { jobId: job.jobId })).content,
        /"checkins"/,
      );
    },
    { nativeDatabase: true },
  );
});

test('checkin receipt failure rolls back record and export revisions, then retries original request', async () => {
  let failing = false;
  const f = databaseFixture(
    {},
    {
      fail: ({ collection, operation }) =>
        failing && collection === 'request_receipts' && operation === 'set',
    },
  );
  const c = client(f.db);
  ok(await c.call('a', 'account.session'));
  const before = f.inspect()['accounts:' + accountId(config, 'a')];
  failing = true;
  error(await c.call('a', 'campus.checkIn', { placeId }, 'req_rollback'), 'INTERNAL_ERROR');
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('place_checkins:')).length, 0);
  assert.equal(f.inspect()['accounts:' + accountId(config, 'a')].exportEpoch, before.exportEpoch);
  failing = false;
  ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_rollback'));
  assert.equal(ok(await c.call('a', 'campus.checkins')).items.length, 1);
});

for (const badRecord of [
  { date: '2026-03-02', completedAt: '2026-02-30T01:00:00.000Z' },
  { date: '2026-11-04', completedAt: '2026-11-04T16:00:00+08:00' },
  { date: '2026-11-05', completedAt: '2026-11-04T24:00:00.000Z' },
  { date: '2026-11-05', completedAt: '2026-11-05' },
]) {
  test(
    'production checkin rejects parseable non-UTC source without issuing a receipt: ' +
      badRecord.completedAt,
    async () => {
      const f = databaseFixture({}),
        c = client(f.db);
      ok(await c.call('a', 'account.session'));
      c.setNow(badRecord.date + 'T01:00:00.000Z');
      const ownerId = accountId(config, 'a');
      const id = require('../cloudfunctions/moodsky/production/checkins').checkinId(
        ownerId,
        placeId,
        badRecord.date,
      );
      await f.db.runTransaction((tx) =>
        tx
          .collection('place_checkins')
          .doc(id)
          .set({ data: { ownerId, placeId, ...badRecord } }),
      );
      const before = f.inspect();
      error(await c.call('a', 'campus.checkins'), 'CONFLICT');
      error(await c.call('a', 'campus.checkIn', { placeId }, 'req_invalid_timestamp'), 'CONFLICT');
      assert.deepEqual(f.inspect(), before);
    },
  );
}
