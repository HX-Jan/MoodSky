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
test('PR130 legacy receipt and visit survive aliases, midnight and unified history', async () => {
  const { createHash } = require('node:crypto');
  const f = databaseFixture({}),
    c = client(f.db);
  ok(await c.call('a', 'account.session'));
  const owner = accountId(config, 'a');
  const visit = {
    placeId,
    date: '2026-11-04',
    completedAt: '2026-11-04T01:00:00.000Z',
    placeName: '福友阁',
    selfReported: true,
  };
  const id = createHash('sha256').update(owner).digest('hex');
  await f.db.runTransaction((tx) =>
    tx
      .collection('campus_checkin_states')
      .doc(id)
      .set({
        data: {
          owner,
          ownerId: owner,
          visits: [visit],
          requests: [{ id: 'req_legacy_saved', placeId, result: { visit, duplicated: false } }],
          revision: 1,
        },
      }),
  );
  assert.equal(ok(await c.call('a', 'campus.checkins')).items[0].completedAt, visit.completedAt);
  assert.equal(
    ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_new_alias')).completedAt,
    visit.completedAt,
  );
  c.setNow('2026-11-05T01:00:00.000Z');
  assert.equal(
    ok(await c.call('a', 'campus.checkin', { placeId }, 'req_legacy_saved')).visit.date,
    visit.date,
  );
  const history = ok(await c.call('a', 'campus.checkinHistory', { page: 1, pageSize: 1 }));
  assert.equal(history.total, 1);
  assert.equal(history.hasMore, false);
  assert.equal(ok(await c.call('a', 'campus.checkins', { page: 2, pageSize: 1 })).items.length, 0);
  ok(await c.call('b', 'account.session'));
  assert.equal(ok(await c.call('b', 'campus.checkinHistory')).total, 0);
  const job = ok(await c.call('a', 'account.requestExport', { format: 'json' }));
  const exported = JSON.parse(
    ok(await c.call('a', 'account.downloadExport', { jobId: job.jobId })).content,
  );
  assert.equal(exported.data.checkins.length, 1);
  assert.equal(exported.data.checkins[0].completedAt, visit.completedAt);
  const before = f.inspect()['campus_checkin_states:' + id];
  assert.equal(before.requests[0].id, 'req_legacy_saved');
  const close = ok(await c.call('a', 'account.close', { confirm: 'CLOSE' }));
  const cleanup = createProductionCleanup({ db: f.db });
  let result;
  for (let i = 0; i < 20; i++) {
    result = await cleanup.step(close.cleanup.jobId);
    if (result.state === 'completed') {
      break;
    }
  }
  assert.equal(result.state, 'completed');
  assert.equal(f.inspect()['campus_checkin_states:' + id], undefined);
  assert.equal(ok(await c.call('b', 'campus.checkinHistory')).total, 0);
});
async function seedLegacy(f, owner, visit, requests = []) {
  const { createHash } = require('node:crypto');
  const id = createHash('sha256').update(owner).digest('hex');
  await f.db.runTransaction((tx) =>
    tx
      .collection('campus_checkin_states')
      .doc(id)
      .set({ data: { owner, ownerId: owner, visits: [visit], requests, revision: 1 } }),
  );
}
const legacyVisit = {
  placeId,
  date: '2026-11-04',
  completedAt: '2026-11-04T01:00:00.000Z',
  placeName: '福友阁',
  selfReported: true,
};

test('overlapping legacy and modern visits compare the instant while retaining the original receipt shape', async () => {
  const { checkinId } = require('../cloudfunctions/moodsky/production/checkins');
  for (const [oldSuffix, suffix] of [
    ['Z', '.000Z'],
    ['.1Z', '.100Z'],
    ['.12Z', '.120Z'],
  ]) {
    const f = databaseFixture({}),
      c = client(f.db);
    ok(await c.call('a', 'account.session'));
    const ownerId = accountId(config, 'a');
    const visit = { ...legacyVisit, completedAt: '2026-11-04T01:00:00' + oldSuffix };
    await seedLegacy(f, ownerId, visit);
    f.put('place_checkins', {
      _id: checkinId(ownerId, placeId, visit.date),
      ownerId,
      placeId,
      date: visit.date,
      completedAt: '2026-11-04T01:00:00' + suffix,
    });
    assert.equal(ok(await c.call('a', 'campus.checkins')).items.length, 1);
    assert.equal(ok(await c.call('a', 'campus.checkinHistory')).total, 1);
    const original = { visit, duplicated: true };
    assert.deepEqual(
      ok(await c.call('a', 'campus.checkin', { placeId }, 'req_equal_instant')),
      original,
    );
    assert.deepEqual(
      ok(await c.call('a', 'campus.checkin', { placeId }, 'req_equal_instant')),
      original,
    );
    assert.equal(
      ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_equal_instant')).replayed,
      true,
    );
  }
});

