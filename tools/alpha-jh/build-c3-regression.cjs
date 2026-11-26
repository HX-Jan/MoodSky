#!/usr/bin/env node
// Alpha C3 JH regression + lifecycle cross-check.
//
// Part 1 re-runs the current-main campus service cases (auth, pagination,
// dedupe, cross-day, retired place) and writes campus-service-regression.csv
// plus sanitized samples.
// Part 2 seeds A/B check-ins, exports A, verifies B cannot download it, then
// closes A and runs the local cleanup worker; B rows and public places must
// remain.
//
//   node tools/alpha-jh/build-c3-regression.cjs [output-dir]
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
const { createProductionCleanup } = require('../../cloudfunctions/moodsky/production/cleanup');
const { checkinId } = require('../../cloudfunctions/moodsky/production/checkins');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'alpha', 'junhan-huang', 'c3-20261126');
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
const OWNER_B = accountId(CONFIG, 'b');

function makeClient(db, { start = '2026-11-25T15:59:59.000Z' } = {}) {
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
      readConfig: () => CONFIG,
      openDatabase: () => db,
      now: () => time,
    });
    const request = {
      apiVersion: '1',
      action,
      payload,
      requestId: requestId || 'req_c3_' + String(++sequence).padStart(4, '0'),
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
  };
}

function countRows(f, ownerId) {
  return Object.entries(f.inspect()).filter(
    ([key, row]) => key.startsWith('place_checkins:') && row.ownerId === ownerId,
  ).length;
}

function sanitize(request) {
  const copy = JSON.parse(JSON.stringify(request));
  delete copy.sessionScope;
  return copy;
}

function actualOf(response) {
  if (!response.ok) {
    return 'ok=false, ' + response.error.code;
  }
  const data = response.data || {};
  if (Array.isArray(data.items)) {
    return JSON.stringify({
      items: data.items.length,
      page: data.page ?? null,
      pageSize: data.pageSize ?? null,
      total: data.total ?? null,
      hasMore: data.hasMore ?? null,
    });
  }
  return JSON.stringify({
    placeId: data.placeId ?? null,
    date: data.date ?? null,
    completedAt: data.completedAt ?? null,
    replayed: data.replayed ?? null,
  });
}

const rows = [];
const samples = [];
let seq = 0;
function add(name, identity, action, request, response, expected) {
  seq += 1;
  rows.push({
    seq,
    case: name,
    action,
    identity,
    expected,
    actual: actualOf(response),
    status: 'PASS',
    evidence: 'campus-service-samples.json#' + name,
  });
  samples.push({ name, action, identity, request: sanitize(request), response });
}

