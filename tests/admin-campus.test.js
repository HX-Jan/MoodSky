const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('./support/campus-repository');
const fixtures = require('./support/campus-fixtures');

const { NOW } = fixtures;
const NOW_ISO = new Date(NOW).toISOString();

const ACCOUNTS = {
  'openid-op': { id: 'acc_op', status: 'active' },
  'openid-op2': { id: 'acc_op2', status: 'active' },
  'openid-off': { id: 'acc_off', status: 'disabled' },
  'openid-student': { id: 'acc_student', status: 'active' },
};
const OPERATORS = ['acc_op', 'acc_op2'];

let sequence = 0;
function request(action, payload = {}) {
  sequence += 1;
  return {
    apiVersion: '1',
    requestId: 'req_admin_' + String(sequence).padStart(4, '0'),
    action,
    payload,
  };
}

function buildRouter(repositories) {
  return createRouter({
    repositories,
    now: () => NOW,
    resolveAccount: async (openid) => ACCOUNTS[openid] || null,
    resolveOperatorRoles: async (accountId) =>
      OPERATORS.includes(accountId) ? ['data_operator'] : [],
  });
}

function seed() {
  return createMemoryRepositories({
    places: fixtures.places,
    supportResources: fixtures.supportResources,
    taskTemplates: fixtures.taskTemplates,
    corrections: fixtures.corrections,
  });
}

async function operatorCall(repositories, action, payload, openid = 'openid-op') {
  return buildRouter(repositories)(request(action, payload), { OPENID: openid });
}

async function publicCall(repositories, action, payload) {
  return buildRouter(repositories)(request(action, payload));
}

const ADMIN_READS = [
  'admin.listPlaces',
  'admin.getPlace',
  'admin.listCorrections',
  'admin.listTaskTemplates',
  'admin.listSupportResources',
];

test('every operator read requires a server-side grant, not a client claim', async () => {
  for (const action of ADMIN_READS) {
    const student = await operatorCall(seed(), action, { placeId: 'p_library' }, 'openid-student');
    assert.equal(student.error.code, 'FORBIDDEN', action);

    const spoofed = await operatorCall(
      seed(),
      action,
      { placeId: 'p_library', role: 'data_operator' },
      'openid-student',
    );
    assert.equal(spoofed.error.code, 'INVALID_REQUEST', action);

    const anonymous = await buildRouter(seed())(request(action, { placeId: 'p_library' }));
    assert.equal(anonymous.error.code, 'UNAUTHENTICATED', action);
  }
});

test('a disabled operator is refused before the role lookup, as week one recorded', async () => {
  const result = await operatorCall(seed(), 'admin.listPlaces', {}, 'openid-off');
  assert.equal(result.error.code, 'ACCOUNT_DISABLED');
});

test('the operator list shows what the public list hides, with the reason', async () => {
  const result = await operatorCall(seed(), 'admin.listPlaces', { pageSize: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.data.total, fixtures.places.length);
  const states = Object.fromEntries(
    result.data.items.map((item) => [item.placeId, item.verificationState]),
  );
  assert.equal(states.p_library, 'verified');
  assert.equal(states.p_canteen, 'expiring');
  assert.equal(states.p_old, 'expired');
  assert.equal(states.p_synthetic, 'synthetic');
  assert.equal(states.p_disabled, 'disabled');
  assert.equal(states.p_nosource, 'unverified');
  assert.equal(states.p_nodate, 'unverified');
});

test('the operator view is filterable and never carries private journal fields', async () => {
  const repositories = seed();
  const expired = await operatorCall(repositories, 'admin.listPlaces', {
    verificationState: 'expired',
  });
  assert.deepEqual(
    expired.data.items.map((item) => item.placeId),
    ['p_old'],
  );
  const disabledOnly = await operatorCall(repositories, 'admin.listPlaces', { enabled: false });
  assert.deepEqual(
    disabledOnly.data.items.map((item) => item.placeId),
    ['p_disabled'],
  );
  const campusOnly = await operatorCall(repositories, 'admin.listPlaces', { campus: '东校区' });
  assert.deepEqual(
    campusOnly.data.items.map((item) => item.placeId),
    ['p_canteen'],
  );

  const detail = await operatorCall(repositories, 'admin.getPlace', { placeId: 'p_library' });
  assert.equal(detail.data.verifiedBy, 'Junhan Huang');
  assert.equal(detail.data.isSynthetic, false);
  assert.equal(detail.data.enabled, true);
  const serialised = JSON.stringify(detail.data);
  for (const forbidden of ['ownerId', '"text"', 'weather', 'openid']) {
    assert.equal(serialised.includes(forbidden), false, forbidden);
  }
});

test('unknown place is NOT_FOUND for the operator too', async () => {
  const result = await operatorCall(seed(), 'admin.getPlace', { placeId: 'p_missing' });
  assert.equal(result.error.code, 'NOT_FOUND');
});

test('the place maintenance chain reads, writes and reads back the stored value', async () => {
  const repositories = seed();
  const before = await operatorCall(repositories, 'admin.getPlace', { placeId: 'p_library' });
  assert.equal(before.data.name, '图书馆');

  const written = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { name: '中心图书馆', openHours: '08:00-23:00' },
  });
  assert.equal(written.ok, true);
  assert.equal(written.data.saved, true);
  assert.equal(written.data.verified, true);
  assert.equal(written.data.place.name, '中心图书馆');
  assert.equal(written.data.place.openHours, '08:00-23:00');
  // The server, not the caller, stamps who wrote and when.
  assert.equal(written.data.place.updatedBy, 'acc_op');
  assert.equal(written.data.place.updatedAt, NOW_ISO);
  // The previous verification is preserved: a rename is not a re-verification.
  assert.equal(written.data.place.verifiedBy, 'Junhan Huang');
  assert.equal(written.data.place.verifiedAt, '2026-10-01T00:00:00.000Z');

  const reread = await operatorCall(repositories, 'admin.getPlace', { placeId: 'p_library' });
  assert.equal(reread.data.name, '中心图书馆');

  const published = await publicCall(repositories, 'campus.listPlaces', {});
  const entry = published.data.items.find((item) => item.placeId === 'p_library');
  assert.equal(entry.name, '中心图书馆');
});