test('duplicate legacy day/place entries cannot silently choose one result or issue new receipts', async () => {
  const { createHash } = require('node:crypto');
  for (const completedAt of [legacyVisit.completedAt, '2026-11-04T01:00:01.000Z']) {
    const f = databaseFixture({}),
      c = client(f.db);
    ok(await c.call('a', 'account.session'));
    const owner = accountId(config, 'a');
    const id = createHash('sha256').update(owner).digest('hex');
    f.put('campus_checkin_states', {
      _id: id,
      owner,
      ownerId: owner,
      visits: [legacyVisit, { ...legacyVisit, completedAt }],
      requests: [],
      revision: 2,
    });
    const before = f.inspect();
    error(await c.call('a', 'campus.checkins'), 'CONFLICT');
    error(await c.call('a', 'campus.checkinHistory'), 'CONFLICT');
    for (const action of ['campus.checkIn', 'campus.checkin']) {
      error(await c.call('a', action, { placeId }, 'req_duplicate_source'), 'CONFLICT');
    }
    assert.deepEqual(f.inspect(), before);
  }
});

for (const missing of [false, true]) {
  test(
    'legacy receipt replay rejects ' +
      (missing ? 'a missing visit' : 'a contradictory visit') +
      ' without writes',
    async () => {
      const { createHash } = require('node:crypto');
      const f = databaseFixture({}),
        c = client(f.db);
      ok(await c.call('a', 'account.session'));
      const owner = accountId(config, 'a');
      const id = createHash('sha256').update(owner).digest('hex');
      f.put('campus_checkin_states', {
        _id: id,
        owner,
        ownerId: owner,
        visits: missing ? [] : [{ ...legacyVisit, completedAt: '2026-11-04T01:00:01.000Z' }],
        requests: [
          { id: 'req_old_receipt', placeId, result: { visit: legacyVisit, duplicated: false } },
        ],
        revision: 1,
      });
      const before = f.inspect();
      for (const action of ['campus.checkIn', 'campus.checkin']) {
        error(await c.call('a', action, { placeId }, 'req_old_receipt'), 'CONFLICT');
      }
      assert.deepEqual(f.inspect(), before);
    },
  );

  test(
    'modern receipt replay rejects ' +
      (missing ? 'a missing visit' : 'a contradictory visit') +
      ' without writes',
    async () => {
      const { checkinId } = require('../cloudfunctions/moodsky/production/checkins');
      const f = databaseFixture({}),
        c = client(f.db);
      ok(await c.call('a', 'account.session'));
      const visit = ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_modern_receipt'));
      const ownerId = accountId(config, 'a');
      const id = checkinId(ownerId, placeId, visit.date);
      if (missing) {
        await f.db.runTransaction((tx) => tx.collection('place_checkins').doc(id).remove());
      } else {
        f.put('place_checkins', {
          ...f.inspect()['place_checkins:' + id],
          completedAt: '2026-11-04T15:59:58.000Z',
        });
      }
      const before = f.inspect();
      for (const action of ['campus.checkIn', 'campus.checkin']) {
        error(await c.call('a', action, { placeId }, 'req_modern_receipt'), 'CONFLICT');
      }
      assert.deepEqual(f.inspect(), before);
    },
  );
}