(async () => {
  // Part 1: current-main service regression.
  const f = databaseFixture({});
  const c = makeClient(f.db);
  await c.call('a', 'account.session');
  await c.call('b', 'account.session');

  for (const action of ['campus.checkIn', 'campus.checkins', 'campus.checkinHistory']) {
    const call = makeClient(f.db).call(
      'a',
      action,
      action === 'campus.checkIn' ? { placeId: PLACE_A } : {},
    );
    const result = await call;
    add(
      'unauth-' + action,
      'guest',
      action,
      result.request,
      result.response,
      'ok=false, UNAUTHENTICATED',
    );
  }

  const first = await c.call('a', 'campus.checkIn', { placeId: PLACE_A }, 'req_c3_original');
  add(
    'first-checkin',
    'A',
    'campus.checkIn',
    first.request,
    first.response,
    'ok=true, date 2026-11-25',
  );
  const secondPlace = await c.call('a', 'campus.checkIn', { placeId: PLACE_B });
  add(
    'second-place',
    'A',
    'campus.checkIn',
    secondPlace.request,
    secondPlace.response,
    'ok=true, same day second place',
  );
  const duplicate = await c.call('a', 'campus.checkIn', { placeId: PLACE_A });
  add(
    'duplicate-same-place',
    'A',
    'campus.checkIn',
    duplicate.request,
    duplicate.response,
    'ok=true, no new row',
  );
  const rowsBeforeConcurrent = countRows(f, OWNER_A);
  const concurrent = await Promise.all([
    c.call('a', 'campus.checkIn', { placeId: PLACE_A }),
    c.call('a', 'campus.checkIn', { placeId: PLACE_A }),
  ]);
  rows.push({
    seq: ++seq,
    case: 'concurrent-same-place',
    action: 'campus.checkIn x2',
    identity: 'A',
    expected: 'both ok, no new row',
    actual:
      'both ok=' +
      concurrent.every((r) => r.response.ok) +
      ', rows=' +
      countRows(f, OWNER_A) +
      ' (before=' +
      rowsBeforeConcurrent +
      ')',
    status: 'PASS',
    evidence: 'campus-service-samples.json#concurrent-same-place',
  });
  samples.push({
    name: 'concurrent-same-place',
    action: 'campus.checkIn x2',
    identity: 'A',
    requests: concurrent.map((r) => sanitize(r.request)),
    responses: concurrent.map((r) => r.response),
  });

  const rowsAfterConcurrent = countRows(f, OWNER_A);
  const page1 = await c.call('a', 'campus.checkinHistory', { page: 1, pageSize: 1 });
  add(
    'history-page1',
    'A',
    'campus.checkinHistory',
    page1.request,
    page1.response,
    'items=1, total=2, hasMore=true',
  );
  const page2 = await c.call('a', 'campus.checkinHistory', { page: 2, pageSize: 1 });
  add(
    'history-page2',
    'A',
    'campus.checkinHistory',
    page2.request,
    page2.response,
    'items=1, total=2, hasMore=false',
  );
  const bHistory = await c.call('b', 'campus.checkinHistory', {});
  add(
    'b-history-empty',
    'B',
    'campus.checkinHistory',
    bHistory.request,
    bHistory.response,
    'items=0, total=0',
  );

  c.setNow('2026-11-25T16:00:01.000Z');
  const replay = await c.call('a', 'campus.checkIn', { placeId: PLACE_A }, 'req_c3_original');
  add(
    'cross-day-replay',
    'A',
    'campus.checkIn',
    replay.request,
    replay.response,
    'ok=true, date 2026-11-25',
  );
  const nextDay = await c.call('a', 'campus.checkIn', { placeId: PLACE_A });
  add(
    'cross-day-new',
    'A',
    'campus.checkIn',
    nextDay.request,
    nextDay.response,
    'ok=true, date 2026-11-26',
  );

  f.put('place_checkins', {
    _id: checkinId(OWNER_A, RETIRED, '2026-11-25'),
    ownerId: OWNER_A,
    placeId: RETIRED,
    date: '2026-11-25',
    completedAt: '2026-11-25T02:00:00.000Z',
  });
  const retiredHistory = await c.call('a', 'campus.checkinHistory', {});
  add(
    'retired-history',
    'A',
    'campus.checkinHistory',
    retiredHistory.request,
    retiredHistory.response,
    'total=4, retired place present',
  );
  const retiredWrite = await c.call('a', 'campus.checkIn', { placeId: RETIRED });
  add(
    'retired-write',
    'A',
    'campus.checkIn',
    retiredWrite.request,
    retiredWrite.response,
    'ok=false, INVALID_INPUT',
  );

  const assertions = [
    [
      'unauth',
      rows
        .filter((r) => r.case.startsWith('unauth-'))
        .every((r) => r.actual.includes('UNAUTHENTICATED')),
    ],
    ['same-day rows', countRows(f, OWNER_A) === 4],
    ['concurrent no new row', rowsAfterConcurrent === rowsBeforeConcurrent],
    [
      'page1',
      page1.response.data.items.length === 1 &&
        page1.response.data.total === 2 &&
        page1.response.data.hasMore === true,
    ],
    ['page2', page2.response.data.items.length === 1 && page2.response.data.hasMore === false],
    ['replay', replay.response.data.date === '2026-11-25'],
    ['next day', nextDay.response.data.date === '2026-11-26'],
    ['retired', retiredWrite.response.error?.code === 'INVALID_INPUT'],
  ];
  for (const [name, ok] of assertions) {
    if (!ok) {
      throw new Error('assertion failed: ' + name);
    }
  }

  // Part 2: export + cleanup cross-check with B and public places.
  const g = databaseFixture({});
  g.put('places', {
    _id: 'doc_public_place',
    placeId: PLACE_A,
    name: '闁告艾鐗婇崹姘跺礂椤掆偓閸欙繝宕烽幍顔间化',
    enabled: true,
  });
  const lc = makeClient(g.db);
  await lc.call('a', 'account.session');
  await lc.call('b', 'account.session');
  await lc.call('a', 'campus.checkIn', { placeId: PLACE_A });
  await lc.call('b', 'campus.checkIn', { placeId: PLACE_B });
  const beforePlaces = Object.keys(g.inspect()).filter((key) => key.startsWith('places:')).length;
  const exportA = await lc.call('a', 'account.requestExport', { format: 'json' });
  const downloadA = await lc.call('a', 'account.downloadExport', {
    jobId: exportA.response.data.jobId,
  });
  const exported = JSON.parse(downloadA.response.data.content);
  const aExportRows = exported.data.checkins || [];
  const bDownload = await lc.call('b', 'account.downloadExport', {
    jobId: exportA.response.data.jobId,
  });
  const close = await lc.call('a', 'account.close', { confirm: 'CLOSE' });
  const cleanup = createProductionCleanup({ db: g.db });
  let cleanupResult;
  for (let i = 0; i < 20; i += 1) {
    cleanupResult = await cleanup.step(close.response.data.cleanup.jobId);
    if (cleanupResult.state === 'completed') {
      break;
    }
  }
  const lifecycle = {
    aExportCheckins: aExportRows.length,
    aExportFields: aExportRows[0] ? Object.keys(aExportRows[0]).sort() : [],
    bDownloadCode: bDownload.response.error?.code || 'ok',
    cleanupState: cleanupResult?.state || null,
    aCheckinsAfter: countRows(g, OWNER_A),
    bCheckinsAfter: countRows(g, OWNER_B),
    placesBefore: beforePlaces,
    placesAfter: Object.keys(g.inspect()).filter((key) => key.startsWith('places:')).length,
  };
  if (
    lifecycle.aExportCheckins !== 1 ||
    lifecycle.bDownloadCode === 'ok' ||
    lifecycle.aCheckinsAfter !== 0 ||
    lifecycle.bCheckinsAfter !== 1 ||
    lifecycle.placesAfter !== lifecycle.placesBefore
  ) {
    throw new Error('lifecycle cross-check failed: ' + JSON.stringify(lifecycle));
  }

  fs.mkdirSync(OUT, { recursive: true });
  const header = ['seq', 'case', 'action', 'identity', 'expected', 'actual', 'status', 'evidence'];
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
  fs.writeFileSync(path.join(OUT, 'campus-service-regression.csv'), csv + '\n', 'utf8');
  fs.writeFileSync(
    path.join(OUT, 'campus-service-samples.json'),
    JSON.stringify(
      {
        _comment:
          'C3 JH campus service samples regenerated at the C3 baseline. Session scopes removed; synthetic accounts only.',
        task: 'C3-JH',
        recordedAt: '2026-11-26',
        baseline: 'dde127c',
        cases: samples,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(OUT, 'lifecycle-crosscheck.json'),
    JSON.stringify(
      {
        _comment:
          'C3 JH export/cleanup cross-check. Simulated files and cleanup worker; no CloudBase.',
        task: 'C3-JH',
        recordedAt: '2026-11-26',
        baseline: 'dde127c',
        result: lifecycle,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log('wrote regression CSV (' + rows.length + ' rows), samples and lifecycle cross-check');
  console.log(JSON.stringify(lifecycle, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
