#!/usr/bin/env node
// Alpha C2 JH builder: dedupe/date results + lifecycle map.
//
// Drives the real production entry against the simulated database with fixed
// clocks, records place_checkins row counts after each step, and maps the
// campus collections for Xiang Yu. No CloudBase, phone or real account.
//
//   node tools/alpha-jh/build-c2-results.cjs [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseFixture } = require('../../tests/helpers/w2-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../../cloudfunctions/moodsky/production/config');
const { checkinId } = require('../../cloudfunctions/moodsky/production/checkins');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'alpha', 'junhan-huang', 'c2-20261124');
const CONFIG = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const PLACE_A = PLACES[0].placeId;
const PLACE_B = PLACES[1].placeId;
const RETIRED = 'fzu-qishan-retired-place';
const OWNER_A = accountId(CONFIG, 'a');

function makeClient(db, { paused = false, start = '2026-11-18T15:59:59.000Z' } = {}) {
  let time = new Date(start);
  let sequence = 0;
  const scopes = {};
  async function call(who, action, payload = {}, requestId) {
    const entry = createProductionEntry({
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: who || '',
        identityFromCurrentInvocation: true,
      }),
      readConfig: () => ({ ...CONFIG, campusCheckinWritesPaused: paused }),
      openDatabase: () => db,
      now: () => time,
    });
    const request = {
      apiVersion: '1',
      action,
      payload,
      requestId: requestId || 'req_c2_' + String(++sequence).padStart(4, '0'),
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
    };
    const response = await entry(request);
    if (action === 'account.session' && response.ok) {
      scopes[who] = response.data.scope;
    }
    return { request, response };
  }
  return {
    call,
    setNow(value) {
      time = new Date(value);
    },
    now() {
      return time;
    },
  };
}