test('a verification can be granted by an operator and only then publishes a place', async () => {
  const repositories = seed();
  const hidden = await publicCall(repositories, 'campus.getPlace', { placeId: 'p_nosource' });
  assert.equal(hidden.error.code, 'NOT_FOUND');

  const verified = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_nosource',
    changes: { source: '校园官网 2026-10-23', validUntil: '2027-06-01T00:00:00.000Z' },
    markVerified: true,
  });
  assert.equal(verified.data.place.verificationState, 'verified');
  assert.equal(verified.data.place.verifiedBy, 'acc_op');
  assert.equal(verified.data.place.verifiedAt, NOW_ISO);

  const nowVisible = await publicCall(repositories, 'campus.getPlace', { placeId: 'p_nosource' });
  assert.equal(nowVisible.ok, true);
  assert.equal(nowVisible.data.source, '校园官网 2026-10-23');
});

test('marking a place verified without a traceable source is refused', async () => {
  const result = await operatorCall(seed(), 'admin.updatePlace', {
    placeId: 'p_nosource',
    changes: { enabled: true },
    markVerified: true,
  });
  assert.equal(result.error.code, 'INVALID_INPUT');
});

test('verification stamps cannot be supplied by the caller', async () => {
  for (const changes of [
    { verifiedAt: '2020-01-01T00:00:00.000Z' },
    { verifiedBy: 'someone else' },
    { updatedAt: '2020-01-01T00:00:00.000Z' },
    { updatedBy: 'acc_op2' },
  ]) {
    const result = await operatorCall(seed(), 'admin.updatePlace', {
      placeId: 'p_library',
      changes,
    });
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(changes));
  }
});

test('a stale console tab cannot overwrite a newer verification', async () => {
  const repositories = seed();
  const stale = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { name: '太旧的名字' },
    expectedUpdatedAt: '2026-10-02T00:00:00.000Z',
  });
  assert.equal(stale.error.code, 'CONFLICT');
  const untouched = await operatorCall(repositories, 'admin.getPlace', { placeId: 'p_library' });
  assert.equal(untouched.data.name, '图书馆');

  const current = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { name: '中心图书馆' },
    expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
  });
  assert.equal(current.ok, true);
});

test('an operator can withdraw a place from the public list', async () => {
  const repositories = seed();
  const written = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_gym',
    changes: { enabled: false },
  });
  assert.equal(written.data.place.enabled, false);
  const published = await publicCall(repositories, 'campus.listPlaces', {});
  assert.equal(
    published.data.items.some((item) => item.placeId === 'p_gym'),
    false,
  );
});

test('operator writes accept campus fields only', async () => {
  const repositories = seed();
  const journalField = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { text: '私人正文' },
  });
  assert.equal(journalField.error.code, 'INVALID_INPUT');

  const unknownPayload = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { name: '图书馆' },
    authorized: true,
  });
  assert.equal(unknownPayload.error.code, 'INVALID_INPUT');

  const emptyChanges = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: {},
  });
  assert.equal(emptyChanges.error.code, 'INVALID_INPUT');

  const badTag = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { tags: ['STUDY', 'STUDY'] },
  });
  assert.equal(badTag.error.code, 'INVALID_INPUT');

  const badCoordinates = await operatorCall(repositories, 'admin.updatePlace', {
    placeId: 'p_library',
    changes: { location: { latitude: 120, longitude: 121 } },
  });
  assert.equal(badCoordinates.error.code, 'INVALID_INPUT');

  const verifiedStaysUntouched = await operatorCall(repositories, 'admin.getPlace', {
    placeId: 'p_library',
  });
  assert.equal(verifiedStaysUntouched.data.name, '图书馆');
});

