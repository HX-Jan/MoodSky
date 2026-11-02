#!/usr/bin/env node
// W3 JH01-JH05 local evidence generator (Junhan Huang).
//
// Runs the real campus/admin router against the in-memory repositories and the
// shared week-two fixtures, with a pinned clock. It performs no network or
// CloudBase call. The output is the request/response record referenced by
// docs/week3/Junhan_Huang/README.md.
//
//   node tools/week3-jh/run-evidence.cjs [output-dir]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRouter } = require('../../cloudfunctions/moodsky/router');
const { ACTIONS } = require('../../cloudfunctions/moodsky/shared/contracts');
const { createMemoryRepositories } = require('../../tests/support/campus-repository');
const fixtures = require('../../tests/support/campus-fixtures');
const {
  collectPersonalCampusData,
  clearPersonalCampusData,
} = require('../../cloudfunctions/moodsky/domains/campus-personal');

const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'docs', 'week3', 'Junhan_Huang');
const NOW = fixtures.NOW;
const NOW_ISO = new Date(NOW).toISOString();

const ACCOUNTS = {
  'openid-op': { id: 'acc_op', status: 'active' },
  'openid-op2': { id: 'acc_op2', status: 'active' },
  'openid-off': { id: 'acc_off', status: 'disabled' },
  'openid-student': { id: 'acc_student', status: 'active' },
  'openid-student2': { id: 'acc_student2', status: 'active' },
};
const OPERATORS = ['acc_op', 'acc_op2'];

