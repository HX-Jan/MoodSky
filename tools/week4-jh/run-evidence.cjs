#!/usr/bin/env node
// W4 JH02/JH05 local evidence (Junhan Huang).
//
// Runs the real campus/admin router and the campus data module against the
// in-memory repositories, using Qinghan's five approved places with a pinned
// clock. No network, CloudBase or database write is performed.
//
//   node tools/week4-jh/run-evidence.cjs [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRouter } = require('../../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('../../tests/support/campus-repository');
const {
  collectPersonalCampusData,
  clearPersonalCampusData,
} = require('../../cloudfunctions/moodsky/domains/campus-personal');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'week4', 'Junhan_Huang');
const NOW = Date.parse('2026-11-07T04:00:00.000Z');
const NOW_ISO = new Date(NOW).toISOString();
const CATALOGUE = path.join(ROOT, 'docs', 'week4', 'qinghan-zhang', 'places-approved-import.json');

const places = fs
  .readFileSync(CATALOGUE, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const ACCOUNTS = {
  'openid-op': { id: 'acc_op', status: 'active' },
  'openid-student': { id: 'acc_student', status: 'active' },
  'openid-student2': { id: 'acc_student2', status: 'active' },
  'openid-off': { id: 'acc_off', status: 'disabled' },
};

function createContext(seed = {}) {
  const repositories = createMemoryRepositories({
    places,
    supportResources: [],
    taskTemplates: [],
    favorites: [],
    corrections: [],
    checkins: [],
    ...seed,
  });
  const router = createRouter({
    repositories,
    now: () => NOW,
    resolveAccount: async (openid) => ACCOUNTS[openid] || null,
    resolveOperatorRoles: async (accountId) => (accountId === 'acc_op' ? ['data_operator'] : []),
  });
  let sequence = 0;
  async function call(action, payload = {}, openid) {
    sequence += 1;
    const request = {
      apiVersion: '1',
      requestId: 'req_w4_' + String(sequence).padStart(4, '0'),
      action,
      payload,
    };
    const response = await router(request, openid ? { OPENID: openid } : undefined);
    return { request, response };
  }
  return { repositories, call };
}

function writeJson(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return file;
}

async function recommendationEvidence() {
  const { call } = createContext();
  const cases = [];
  async function add(name, action, payload, openid, note) {
    const record = await call(action, payload, openid);
    cases.push({ name, note, ...record });
  }

  await add('public-list', 'campus.listPlaces', {}, null, 'Five approved places.');
  await add(
    'public-detail',
    'campus.getPlace',
    { placeId: 'fzu-qishan-dameng-bookhouse' },
    null,
    'Reason and entry restriction are public.',
  );
  await add(
    'admin-read',
    'admin.getPlace',
    { placeId: 'fzu-qishan-dameng-bookhouse' },
    'openid-op',
    'Operator sees the same fields plus maintenance metadata.',
  );
  await add(
    'admin-update-recommendation',
    'admin.updatePlace',
    {
      placeId: 'fzu-qishan-dameng-bookhouse',
      changes: {
        recommendationReason: '安静，适合阅读；插座较少。',
        entryRestrictions: '一层无需消费；二层餐吧需消费。',
      },
    },
    'openid-op',
    'Server stamps updatedAt/By and re-reads.',
  );
  await add(
    'public-after-update',
    'campus.getPlace',
    { placeId: 'fzu-qishan-dameng-bookhouse' },
    null,
    'Public read shows the maintained text.',
  );
  await add(
    'student-forbidden',
    'admin.updatePlace',
    {
      placeId: 'fzu-qishan-dameng-bookhouse',
      changes: { recommendationReason: '学生改写' },
    },
    'openid-student',
    'No operator grant: FORBIDDEN.',
  );
  await add(
    'disabled-operator',
    'admin.updatePlace',
    {
      placeId: 'fzu-qishan-dameng-bookhouse',
      changes: { recommendationReason: '停用运营改写' },
    },
    'openid-off',
    'ACCOUNT_DISABLED before roles.',
  );

  const list = cases.find((entry) => entry.name === 'public-list').response.data.items;
  writeJson('w4-jh02-recommendation-records.json', {
    _comment:
      'W4 JH02 recommendation read/admin records. Real router + memory repository + Qinghan approved places; no CloudBase call.',
    task: 'W4 JH02',
    owner: 'Junhan Huang',
    environment: 'node 24 / local createRouter + memory repository',
    fixedClock: NOW_ISO,
    catalogue: 'docs/week4/qinghan-zhang/places-approved-import.json',
    publicFields: Object.keys(list[0]),
    cases,
  });
}

async function dataEvidence() {
  const { repositories, call } = createContext();
  await call(
    'campus.favorites',
    { operation: 'add', placeId: 'fzu-qishan-dameng-bookhouse' },
    'openid-student',
  );
  await call(
    'campus.correctPlace',
    { placeId: 'fzu-qishan-dameng-bookhouse', text: '营业时间以现场为准。' },
    'openid-student',
  );
  // Canonical check-ins are written by the check-in service; seed one directly
  // in the repository to keep this evidence about export/cleanup, not submit.
  repositories._state.checkins.push({
    _id: 'checkin_acc_student',
    ownerId: 'acc_student',
    placeId: 'fzu-qishan-dameng-bookhouse',
    date: '2026-11-06',
    completedAt: '2026-11-06T10:00:00.000Z',
  });

  const before = {
    places: repositories._state.places.length,
    supportResources: repositories._state.supportResources.length,
    taskTemplates: repositories._state.taskTemplates.length,
  };
  const exported = await collectPersonalCampusData({
    repositories,
    accountId: 'acc_student',
  });
  const first = await clearPersonalCampusData({ repositories, accountId: 'acc_student' });
  const second = await clearPersonalCampusData({ repositories, accountId: 'acc_student' });
  const after = await collectPersonalCampusData({ repositories, accountId: 'acc_student' });
  const sharedAfter = {
    places: repositories._state.places.length,
    supportResources: repositories._state.supportResources.length,
    taskTemplates: repositories._state.taskTemplates.length,
  };

  writeJson('w4-jh05-campus-data-records.json', {
    _comment:
      'W4 JH05 campus personal data: favorites, corrections and self-reported check-ins. No coordinates or photos are exported; shared places are retained.',
    task: 'W4 JH05',
    owner: 'Junhan Huang',
    environment: 'node 24 / memory repository',
    account: 'acc_student',
    exportBeforeCleanup: exported,
    firstCleanup: first,
    secondCleanup: second,
    exportAfterCleanup: after,
    sharedBefore: before,
    sharedAfter,
    sharedRetained: JSON.stringify(before) === JSON.stringify(sharedAfter),
  });
}

(async () => {
  await recommendationEvidence();
  await dataEvidence();
  console.log('wrote W4 JH02/JH05 records to ' + OUT);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
