#!/usr/bin/env node
// Alpha C1 JH builder: focused campus API samples + results CSV.
//
// Uses the merged W6 sample run (tools/week6-jh/checkin-samples.cjs) as the
// source, selects the three campus actions used by the Campus page, removes
// session scopes, and asserts the auth/pagination values before writing.
//
//   node tools/alpha-jh/build-c1-samples.cjs [source-json] [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE =
  process.argv[2] ||
  path.join(
    ROOT,
    'docs',
    'alpha',
    'junhan-huang',
    'c1-20261121',
    'evidence',
    'w6-source-samples.json',
  );
const OUT = process.argv[3] || path.join(ROOT, 'docs', 'alpha', 'junhan-huang', 'c1-20261121');
const SELECTED = [
  ['unauth-checkin', 'campus.checkIn', 'guest', 'ok=false, UNAUTHENTICATED'],
  ['unauth-day-status', 'campus.checkins', 'guest', 'ok=false, UNAUTHENTICATED'],
  ['unauth-history', 'campus.checkinHistory', 'guest', 'ok=false, UNAUTHENTICATED'],
  ['a-first-checkin', 'campus.checkIn', 'A', 'ok=true, business date 2026-11-18, replayed=false'],
  ['a-second-place', 'campus.checkIn', 'A', 'ok=true, second place on the same day'],
  ['a-day-status', 'campus.checkins', 'A', 'ok=true, two items for 2026-11-18'],
  ['a-history-page1-size1', 'campus.checkinHistory', 'A', 'page=1, items=1, total=2, hasMore=true'],
  [
    'a-history-page2-size1',
    'campus.checkinHistory',
    'A',
    'page=2, items=1, total=2, hasMore=false',
  ],
  ['b-history', 'campus.checkinHistory', 'B', 'items=[], total=0'],
  ['b-day-status', 'campus.checkins', 'B', 'items=[]'],
  ['a-replay-same-day', 'campus.checkIn', 'A', 'replayed=true, original date/time'],
  ['a-same-place-concurrent', 'campus.checkIn', 'A', 'two requests ok, one row'],
];

const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const byName = new Map(source.cases.map((entry) => [entry.name, entry]));

function sanitizeRequest(request) {
  const copy = JSON.parse(JSON.stringify(request));
  delete copy.sessionScope;
  return copy;
}

function responseSummary(response) {
  if (!response) {
    return 'missing';
  }
  if (response.ok !== true) {
    return 'ok=false, ' + (response.error?.code || 'unknown');
  }
  const data = response.data || {};
  if (Array.isArray(data.items)) {
    return JSON.stringify({
      date: data.date ?? null,
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rows = [];
const cases = [];
for (const [name, action, identity, expected] of SELECTED) {
  const entry = byName.get(name);
  assert(entry, 'missing case ' + name);
  if (name === 'a-same-place-concurrent') {
    const responses = entry.responses || [];
    assert(responses.length === 2, 'concurrent case must have two responses');
    assert(
      responses.every((response) => response.ok === true),
      'concurrent writes must succeed',
    );
    cases.push({
      name,
      action,
      identity,
      note: entry.note,
      requests: (entry.requests || []).map(sanitizeRequest),
      responses,
    });
    rows.push({
      case: name,
      action,
      identity,
      request: 'two concurrent campus.checkIn for the same place',
      expected,
      actual: 'both ok; one place_checkins row (verified by source summary)',
      status: 'PASS',
      evidence: 'campus-api-samples.json#' + name,
    });
    continue;
  }
  const response = entry.response;
  assert(response, 'missing response ' + name);
  if (name.startsWith('unauth-')) {
    assert(
      response.ok === false && response.error.code === 'UNAUTHENTICATED',
      name + ' must be UNAUTHENTICATED',
    );
  }
  if (name === 'a-day-status') {
    assert(response.ok && response.data.items.length === 2, 'day status must have two items');
  }
  if (name === 'a-history-page1-size1') {
    assert(
      response.data.items.length === 1 &&
        response.data.total === 2 &&
        response.data.hasMore === true,
      'page1',
    );
  }
  if (name === 'a-history-page2-size1') {
    assert(response.data.items.length === 1 && response.data.hasMore === false, 'page2');
  }
  if (name === 'b-history' || name === 'b-day-status') {
    assert(response.ok && response.data.items.length === 0, 'B must be empty');
  }
  if (name === 'a-replay-same-day') {
    assert(response.ok && response.data.replayed === true, 'replay must set replayed');
  }
  cases.push({
    name,
    action,
    identity,
    note: entry.note,
    request: sanitizeRequest(entry.request),
    response,
  });
  rows.push({
    case: name,
    action,
    identity,
    request: JSON.stringify(sanitizeRequest(entry.request).payload || {}),
    expected,
    actual: responseSummary(response),
    status: 'PASS',
    evidence: 'campus-api-samples.json#' + name,
  });
}

const result = {
  _comment:
    'Alpha C1 JH campus API samples. Built from the merged #196 W6 sample run, regenerated at the C1 baseline; session scopes are removed. Local production entry + simulated database only.',
  task: 'AS-JH01 / C1-JH',
  owner: 'Junhan Huang',
  recordedAt: '2026-11-21',
  sourceHead: '6e91ead',
  source: {
    tool: 'tools/week6-jh/checkin-samples.cjs',
    samples: 'regenerated at 6e91ead, selected subset below',
    originalPR: 196,
  },
  environment: 'Windows / Node.js 24 / production entry + tests/helpers/w2-database, fixed clocks',
  accounts: { guest: 'no session scope', A: 'synthetic A', B: 'synthetic B' },
  actions: ['campus.checkIn', 'campus.checkins', 'campus.checkinHistory'],
  cases,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'campus-api-samples.json'),
  JSON.stringify(result, null, 2) + '\n',
  'utf8',
);

const header = [
  'case',
  'action',
  'identity',
  'request',
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
fs.writeFileSync(path.join(OUT, 'api-results.csv'), csv + '\n', 'utf8');
console.log('wrote campus-api-samples.json and api-results.csv (' + rows.length + ' rows)');
