#!/usr/bin/env node
// W6 JH campus check-in request/response samples (Junhan Huang).
//
// Drives the real production entry against the simulated database with fixed
// clocks. Covers unauthenticated calls, A/B isolation, same-day dedupe, original
// receipt replay, cross-day new requests, pagination, pause, retired places and
// export. No CloudBase, phone or real account is used.
//
//   node tools/week6-jh/checkin-samples.cjs [output-dir]
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
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'week6', 'Junhan_Huang');
const BASE_CONFIG = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const PLACE_A = PLACES[0].placeId;
const PLACE_B = PLACES[1].placeId;
const RETIRED = 'fzu-qishan-retired-place';

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
      readConfig: () => ({ ...BASE_CONFIG, campusCheckinWritesPaused: paused }),
      openDatabase: () => db,
      now: () => time,
    });
    const request = {
      apiVersion: '1',
      action,
      payload,
      requestId: requestId || 'req_w6_' + String(++sequence).padStart(4, '0'),
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

(async () => {
  const f = databaseFixture({});
  const writable = makeClient(f.db);
  const cases = [];
  async function record(name, who, action, payload, note, requestId) {
    const result = await writable.call(who, action, payload, requestId);
    cases.push({ name, note, ...result });
    return result;
  }

  // Unauthenticated: all three actions must refuse before any private read.
  await record('unauth-checkin', 'a', 'campus.checkIn', { placeId: PLACE_A }, 'No session scope.');
  await record('unauth-day-status', 'a', 'campus.checkins', {}, 'No session scope.');
  await record('unauth-history', 'a', 'campus.checkinHistory', {}, 'No session scope.');

  await writable.call('a', 'account.session');
  await writable.call('b', 'account.session');

  await record(
    'a-first-checkin',
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    'Server business date is 2026-11-18 (Beijing).',
    'req_w6_a_original',
  );
  await record(
    'a-second-place',
    'a',
    'campus.checkIn',
    { placeId: PLACE_B },
    'A second distinct place on the same day is allowed.',
  );
  await record('a-day-status', 'a', 'campus.checkins', {}, 'Two rows for today.');
  await record(
    'a-history-page1-size1',
    'a',
    'campus.checkinHistory',
    { page: 1, pageSize: 1 },
    'Total reflects all visits; hasMore true.',
  );
  await record(
    'a-history-page2-size1',
    'a',
    'campus.checkinHistory',
    { page: 2, pageSize: 1 },
    'Second page returns the remaining row; hasMore is false.',
  );

  await record('b-history', 'b', 'campus.checkinHistory', {}, 'B cannot see A.');
  await record('b-day-status', 'b', 'campus.checkins', {}, 'B has no visit today.');

  await record(
    'a-replay-same-day',
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    'Reusing the original requestId replays the original row.',
    'req_w6_a_original',
  );
  const concurrent = await Promise.all([
    writable.call('a', 'campus.checkIn', { placeId: PLACE_A }),
    writable.call('a', 'campus.checkIn', { placeId: PLACE_A }),
  ]);
  cases.push({
    name: 'a-same-place-concurrent',
    note: 'Two concurrent taps for the same place/day still leave one row.',
    requests: concurrent.map((entry) => entry.request),
    responses: concurrent.map((entry) => entry.response),
  });

  writable.setNow('2026-11-18T16:00:01.000Z');
  await record(
    'a-replay-after-midnight',
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    'Original requestId still returns the 11-18 row after Beijing midnight.',
    'req_w6_a_original',
  );
  await record(
    'a-new-day-checkin',
    'a',
    'campus.checkIn',
    { placeId: PLACE_A },
    'A new request creates the 11-19 row.',
  );
  await record(
    'a-history-after-cross-day',
    'a',
    'campus.checkinHistory',
    {},
    'Two business dates.',
  );

  // Pause: existing reads/receipts remain, new writes are refused.
  const paused = makeClient(f.db, { paused: true });
  await paused.call('a', 'account.session');
  cases.push({
    name: 'pause-history',
    note: 'History stays readable while writes are paused.',
    ...(await paused.call('a', 'campus.checkinHistory', {})),
  });
  cases.push({
    name: 'pause-new-write',
    note: 'New write answers NOT_IMPLEMENTED.',
    ...(await paused.call('a', 'campus.checkIn', { placeId: PLACE_B })),
  });
  cases.push({
    name: 'pause-original-receipt',
    note: 'Original receipt is still replayed while paused.',
    ...(await paused.call('a', 'campus.checkIn', { placeId: PLACE_A }, 'req_w6_a_original')),
  });

  // Retired place: keep history, reject new writes.
  const ownerA = accountId(BASE_CONFIG, 'a');
  f.put('place_checkins', {
    _id: checkinId(ownerA, RETIRED, '2026-11-18'),
    ownerId: ownerA,
    placeId: RETIRED,
    date: '2026-11-18',
    completedAt: '2026-11-18T02:00:00.000Z',
  });
  await record(
    'retired-history',
    'a',
    'campus.checkinHistory',
    {},
    'Retired place remains in history.',
  );
  await record(
    'retired-new-write',
    'a',
    'campus.checkIn',
    { placeId: RETIRED },
    'Retired place cannot be checked in again.',
  );

  // Export includes the self-reported visits and preserves the minimal fields.
  const exportRequest = await record(
    'a-request-export',
    'a',
    'account.requestExport',
    { format: 'json' },
    'Creates a job for the signed-in account.',
  );
  const jobId = exportRequest.response?.data?.jobId;
  if (jobId) {
    const download = await record(
      'a-download-export',
      'a',
      'account.downloadExport',
      { jobId },
      'Check-in rows are present in the JSON export.',
    );
    try {
      const document = JSON.parse(download.response.data.content);
      cases.push({
        name: 'a-export-checkins',
        note: 'Projected export rows for this account.',
        data: document.data?.checkins,
      });
    } catch {
      cases.push({ name: 'a-export-checkins', note: 'Export content was not JSON.', data: null });
    }
  }

  const summary = {
    unauthenticatedCodes: cases
      .filter((entry) => entry.name.startsWith('unauth-'))
      .map((entry) => entry.response.error?.code || 'ok'),
    checkinRows: (() => {
      const ids = new Set(
        Object.entries(f.inspect())
          .filter(([key]) => key.startsWith('place_checkins:'))
          .map(([, row]) => row.date + '/' + row.placeId),
      );
      return ids.size;
    })(),
    dates: [
      ...new Set(
        Object.entries(f.inspect())
          .filter(([key]) => key.startsWith('place_checkins:'))
          .map(([, row]) => row.date),
      ),
    ].sort(),
    retiredPlaceInHistory: cases.some(
      (entry) =>
        entry.name === 'retired-history' &&
        entry.response?.data?.items?.some((row) => row.placeId === RETIRED),
    ),
    retiredWriteCode: cases.find((entry) => entry.name === 'retired-new-write')?.response?.error
      ?.code,
    pauseNewWriteCode: cases.find((entry) => entry.name === 'pause-new-write')?.response?.error
      ?.code,
    exportCheckinCount:
      cases.find((entry) => entry.name === 'a-export-checkins')?.data?.length ?? null,
  };

  const result = {
    _comment:
      'W6 JH request/response samples. Real production entry + simulated database and fixed clocks; no CloudBase, phone or real account.',
    task: 'W6-JH',
    owner: 'Junhan Huang',
    recordedAt: '2026-11-19',
    baseline: '5b27753',
    environment: 'node 24 / production entry / tests/helpers/w2-database',
    accounts: { A: 'synthetic A', B: 'synthetic B' },
    clocks: {
      first: '2026-11-18T15:59:59.000Z',
      afterMidnight: '2026-11-18T16:00:01.000Z',
    },
    places: { primary: PLACE_A, secondary: PLACE_B, retired: RETIRED },
    summary,
    cases,
  };

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'w6-jh-checkin-samples.json');
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log('wrote ' + path.relative(ROOT, file));
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
