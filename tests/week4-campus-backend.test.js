const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('./support/campus-repository');
const fixtures = require('./support/campus-fixtures');

const NOW = fixtures.NOW;
const ACCOUNTS = {
  'openid-op': { id: 'acc_op', status: 'active' },
  'openid-student': { id: 'acc_student', status: 'active' },
};

let sequence = 0;
function request(action, payload = {}) {
  sequence += 1;
  return {
    apiVersion: '1',
    requestId: 'req_w4_' + String(sequence).padStart(4, '0'),
    action,
    payload,
  };
}

function routerFor(repositories) {
  return createRouter({
    repositories,
    now: () => NOW,
    resolveAccount: async (openid) => ACCOUNTS[openid] || null,
    resolveOperatorRoles: async (accountId) => (accountId === 'acc_op' ? ['data_operator'] : []),
  });
}

function recommendedPlace(extra = {}) {
  return {
    ...fixtures.places[0],
    recommendationReason: '室内座位多，适合阅读和短休。',
    entryRestrictions: '无需预约；考试周开放时间可能调整。',
    ...extra,
  };
}

const called = (repositories, action, payload, openid) =>
  routerFor(repositories)(request(action, payload), openid ? { OPENID: openid } : undefined);

test('public list and detail carry the reviewed recommendation text', async () => {
  const repositories = createMemoryRepositories({ places: [recommendedPlace()] });

  const list = await called(repositories, 'campus.listPlaces', {});
  assert.equal(list.ok, true);
  assert.equal(list.data.items[0].recommendationReason, '室内座位多，适合阅读和短休。');
  assert.equal(list.data.items[0].entryRestrictions, '无需预约；考试周开放时间可能调整。');

  const detail = await called(repositories, 'campus.getPlace', { placeId: 'p_library' });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.recommendationReason, '室内座位多，适合阅读和短休。');
  assert.equal(detail.data.entryRestrictions, '无需预约；考试周开放时间可能调整。');
  assert.equal(detail.data.source, '校园官网 2026-10-01');
});

test('operator can update recommendation text and reads it back', async () => {
  const repositories = createMemoryRepositories({ places: [recommendedPlace()] });
  const admin = await called(repositories, 'admin.getPlace', { placeId: 'p_library' }, 'openid-op');
  assert.equal(admin.data.recommendationReason, '室内座位多，适合阅读和短休。');

  const update = await called(
    repositories,
    'admin.updatePlace',
    {
      placeId: 'p_library',
      changes: {
        recommendationReason: '临湖安静，适合独自阅读。',
        entryRestrictions: '凭校园卡进入；周一闭馆。',
      },
    },
    'openid-op',
  );
  assert.equal(update.ok, true);
  assert.equal(update.data.saved, true);
  assert.equal(update.data.verified, true);
  assert.equal(update.data.place.recommendationReason, '临湖安静，适合独自阅读。');
  assert.equal(update.data.place.entryRestrictions, '凭校园卡进入；周一闭馆。');

  const publicDetail = await called(repositories, 'campus.getPlace', { placeId: 'p_library' });
  assert.equal(publicDetail.data.recommendationReason, '临湖安静，适合独自阅读。');

  // null is an explicit "no reliable restriction known", not a missing write.
  const cleared = await called(
    repositories,
    'admin.updatePlace',
    { placeId: 'p_library', changes: { entryRestrictions: null } },
    'openid-op',
  );
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.place.entryRestrictions, null);
});

test('recommendation text is validated like other maintenance text', async () => {
  const repositories = createMemoryRepositories({ places: [recommendedPlace()] });

  for (const changes of [
    { recommendationReason: 'x'.repeat(201) },
    { entryRestrictions: '' },
    { recommendationReason: 42 },
  ]) {
    const result = await called(
      repositories,
      'admin.updatePlace',
      { placeId: 'p_library', changes },
      'openid-op',
    );
    assert.equal(result.error.code, 'INVALID_INPUT', JSON.stringify(changes));
  }

  const student = await called(
    repositories,
    'admin.updatePlace',
    { placeId: 'p_library', changes: { recommendationReason: '学生改写' } },
    'openid-student',
  );
  assert.equal(student.error.code, 'FORBIDDEN');
  assert.equal(repositories._state.places[0].recommendationReason, '室内座位多，适合阅读和短休。');
});

test('synthetic or expired recommendation text never reaches the public list', async () => {
  const repository = createMemoryRepositories({
    places: [
      recommendedPlace({
        placeId: 'p_synthetic',
        isSynthetic: true,
        recommendationReason: '合成理由',
      }),
      recommendedPlace({
        placeId: 'p_old',
        validUntil: '2026-09-01T00:00:00.000Z',
        recommendationReason: '过期理由',
      }),
    ],
  });

  const list = await called(repository, 'campus.listPlaces', {});
  assert.deepEqual(list.data.items, []);
  const detail = await called(repository, 'campus.getPlace', { placeId: 'p_synthetic' });
  assert.equal(detail.error.code, 'NOT_FOUND');
});