function createContext(seed = {}) {
  const repositories = createMemoryRepositories({
    places: fixtures.places,
    supportResources: fixtures.supportResources,
    taskTemplates: fixtures.taskTemplates,
    corrections: [],
    ...seed,
  });
  const router = createRouter({
    repositories,
    now: () => NOW,
    resolveAccount: async (openid) => ACCOUNTS[openid] || null,
    resolveOperatorRoles: async (accountId) =>
      OPERATORS.includes(accountId) ? ['data_operator'] : [],
  });
  let sequence = 0;
  async function call(action, payload = {}, openid) {
    sequence += 1;
    const request = {
      apiVersion: '1',
      requestId: 'req_w3_' + String(sequence).padStart(4, '0'),
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

function keysOf(items) {
  return items.length > 0 ? Object.keys(items[0]) : [];
}

// ---------------------------------------------------------------------------
// JH01: action/field matrix
// ---------------------------------------------------------------------------
const IMPLEMENTATION = {
  'campus.listPlaces': ['implemented', 'Public verified list, campus/tag filters, stable paging.'],
  'campus.getPlace': [
    'implemented',
    'Public detail; expired rows degrade to stale without contact/location.',
  ],
  'campus.favorites': ['implemented', 'Private list/add/remove, owner from trusted actor.'],
  'campus.correctPlace': ['implemented', 'Private 1-200 code point submission; pending review.'],
  'campus.supportResources': [
    'implemented',
    'Verified resources only; empty state instead of a hotline.',
  ],
  'campus.weatherPreview': [
    'implemented',
    'Fixed simulation label; no private or real campus weather.',
  ],
  'admin.listPlaces': [
    'implemented',
    'Includes unverified/synthetic/disabled with verificationState.',
  ],
  'admin.getPlace': ['implemented', 'Maintenance view including verifiedBy/isSynthetic.'],
  'admin.listCorrections': ['implemented', 'Review queue; submitter account never returned.'],
  'admin.listTaskTemplates': ['implemented', 'Read only, minimal projection.'],
  'admin.listSupportResources': ['implemented', 'Read only with verificationState.'],
  'admin.updatePlace': ['implemented', 'Whitelist, server stamps, transaction + re-read.'],
  'admin.reviewCorrection': [
    'implemented',
    'W3: terminal approved/rejected, idempotent replay, never edits the place.',
  ],
  'admin.updateTaskTemplate': ['not_implemented', 'Template fields not agreed; no pretend save.'],
  'admin.updateSupportResource': [
    'not_implemented',
    'Support resource fields not agreed; no pretend save.',
  ],
};

const PAYLOADS = {
  'campus.listPlaces': ['campus', 'tags', 'openState', 'page', 'pageSize'],
  'campus.getPlace': ['placeId'],
  'campus.favorites': ['operation', 'placeId', 'page', 'pageSize'],
  'campus.correctPlace': ['placeId', 'text'],
  'campus.supportResources': [],
  'campus.weatherPreview': [],
  'admin.listPlaces': ['campus', 'enabled', 'verificationState', 'page', 'pageSize'],
  'admin.getPlace': ['placeId'],
  'admin.listCorrections': ['status', 'page', 'pageSize'],
  'admin.listTaskTemplates': ['enabled', 'page', 'pageSize'],
  'admin.listSupportResources': ['campus', 'enabled', 'page', 'pageSize'],
  'admin.updatePlace': ['placeId', 'changes', 'markVerified', 'expectedUpdatedAt'],
  'admin.reviewCorrection': ['correctionId', 'decision', 'note'],
  'admin.updateTaskTemplate': [],
  'admin.updateSupportResource': [],
};

const matrix = Object.entries(ACTIONS)
  .filter(([name]) => name.startsWith('campus.') || name.startsWith('admin.'))
  .map(([name, definition]) => ({
    action: name,
    domain: definition.domain,
    access: definition.access,
    mutates: definition.mutates,
    requirements: [...definition.requirements],
    payloadFields: PAYLOADS[name] || [],
    implementation: IMPLEMENTATION[name][0],
    note: IMPLEMENTATION[name][1],
  }));

writeJson('w3-jh01-contract-matrix.json', {
  _comment:
    'W3 JH01 action and field matrix generated from the shared registry. "implemented" means the handler and tests exist in this branch; it does not mean the production entry is wired or the cloud has been verified.',
  task: 'W3 JH01',
  owner: 'Junhan Huang',
  recordedAt: '2026-10-29',
  baseline: '78de000 (origin/main at implementation start)',
  wiring: {
    factory: 'createCampusBackend(cloud) in cloudfunctions/moodsky/wiring.js',
    productionEntry:
      'index.js still calls createRouter() without repositories; unwired calls answer NOT_IMPLEMENTED.',
    status: 'local only; enabling the entry is an interface-PR decision',
  },
  publicSummaryFields: [
    'placeId',
    'name',
    'campus',
    'tags',
    'openState',
    'openHours',
    'address',
    'accessible',
    'verificationState',
  ],
  adminPlaceFields: [
    'placeId',
    'name',
    'campus',
    'tags',
    'openState',
    'openHours',
    'address',
    'contact',
    'accessible',
    'location',
    'source',
    'verifiedAt',
    'verifiedBy',
    'validUntil',
    'enabled',
    'isSynthetic',
    'updatedAt',
    'updatedBy',
    'verificationState',
  ],
  matrix,
  sampleFiles: [
    'w3-jh02-public-query-records.json',
    'w3-jh03-role-and-maintenance-records.json',
    'w3-jh04-favorites-correction-records.json',
    'w3-jh05-export-cleanup-records.json',
  ],
});

// ---------------------------------------------------------------------------
// JH02: public query records
// ---------------------------------------------------------------------------
async function jh02() {
  const { call } = createContext();
  const cases = [];
  async function add(name, action, payload, note) {
    const record = await call(action, payload);
    cases.push({ name, note, ...record });
  }

  await add('default-list', 'campus.listPlaces', {}, 'Only verified, enabled, non-expired rows.');
  await add('campus-filter', 'campus.listPlaces', { campus: '东校区' }, 'Exact campus match.');
  await add('tag-filter', 'campus.listPlaces', { tags: ['STUDY'] }, 'Any-of tag filter.');
  await add(
    'second-page',
    'campus.listPlaces',
    { page: 2, pageSize: 2 },
    'Stable ordering, page 2.',
  );
  await add(
    'empty-result',
    'campus.listPlaces',
    { campus: '西校区' },
    'Expired row is not public.',
  );
  await add('detail-verified', 'campus.getPlace', { placeId: 'p_library' }, 'Full detail.');
  await add(
    'detail-expired',
    'campus.getPlace',
    { placeId: 'p_old' },
    'stale + no contact/location.',
  );
  await add(
    'detail-synthetic',
    'campus.getPlace',
    { placeId: 'p_synthetic' },
    'Synthetic rows answer NOT_FOUND.',
  );
  await add('support-resources', 'campus.supportResources', {}, 'Verified resource only.');
  await add('invalid-page-size', 'campus.listPlaces', { pageSize: 21 }, 'INVALID_INPUT.');
  await add(
    'unknown-field',
    'campus.listPlaces',
    { keyword: '图书馆' },
    'Unagreed filter rejected, not silently ignored.',
  );

  const fieldWhitelist = {
    publicSummary: keysOf(cases[0].response.data.items),
    publicDetail: Object.keys(cases[5].response.data),
    expiredDetail: Object.keys(cases[6].response.data),
    supportResource: keysOf(cases[8].response.data.items),
    note: 'Keys were read from the actual responses above, not copied from the rule module.',
  };

  writeJson('w3-jh02-public-query-records.json', {
    _comment:
      'W3 JH02 public query records. Executed through the real router against in-memory repositories with a pinned clock 2026-10-23T00:00:00Z; no CloudBase call.',
    task: 'W3 JH02',
    owner: 'Junhan Huang',
    environment: 'node 24 / local createRouter + memory repository',
    fixedClock: NOW_ISO,
    fixtures: 'tests/support/campus-fixtures.js',
    fieldWhitelist,
    cases,
  });
}

// ---------------------------------------------------------------------------
// JH03: role gate and maintenance chain
// ---------------------------------------------------------------------------
async function jh03() {
  const { repositories, call } = createContext();
  const cases = [];
  async function add(name, action, payload, openid, note) {
    const record = await call(action, payload, openid);
    cases.push({ name, note, ...record });
  }

  await add('no-trusted-identity', 'admin.getPlace', { placeId: 'p_library' }, null, 'No OPENID.');
  await add(
    'unknown-account',
    'admin.getPlace',
    { placeId: 'p_library' },
    'openid-ghost',
    'OPENID has no internal account.',
  );
  await add(
    'ordinary-account',
    'admin.getPlace',
    { placeId: 'p_library' },
    'openid-student',
    'Active account without data_operator.',
  );
  await add(
    'disabled-operator',
    'admin.getPlace',
    { placeId: 'p_library' },
    'openid-off',
    'ACCOUNT_DISABLED is decided before roles.',
  );
  await add(
    'forged-client-role',
    'admin.getPlace',
    { placeId: 'p_library', role: 'data_operator' },
    'openid-op',
    'Identity fields rejected at the router.',
  );

  const before = await call('admin.getPlace', { placeId: 'p_nosource' }, 'openid-op');
  cases.push({
    name: 'operator-read-unverified',
    note: 'Operator can see the unverified row.',
    ...before,
  });
  const publicBefore = await call('campus.getPlace', { placeId: 'p_nosource' });
  cases.push({
    name: 'public-read-before-verification',
    note: 'Public cannot see it before verification.',
    ...publicBefore,
  });
  const update = await call(
    'admin.updatePlace',
    {
      placeId: 'p_nosource',
      changes: { source: '校园官网 2026-10-28' },
      markVerified: true,
    },
    'openid-op',
  );
  cases.push({
    name: 'operator-update-and-verify',
    note: 'Server stamps verifiedAt/By.',
    ...update,
  });
  const reread = await call('admin.getPlace', { placeId: 'p_nosource' }, 'openid-op');
  cases.push({ name: 'operator-reread', note: 'Re-read confirms the stored value.', ...reread });
  const publicAfter = await call('campus.getPlace', { placeId: 'p_nosource' });
  cases.push({
    name: 'public-read-after-verification',
    note: 'Now visible with the new source.',
    ...publicAfter,
  });

  const stale = await call(
    'admin.updatePlace',
    {
      placeId: 'p_library',
      changes: { name: '旧页面覆盖' },
      expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
    },
    'openid-op',
  );
  cases.push({ name: 'stale-version-conflict', note: 'CONFLICT, no write.', ...stale });

  const backdated = await call(
    'admin.updatePlace',
    {
      placeId: 'p_library',
      changes: { verifiedAt: '2026-01-01T00:00:00.000Z' },
    },
    'openid-op',
  );
  cases.push({
    name: 'client-cannot-stamp-verification',
    note: 'Client-supplied verifiedAt is INVALID_INPUT.',
    ...backdated,
  });

  writeJson('w3-jh03-role-and-maintenance-records.json', {
    _comment:
      'W3 JH03 role gate and first maintenance chain. Local router with in-memory accounts/roles/repositories; no real operator_roles collection or Web identity.',
    task: 'W3 JH03',
    owner: 'Junhan Huang',
    environment: 'node 24 / local createRouter',
    fixedClock: NOW_ISO,
    cases,
    observedPlace: repositories._state.places.find((row) => row.placeId === 'p_nosource'),
  });
}

// ---------------------------------------------------------------------------
// JH04: favorites, corrections and review boundary
// ---------------------------------------------------------------------------
async function jh04() {
  const { repositories, call } = createContext();
  const cases = [];
  async function add(name, action, payload, openid, note) {
    const record = await call(action, payload, openid);
    cases.push({ name, note, ...record });
  }

  await add(
    'favorite-add',
    'campus.favorites',
    { operation: 'add', placeId: 'p_library' },
    'openid-student',
    'Owner from trusted actor.',
  );
  await add(
    'favorite-add-again',
    'campus.favorites',
    { operation: 'add', placeId: 'p_library' },
    'openid-student',
    'duplicated: true, not an error.',
  );
  await add(
    'favorite-list',
    'campus.favorites',
    { operation: 'list' },
    'openid-student',
    'Only the caller rows.',
  );
  await add(
    'other-account-list',
    'campus.favorites',
    { operation: 'list' },
    'openid-student2',
    'Cross-account isolation.',
  );
  await add(
    'forged-owner',
    'campus.favorites',
    { operation: 'list', ownerId: 'acc_student2' },
    'openid-student',
    'Router rejects identity fields.',
  );

  const text200 = '校'.repeat(200);
  await add(
    'correction-200-code-points',
    'campus.correctPlace',
    { placeId: 'p_library', text: text200 },
    'openid-student',
    '200 code points accepted, still private.',
  );
  await add(
    'correction-201-code-points',
    'campus.correctPlace',
    { placeId: 'p_library', text: '校'.repeat(201) },
    'openid-student',
    '201 rejected.',
  );

  const correctionId = repositories._state.corrections[0]._id;
  const placeBefore = JSON.stringify(
    repositories._state.places.find((p) => p.placeId === 'p_library'),
  );
  await add(
    'review-approve',
    'admin.reviewCorrection',
    { correctionId, decision: 'approved', note: '已电话核对。' },
    'openid-op',
    'Records operator/time; placeUpdated false.',
  );
  await add(
    'review-replay',
    'admin.reviewCorrection',
    { correctionId, decision: 'approved' },
    'openid-op',
    'Idempotent replay.',
  );
  await add(
    'review-flip',
    'admin.reviewCorrection',
    { correctionId, decision: 'rejected' },
    'openid-op',
    'Terminal decision conflict.',
  );
  const placeAfter = JSON.stringify(
    repositories._state.places.find((p) => p.placeId === 'p_library'),
  );

  await add(
    'favorite-remove',
    'campus.favorites',
    { operation: 'remove', placeId: 'p_library' },
    'openid-student',
    'removed: true.',
  );
  await add(
    'favorite-remove-again',
    'campus.favorites',
    { operation: 'remove', placeId: 'p_library' },
    'openid-student',
    'removed: false, idempotent.',
  );

  writeJson('w3-jh04-favorites-correction-records.json', {
    _comment:
      'W3 JH04 favorites/corrections and the review boundary. Approving a correction never edits the place record; this file records placeBefore/placeAfter equality.',
    task: 'W3 JH04',
    owner: 'Junhan Huang',
    environment: 'node 24 / local createRouter + memory repository',
    fixedClock: NOW_ISO,
    cases,
    placeUnchangedByReview: placeBefore === placeAfter,
    queueAfterReview: repositories._state.corrections.map((row) => ({
      correctionId: row._id,
      status: row.status,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
    })),
  });
}

// ---------------------------------------------------------------------------
// JH05: export and idempotent cleanup
// ---------------------------------------------------------------------------
async function jh05() {
  const { repositories, call } = createContext();
  const student = 'openid-student';
  await call('campus.favorites', { operation: 'add', placeId: 'p_library' }, student);
  await call('campus.favorites', { operation: 'add', placeId: 'p_gym' }, student);
  await call('campus.correctPlace', { placeId: 'p_library', text: '开放时间已调整。' }, student);

  const sharedBefore = {
    places: repositories._state.places.length,
    supportResources: repositories._state.supportResources.length,
    taskTemplates: repositories._state.taskTemplates.length,
  };
  // A disabled account is cleaned by its trusted accountId after account.close;
  // the campus module does not re-check account status itself.
  await repositories.favorites.add('acc_off', 'p_library', '2026-10-01T00:00:00.000Z');
  const disabledAccountCleanup = await clearPersonalCampusData({
    repositories,
    accountId: 'acc_off',
  });
  const exported = await collectPersonalCampusData({
    repositories,
    accountId: 'acc_student',
  });
  const first = await clearPersonalCampusData({ repositories, accountId: 'acc_student' });
  const afterFirst = await collectPersonalCampusData({
    repositories,
    accountId: 'acc_student',
  });
  const second = await clearPersonalCampusData({ repositories, accountId: 'acc_student' });
  const sharedAfter = {
    places: repositories._state.places.length,
    supportResources: repositories._state.supportResources.length,
    taskTemplates: repositories._state.taskTemplates.length,
  };

  writeJson('w3-jh05-export-cleanup-records.json', {
    _comment:
      'W3 JH05 campus personal-data export and cleanup. Calls the handover module directly (not a public action); no file, credential or restore marker is produced.',
    task: 'W3 JH05',
    owner: 'Junhan Huang',
    environment: 'node 24 / memory repository',
    account: 'acc_student',
    disabledAccountCleanup,
    exportBeforeCleanup: exported,
    firstCleanup: first,
    exportAfterFirstCleanup: afterFirst,
    secondCleanup: second,
    sharedBefore,
    sharedAfter,
    sharedRetained: JSON.stringify(sharedBefore) === JSON.stringify(sharedAfter),
    dataReview: {
      file: 'w3-jh05-data-review.csv',
      rows: 0,
      status: 'blocked',
      reason:
        'Qinghan W3 QH01 has not delivered verified sources/dates; the table keeps its header and no synthetic row is filled.',
    },
  });
}

(async () => {
  await jh02();
  await jh03();
  await jh04();
  await jh05();
  console.log('wrote W3 JH01-JH05 records to ' + OUT);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