for (const [label, oldStamp, newStamp] of [
  ['mixed precision', '2026-11-04T01:00:00Z', '2026-11-04T01:00:00.900Z'],
  ['equal instants', '2026-11-04T01:00:00.1Z', '2026-11-04T01:00:00.100Z'],
]) {
  test(
    'unified history sorts ' +
      label +
      ' by instant and stable place id without rewriting legacy data',
    async () => {
      const { createHash } = require('node:crypto');
      const f = databaseFixture({}),
        c = client(f.db);
      ok(await c.call('a', 'account.session'));
      const owner = accountId(config, 'a');
      await seedLegacy(f, owner, { ...legacyVisit, completedAt: oldStamp });
      c.setNow(newStamp);
      ok(await c.call('a', 'campus.checkIn', { placeId: PLACES[1].placeId }));
      const id = 'campus_checkin_states:' + createHash('sha256').update(owner).digest('hex');
      const original = f.inspect()[id];
      const first = ok(await c.call('a', 'campus.checkinHistory', { page: 1, pageSize: 1 }));
      const second = ok(await c.call('a', 'campus.checkinHistory', { page: 2, pageSize: 1 }));
      assert.equal(first.total, 2);
      assert.equal(first.hasMore, true);
      assert.equal(second.hasMore, false);
      assert.deepEqual(
        [first.items[0].placeId, second.items[0].placeId],
        [PLACES[1].placeId, placeId],
      );
      assert.equal(second.items[0].completedAt, oldStamp);
      assert.deepEqual(f.inspect()[id], original);
      ok(await c.call('b', 'account.session'));
      assert.equal(ok(await c.call('b', 'campus.checkinHistory')).total, 0);
    },
  );
}
test('PR137 conflicting collections reject both write aliases atomically without receipts or counters', async () => {
  const f = databaseFixture({}),
    c = client(f.db);
  ok(await c.call('a', 'account.session'));
  ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_seed_conflict'));
  await seedLegacy(f, accountId(config, 'a'), legacyVisit);
  error(await c.call('a', 'campus.checkins'), 'CONFLICT');
  error(await c.call('a', 'campus.checkinHistory'), 'CONFLICT');
  const before = f.inspect();
  for (const action of ['campus.checkIn', 'campus.checkin']) {
    error(
      await c.call('a', action, { placeId }, 'req_conflict_' + action.split('.').at(-1)),
      'CONFLICT',
    );
    assert.deepEqual(f.inspect(), before);
  }
});
test('PR137 legacy original receipt is preserved exactly across midnight for both duplicated values', async () => {
  for (const duplicated of [false, true]) {
    const f = databaseFixture({}),
      c = client(f.db);
    ok(await c.call('a', 'account.session'));
    const original = { visit: { ...legacyVisit }, duplicated };
    await seedLegacy(f, accountId(config, 'a'), legacyVisit, [
      { id: 'req_preserve_original', placeId, result: original },
    ]);
    c.setNow('2026-11-05T01:00:00.000Z');
    assert.deepEqual(
      ok(await c.call('a', 'campus.checkin', { placeId }, 'req_preserve_original')),
      original,
    );
    assert.deepEqual(
      ok(await c.call('a', 'campus.checkin', { placeId }, 'req_preserve_original')),
      original,
    );
    const native = ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_preserve_original'));
    assert.equal(native.replayed, true);
    assert.equal(native.completedAt, original.visit.completedAt);
  }
});
test('PR137 same-day new request is duplicated but not replayed; replay preserves its original result', async () => {
  for (const legacy of [false, true]) {
    const f = databaseFixture({}),
      c = client(f.db);
    ok(await c.call('a', 'account.session'));
    if (legacy) {
      await seedLegacy(f, accountId(config, 'a'), legacyVisit);
    } else {
      assert.equal(
        ok(await c.call('a', 'campus.checkin', { placeId }, 'req_first')).duplicated,
        false,
      );
    }
    const first = ok(await c.call('a', 'campus.checkin', { placeId }, 'req_duplicate'));
    assert.equal(first.duplicated, true);
    assert.equal(
      ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_native_duplicate')).replayed,
      false,
    );
    c.setNow('2026-11-05T01:00:00.000Z');
    assert.deepEqual(ok(await c.call('a', 'campus.checkin', { placeId }, 'req_duplicate')), first);
    assert.equal(
      ok(await c.call('a', 'campus.checkIn', { placeId }, 'req_native_duplicate')).replayed,
      true,
    );
    if (!legacy) {
      assert.equal(
        ok(await c.call('a', 'campus.checkin', { placeId }, 'req_first')).duplicated,
        false,
      );
    }
    assert.equal(ok(await c.call('a', 'campus.checkinHistory')).total, 1);
  }
});
