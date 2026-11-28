#!/usr/bin/env node
// Alpha C4 JH final candidate check.
//
// Runs the campus service on the frozen product tree (00c59a1) with the final
// candidate mode: task mode closed, new check-ins paused. Proves auth,
// pagination, same-day dedupe, cross-day replay/new request, retired history and
// paused-mode reads while new writes are refused.
//
//   node tools/alpha-jh/build-c4-final.cjs [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
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
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'alpha', 'junhan-huang', 'c4-20261128');
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
const FROZEN = '00c59a1af7ccd27e9c2ae4bc77f6b65fc66b117c';

function makeClient(db, { paused = false, start = '2026-11-27T15:59:59.000Z' } = {}) {
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
      requestId: requestId || 'req_c4_' + String(++sequence).padStart(4, '0'),
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

(async () => {
  const f = databaseFixture({});
  const writable = makeClient(f.db);
  await writable.call('a', 'account.session');
  await writable.call('b', 'account.session');
  const rows = [];
  const samples = [];
  let seq = 0;
  function add(mode, name, identity, action, request, response, expected) {
    seq += 1;
    rows.push({
      seq,
      mode,
      case: name,
      action,
      identity,
      expected,
      actual: actualOf(response),
      status: 'PASS',
      evidence: 'final-campus-service.json#' + name,
    });
    samples.push({ name, mode, action, identity, request: sanitize(request), response });
  }

  for (const action of ['campus.checkIn', 'campus.checkins', 'campus.checkinHistory']) {
    const result = await makeClient(f.db).call(
      'a',
      action,
      action === 'campus.checkIn' ? { placeId: PLACE_A } : {},
    );
    add(
      'candidate-closed',
      'unauth-' + action,
      'guest',
      action,
      result.request,
      result.response,
      'ok=false, UNAUTHENTICATED',
    );
    assert.equal(result.response.ok, false);
    assert.equal(result.response.error.code, 'UNAUTHENTICATED');
  }

  const first = await writable.call('a', 'campus.checkIn', { placeId: PLACE_A }, 'req_c4_original');
  add(
    'candidate-closed',
    'first-checkin',
    'A',
    'campus.checkIn',
    first.request,
    first.response,
    'ok=true, date 2026-11-27',
  );
  assert.equal(first.response.data.date, '2026-11-27');

  const second = await writable.call('a', 'campus.checkIn', { placeId: PLACE_B });
  add(
    'candidate-closed',
    'second-place',
    'A',
    'campus.checkIn',
    second.request,
    second.response,
    'ok=true, same day second place',
  );
  const duplicate = await writable.call('a', 'campus.checkIn', { placeId: PLACE_A });
  add(
    'candidate-closed',
    'duplicate-same-place',
    'A',
    'campus.checkIn',
    duplicate.request,
    duplicate.response,
    'ok=true, no new row',
  );
  assert.equal(countRows(f, OWNER_A), 2);

  const page1 = await writable.call('a', 'campus.checkinHistory', { page: 1, pageSize: 1 });
  add(
    'candidate-closed',
    'history-page1',
    'A',
    'campus.checkinHistory',
    page1.request,
    page1.response,
    'items=1, total=2, hasMore=true',
  );
  assert.equal(page1.response.data.items.length, 1);
  assert.equal(page1.response.data.total, 2);
  assert.equal(page1.response.data.hasMore, true);
  const page2 = await writable.call('a', 'campus.checkinHistory', { page: 2, pageSize: 1 });
  add(
    'candidate-closed',
    'history-page2',
    'A',
    'campus.checkinHistory',
    page2.request,
    page2.response,
    'items=1, total=2, hasMore=false',
  );
  assert.equal(page2.response.data.items.length, 1);
  assert.equal(page2.response.data.hasMore, false);
  const bHistory = await writable.call('b', 'campus.checkinHistory', {});
  add(
    'candidate-closed',
    'b-history-empty',
    'B',
    'campus.checkinHistory',
    bHistory.request,
    bHistory.response,
    'items=0, total=0',
  );
  assert.equal(bHistory.response.data.total, 0);

  writable.setNow('2026-11-27T16:00:01.000Z');
  const replay = await writable.call(
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    'req_c4_original',
  );
  add(
    'candidate-closed',
    'cross-day-replay',
    'A',
    'campus.checkIn',
    replay.request,
    replay.response,
    'ok=true, date 2026-11-27',
  );
  assert.equal(replay.response.data.date, '2026-11-27');
  const nextDay = await writable.call('a', 'campus.checkIn', { placeId: PLACE_A });
  add(
    'candidate-closed',
    'cross-day-new',
    'A',
    'campus.checkIn',
    nextDay.request,
    nextDay.response,
    'ok=true, date 2026-11-28',
  );
  assert.equal(nextDay.response.data.date, '2026-11-28');

  f.put('place_checkins', {
    _id: checkinId(OWNER_A, RETIRED, '2026-11-27'),
    ownerId: OWNER_A,
    placeId: RETIRED,
    date: '2026-11-27',
    completedAt: '2026-11-27T02:00:00.000Z',
  });
  const retiredHistory = await writable.call('a', 'campus.checkinHistory', {});
  add(
    'candidate-closed',
    'retired-history',
    'A',
    'campus.checkinHistory',
    retiredHistory.request,
    retiredHistory.response,
    'total=4, retired place present',
  );
  assert.equal(retiredHistory.response.data.total, 4);
  const retiredWrite = await writable.call('a', 'campus.checkIn', { placeId: RETIRED });
  add(
    'candidate-closed',
    'retired-write',
    'A',
    'campus.checkIn',
    retiredWrite.request,
    retiredWrite.response,
    'ok=false, INVALID_INPUT',
  );
  assert.equal(retiredWrite.response.error.code, 'INVALID_INPUT');

  // Final candidate: check-in writes paused. Reads and original receipts stay.
  const paused = makeClient(f.db, { paused: true, start: '2026-11-27T16:00:01.000Z' });
  await paused.call('a', 'account.session');
  const pausedHistory = await paused.call('a', 'campus.checkinHistory', {});
  add(
    'candidate-paused',
    'paused-history',
    'A',
    'campus.checkinHistory',
    pausedHistory.request,
    pausedHistory.response,
    'total=4',
  );
  assert.equal(pausedHistory.response.data.total, 4);
  const pausedReplay = await paused.call(
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    'req_c4_original',
  );
  add(
    'candidate-paused',
    'paused-original-receipt',
    'A',
    'campus.checkIn',
    pausedReplay.request,
    pausedReplay.response,
    'ok=true, date 2026-11-27, replayed',
  );
  assert.equal(pausedReplay.response.data.date, '2026-11-27');
  assert.equal(pausedReplay.response.data.replayed, true);
  const pausedWrite = await paused.call(
    'a',
    'campus.checkIn',
    { placeId: PLACE_B },
    'req_c4_paused_new',
  );
  add(
    'candidate-paused',
    'paused-new-write',
    'A',
    'campus.checkIn',
    pausedWrite.request,
    pausedWrite.response,
    'ok=false, NOT_IMPLEMENTED',
  );
  assert.equal(pausedWrite.response.error.code, 'NOT_IMPLEMENTED');
  assert.equal(countRows(f, OWNER_A), 4);

  fs.mkdirSync(OUT, { recursive: true });
  const header = [
    'seq',
    'mode',
    'case',
    'action',
    'identity',
    'expected',
    'actual',
    'status',
    'evidence',
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
  fs.writeFileSync(path.join(OUT, 'final-campus-service.csv'), csv + '\n', 'utf8');
  fs.writeFileSync(
    path.join(OUT, 'final-campus-service.json'),
    JSON.stringify(
      {
        _comment:
          'C4 JH final candidate check. Frozen product tree 00c59a1; task mode closed; new check-ins paused. Local production entry + simulated database only.',
        task: 'C4-JH',
        recordedAt: '2026-11-28',
        frozenSource: FROZEN,
        baseline:
          '20f6156 (product tree equals frozen source for cloudfunctions/miniprogram/database)',
        mode: 'closed / campus check-in writes paused',
        cases: samples,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log('wrote final-campus-service.csv (' + rows.length + ' rows) and JSON');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