function beijing(time) {
  return new Date(time.getTime() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

function countRows(f, ownerId) {
  return Object.entries(f.inspect())
    .filter(([key, row]) => key.startsWith('place_checkins:') && row.ownerId === ownerId)
    .map(([, row]) => row)
    .sort((a, b) => a.date.localeCompare(b.date) || a.placeId.localeCompare(b.placeId));
}

(async () => {
  const f = databaseFixture({});
  const writable = makeClient(f.db);
  const rows = [];
  let seq = 0;
  function record(client, who, action, payload, { requestId, note, expected } = {}) {
    return client.call(who, action, payload, requestId).then((result) => {
      seq += 1;
      const data = result.response.data || {};
      const current = countRows(f, OWNER_A);
      rows.push({
        seq,
        clock: beijing(client.now()),
        identity: who,
        action,
        place_id: payload.placeId || '',
        request_id: result.request.requestId,
        ok: result.response.ok === true,
        code: result.response.error?.code || '',
        business_date: data.date || '',
        replayed: data.replayed === undefined ? '' : String(data.replayed),
        rows_after: current.length,
        note: note || '',
      });
      if (expected && !expected(result)) {
        throw new Error('unexpected result for ' + action + ': ' + JSON.stringify(result.response));
      }
      return result;
    });
  }

  await writable.call('a', 'account.session');
  await writable.call('b', 'account.session');

  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    {
      requestId: 'req_c2_original',
      note: 'first visit, business date 2026-11-18',
      expected: (r) => r.response.ok && r.response.data.date === '2026-11-18',
    },
  );
  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    {
      note: 'same place/day new request: duplicated, no new row',
      expected: (r) => r.response.ok && countRows(f, OWNER_A).length === 1,
    },
  );
  const concurrent = await Promise.all([
    writable.call('a', 'campus.checkIn', { placeId: PLACE_A }),
    writable.call('a', 'campus.checkIn', { placeId: PLACE_A }),
  ]);
  seq += 1;
  rows.push({
    seq,
    clock: beijing(writable.now()),
    identity: 'A',
    action: 'campus.checkIn x2',
    place_id: PLACE_A,
    request_id: concurrent.map((entry) => entry.request.requestId).join('|'),
    ok: concurrent.every((entry) => entry.response.ok === true),
    code: '',
    business_date: concurrent.map((entry) => entry.response.data?.date || '').join('|'),
    replayed: concurrent.map((entry) => String(entry.response.data?.replayed)).join('|'),
    rows_after: countRows(f, OWNER_A).length,
    note: 'two concurrent taps, still one row',
  });
  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: PLACE_B },
    {
      note: 'same day, different place is allowed',
      expected: (r) => r.response.ok && countRows(f, OWNER_A).length === 2,
    },
  );
  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    {
      requestId: 'req_c2_original',
      note: 'same-request replay before midnight',
      expected: (r) => r.response.ok && r.response.data.replayed === true,
    },
  );

  writable.setNow('2026-11-18T16:00:01.000Z');
  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    {
      requestId: 'req_c2_original',
      note: 'after midnight: replay keeps original 2026-11-18 row',
      expected: (r) => r.response.ok && r.response.data.date === '2026-11-18',
    },
  );
  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    {
      note: 'after midnight new request creates 2026-11-19 row',
      expected: (r) => r.response.ok && r.response.data.date === '2026-11-19',
    },
  );
  await record(
    writable,
    'a',
    'campus.checkinHistory',
    { page: 1, pageSize: 10 },
    {
      note: 'history has both dates',
      expected: (r) => r.response.ok && r.response.data.total === 3,
    },
  );

  const paused = makeClient(f.db, { paused: true, start: '2026-11-18T16:00:01.000Z' });
  await paused.call('a', 'account.session');
  await record(
    paused,
    'a',
    'campus.checkinHistory',
    {},
    {
      note: 'paused: existing history remains readable',
      expected: (r) => r.response.ok && r.response.data.total === 3,
    },
  );
  await record(
    paused,
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    {
      requestId: 'req_c2_original',
      note: 'paused: original receipt still replays',
      expected: (r) => r.response.ok && r.response.data.date === '2026-11-18',
    },
  );
  await record(
    paused,
    'a',
    'campus.checkIn',
    { placeId: PLACE_B },
    {
      requestId: 'req_c2_paused_new',
      note: 'paused: new write is refused, no row added',
      expected: (r) =>
        r.response.error?.code === 'NOT_IMPLEMENTED' && countRows(f, OWNER_A).length === 3,
    },
  );

  f.put('place_checkins', {
    _id: checkinId(OWNER_A, RETIRED, '2026-11-18'),
    ownerId: OWNER_A,
    placeId: RETIRED,
    date: '2026-11-18',
    completedAt: '2026-11-18T02:00:00.000Z',
  });
  await record(
    writable,
    'a',
    'campus.checkinHistory',
    {},
    {
      note: 'retired place stays in history',
      expected: (r) =>
        r.response.ok &&
        r.response.data.total === 4 &&
        r.response.data.items.some((row) => row.placeId === RETIRED),
    },
  );
  await record(
    writable,
    'a',
    'campus.checkIn',
    { placeId: RETIRED },
    {
      note: 'retired place cannot be checked in again',
      expected: (r) =>
        r.response.error?.code === 'INVALID_INPUT' && countRows(f, OWNER_A).length === 4,
    },
  );

  fs.mkdirSync(OUT, { recursive: true });
  const header = [
    'seq',
    'clock',
    'identity',
    'action',
    'place_id',
    'request_id',
    'ok',
    'code',
    'business_date',
    'replayed',
    'rows_after',
    'note',
  ];
  const csv = [header.join(',')]
    .concat(
      rows.map((row) =>
        header
          .map((key) => {
            const value = String(row[key] ?? '');
            return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
          })
          .join(','),
      ),
    )
    .join('\n');
  fs.writeFileSync(path.join(OUT, 'dedup-date-results.csv'), csv + '\n', 'utf8');

  const lifecycle = [
    {
      collection: 'place_checkins',
      role: 'canonical self-reported visit',
      owner_key: 'ownerId',
      export_fields: 'placeId, date, completedAt',
      cleanup: 'owner-scoped, idempotent',
      public_retained: 'false',
      source: 'cloudfunctions/moodsky/production/checkins.js',
      local_status: 'verified in simulated export/cleanup',
      gap: 'real file backend / 24h expiry not run',
    },
    {
      collection: 'campus_checkin_states',
      role: 'legacy aggregate visits/requests',
      owner_key: 'owner + ownerId',
      export_fields: 'placeId, date, completedAt (merged legacy visit)',
      cleanup: 'owner-scoped, idempotent',
      public_retained: 'false',
      source: 'cloudfunctions/moodsky/production/checkins.js',
      local_status: 'legacy compatibility covered by tests',
      gap: 'no real legacy data migration',
    },
    {
      collection: 'request_receipts',
      role: 'original request replay / export revision fence',
      owner_key: 'ownerId + requestId',
      export_fields: 'not exported',
      cleanup: 'owner-scoped',
      public_retained: 'false',
      source: 'cloudfunctions/moodsky/production/checkins.js',
      local_status: 'replay and pause covered',
      gap: 'real trigger not run',
    },
    {
      collection: 'places',
      role: 'public recommendation catalogue',
      owner_key: 'placeId (no owner)',
      export_fields: 'not exported',
      cleanup: 'retained',
      public_retained: 'true',
      source: 'cloudfunctions/moodsky/domains/campus-rules.js',
      local_status: 'five approved places reviewed',
      gap: 'database enabled=false propagation not implemented',
    },
    {
      collection: 'favorites',
      role: 'personal favorites',
      owner_key: 'ownerId',
      export_fields: 'placeId, createdAt',
      cleanup: 'owner-scoped, idempotent',
      public_retained: 'false',
      source: 'cloudfunctions/moodsky/domains/campus-personal.js',
      local_status: 'W4/W5 tests',
      gap: 'not re-run in C2',
    },
    {
      collection: 'place_corrections',
      role: 'private corrections',
      owner_key: 'ownerId',
      export_fields: 'correctionId, placeId, text, status, createdAt, reviewedAt',
      cleanup: 'owner-scoped, idempotent',
      public_retained: 'false',
      source: 'cloudfunctions/moodsky/domains/campus-personal.js',
      local_status: 'W3/W4 tests',
      gap: 'not re-run in C2',
    },
  ];
  const lifecycleHeader = [
    'collection',
    'role',
    'owner_key',
    'export_fields',
    'cleanup',
    'public_retained',
    'source',
    'local_status',
    'gap',
  ];
  const lifecycleCsv = [lifecycleHeader.join(',')]
    .concat(
      lifecycle.map((row) =>
        lifecycleHeader
          .map((key) => {
            const value = String(row[key] ?? '');
            return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
          })
          .join(','),
      ),
    )
    .join('\n');
  fs.writeFileSync(path.join(OUT, 'lifecycle-map.csv'), lifecycleCsv + '\n', 'utf8');

  const summary = {
    rows: rows.length,
    finalRows: countRows(f, OWNER_A).length,
    businessDates: [...new Set(countRows(f, OWNER_A).map((row) => row.date))].sort(),
    pausedNewWriteCode: rows.find((row) => row.note.includes('paused: new write'))?.code,
    retiredHistoryRows: rows.find((row) => row.note.includes('retired place stays'))?.rows_after,
    retiredWriteCode: rows.find((row) => row.note.includes('retired place cannot'))?.code,
  };
  fs.writeFileSync(
    path.join(OUT, 'c2-summary.json'),
    JSON.stringify(
      {
        _comment:
          'C2 JH dedupe/date summary from the production entry + simulated database. No cloud, phone or real account.',
        task: 'C2-JH',
        recordedAt: '2026-11-24',
        baseline: '7feca53',
        summary,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log('wrote dedup-date-results.csv, lifecycle-map.csv, c2-summary.json');
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