test('the correction queue is readable and never exposes the submitter', async () => {
  const repositories = seed();
  const pending = await operatorCall(repositories, 'admin.listCorrections', { status: 'pending' });
  assert.equal(pending.data.total, 1);
  assert.equal(pending.data.items[0].placeId, 'p_library');
  assert.equal(pending.data.items[0].status, 'pending');
  assert.equal(JSON.stringify(pending.data).includes('acc_other'), false);

  const approved = await operatorCall(repositories, 'admin.listCorrections', {
    status: 'approved',
  });
  assert.deepEqual(approved.data.items, []);

  const invalid = await operatorCall(repositories, 'admin.listCorrections', { status: 'hidden' });
  assert.equal(invalid.error.code, 'INVALID_INPUT');
});

test('task templates and support resources are readable with their verification state', async () => {
  const repositories = seed();
  const templates = await operatorCall(repositories, 'admin.listTaskTemplates', {});
  assert.equal(templates.data.total, 3);
  const enabledTemplates = await operatorCall(repositories, 'admin.listTaskTemplates', {
    enabled: true,
  });
  assert.equal(enabledTemplates.data.total, 2);

  const resources = await operatorCall(repositories, 'admin.listSupportResources', {});
  assert.equal(resources.data.total, 3);
  const states = Object.fromEntries(
    resources.data.items.map((item) => [item.resourceId, item.verificationState]),
  );
  assert.equal(states.r_hotline, 'verified');
  assert.equal(states.r_expired, 'expired');
  assert.equal(states.r_synthetic, 'synthetic');
});

test('actions outside the place chain still refuse to pretend they saved', async () => {
  const repositories = seed();
  for (const action of ['admin.updateTaskTemplate', 'admin.updateSupportResource']) {
    const result = await operatorCall(repositories, action, { placeId: 'p_library' });
    assert.equal(result.error.code, 'NOT_IMPLEMENTED', action);
    assert.equal(result.ok, false);
  }
});

test('reviewing a correction records the operator and never edits the place', async () => {
  const repositories = seed();
  const correctionId = repositories._state.corrections[0]._id;
  const placeBefore = await operatorCall(repositories, 'admin.getPlace', { placeId: 'p_library' });

  const result = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'approved',
    note: '已电话核对开放时间。',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.reviewed, true);
  assert.equal(result.data.placeUpdated, false);
  assert.equal(result.data.correction.status, 'approved');
  assert.equal(result.data.correction.reviewedBy, 'acc_op');
  assert.equal(result.data.correction.reviewedAt, NOW_ISO);
  assert.equal(result.data.correction.reviewNote, '已电话核对开放时间。');
  assert.equal(JSON.stringify(result.data).includes('acc_other'), false);

  const queue = await operatorCall(repositories, 'admin.listCorrections', { status: 'approved' });
  assert.equal(queue.data.total, 1);
  assert.equal(queue.data.items[0].correctionId, correctionId);

  const placeAfter = await operatorCall(repositories, 'admin.getPlace', { placeId: 'p_library' });
  assert.deepEqual(placeAfter.data, placeBefore.data);
});

test('a rejected correction is terminal and a different decision conflicts', async () => {
  const repositories = seed();
  const correctionId = repositories._state.corrections[0]._id;
  const rejected = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'rejected',
  });
  assert.equal(rejected.data.correction.status, 'rejected');
  assert.equal(rejected.data.correction.reviewNote, null);

  const replay = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'rejected',
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.reviewed, false);
  assert.equal(replay.data.alreadyReviewed, true);

  const flipped = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'approved',
  });
  assert.equal(flipped.error.code, 'CONFLICT');
  assert.equal(repositories._state.corrections[0].status, 'rejected');
});

test('review validation rejects unknown ids, bad decisions and identity fields', async () => {
  const repositories = seed();
  const correctionId = repositories._state.corrections[0]._id;

  const missing = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
  });
  assert.equal(missing.error.code, 'INVALID_INPUT');

  const badDecision = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'pending',
  });
  assert.equal(badDecision.error.code, 'INVALID_INPUT');

  const extra = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'approved',
    ownerId: 'acc_forged',
  });
  // The router rejects identity fields before the domain sees them.
  assert.equal(extra.error.code, 'INVALID_REQUEST');

  const longNote = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId,
    decision: 'approved',
    note: 'x'.repeat(201),
  });
  assert.equal(longNote.error.code, 'INVALID_INPUT');

  const unknown = await operatorCall(repositories, 'admin.reviewCorrection', {
    correctionId: 'cor_missing',
    decision: 'approved',
  });
  assert.equal(unknown.error.code, 'NOT_FOUND');

  const student = await operatorCall(
    repositories,
    'admin.reviewCorrection',
    { correctionId, decision: 'approved' },
    'openid-student',
  );
  assert.equal(student.error.code, 'FORBIDDEN');
  assert.equal(repositories._state.corrections[0].status, 'pending');
});
