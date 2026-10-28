const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('./support/campus-repository');
const fixtures = require('./support/campus-fixtures');

const { NOW } = fixtures;

const ACCOUNTS = {
  'openid-a': { id: 'acc_a', status: 'active' },
  'openid-b': { id: 'acc_b', status: 'active' },
  'openid-op': { id: 'acc_op', status: 'active' },
  'openid-disabled': { id: 'acc_off', status: 'disabled' },
};
const OPERATORS = ['acc_op'];

let sequence = 0;
function request(action, payload = {}) {
  sequence += 1;
  return {
    apiVersion: '1',
    requestId: 'req_campus_' + String(sequence).padStart(4, '0'),
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

async function publicCall(repositories, action, payload) {
  return buildRouter(repositories)(request(action, payload));
}

async function privateCall(repositories, openid, action, payload) {
  return buildRouter(repositories)(request(action, payload), { OPENID: openid });
}

test('the public list publishes only verified, enabled, non-synthetic places', async () => {
  const result = await publicCall(seed(), 'campus.listPlaces', {});
  assert.equal(result.ok, true);
  // Expired, synthetic, disabled, missing source and missing verification date
  // never reach a student, even though they exist in the collection.
  assert.deepEqual(
    result.data.items.map((item) => item.placeId),
    ['p_canteen', 'p_gym', 'p_library'],
  );
  assert.equal(result.data.total, 3);
  assert.equal(result.data.truncated, false);
  const expiring = result.data.items.find((item) => item.placeId === 'p_canteen');
  assert.equal(expiring.verificationState, 'expiring');
  const verified = result.data.items.find((item) => item.placeId === 'p_library');
  assert.equal(verified.verificationState, 'verified');
});

test('a public summary never carries internal maintenance fields', async () => {
  const result = await publicCall(seed(), 'campus.listPlaces', {});
  const item = result.data.items.find((entry) => entry.placeId === 'p_library');
  assert.deepEqual(Object.keys(item).sort(), [
    'accessible',
    'address',
    'campus',
    'name',
    'openHours',
    'openState',
    'placeId',
    'source',
    'tags',
    'validUntil',
    'verificationState',
    'verifiedAt',
  ]);
  const serialised = JSON.stringify(result);
  for (const forbidden of ['_id', 'verifiedBy', 'isSynthetic', 'ownerId', 'contact']) {
    assert.equal(serialised.includes('"' + forbidden + '"'), false, forbidden);
  }
});

test('campus, tag and open-state filters narrow the list without changing its order', async () => {
  const repositories = seed();
  const byCampus = await publicCall(repositories, 'campus.listPlaces', { campus: '东校区' });
  assert.deepEqual(
    byCampus.data.items.map((item) => item.placeId),
    ['p_canteen'],
  );
  const byAnyTag = await publicCall(repositories, 'campus.listPlaces', {
    tags: ['FOOD', 'SPORT'],
  });
  assert.deepEqual(
    byAnyTag.data.items.map((item) => item.placeId),
    ['p_canteen', 'p_gym'],
  );
  const byOpenState = await publicCall(repositories, 'campus.listPlaces', { openState: 'CLOSED' });
  // The only CLOSED place is the expired one, so the correct answer is empty.
  assert.deepEqual(byOpenState.data.items, []);
});

test('pagination is stable and an empty result is a success, not an error', async () => {
  const repositories = seed();
  const first = await publicCall(repositories, 'campus.listPlaces', { pageSize: 2 });
  assert.deepEqual(
    first.data.items.map((item) => item.placeId),
    ['p_canteen', 'p_gym'],
  );
  assert.equal(first.data.hasMore, true);
  const second = await publicCall(repositories, 'campus.listPlaces', { page: 2, pageSize: 2 });
  assert.deepEqual(
    second.data.items.map((item) => item.placeId),
    ['p_library'],
  );
  assert.equal(second.data.hasMore, false);
  const beyond = await publicCall(repositories, 'campus.listPlaces', { page: 9, pageSize: 2 });
  assert.deepEqual(beyond.data.items, []);
  assert.equal(beyond.data.total, 3);
  assert.equal(beyond.ok, true);
});

test('place detail is readable for a verified place and refuses an unverifiable one', async () => {
  const repositories = seed();
  const detail = await publicCall(repositories, 'campus.getPlace', { placeId: 'p_library' });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.contact, '021-0000-0001');
  assert.deepEqual(detail.data.location, { latitude: 31.2, longitude: 121.4 });
  assert.equal(detail.data.stale, false);
  assert.equal(detail.data.source, '校园官网 2026-10-01');

  for (const placeId of ['p_missing', 'p_synthetic', 'p_disabled', 'p_nosource', 'p_nodate']) {
    const refused = await publicCall(repositories, 'campus.getPlace', { placeId });
    assert.equal(refused.ok, false, placeId);
    assert.equal(refused.error.code, 'NOT_FOUND', placeId);
  }
});

test('an expired place degrades instead of disappearing or leaking stale contact details', async () => {
  const detail = await publicCall(seed(), 'campus.getPlace', { placeId: 'p_old' });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.verificationState, 'expired');
  assert.equal(detail.data.stale, true);
  assert.equal(detail.data.contact, null);
  assert.equal(detail.data.location, null);
  assert.ok(detail.data.validForDays < 0);
});

test('support resources return an explicit empty state instead of placeholder content', async () => {
  const withResource = await publicCall(seed(), 'campus.supportResources', {});
  assert.equal(withResource.ok, true);
  assert.deepEqual(
    withResource.data.items.map((item) => item.resourceId),
    ['r_hotline'],
  );
  assert.equal(withResource.data.emptyState, null);

  const empty = await publicCall(
    createMemoryRepositories({ places: [], supportResources: [fixtures.supportResources[1]] }),
    'campus.supportResources',
    {},
  );
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.data.items, []);
  assert.equal(empty.data.emptyState.code, 'NO_VERIFIED_RESOURCE');
});

test('favorites are idempotent, owner-scoped and never trust a client ownerId', async () => {
  const repositories = seed();
  const first = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'add',
    placeId: 'p_library',
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.duplicated, false);
  const second = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'add',
    placeId: 'p_library',
  });
  assert.equal(second.data.duplicated, true);

  const mine = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'list',
  });
  assert.equal(mine.data.total, 1);
  assert.equal(mine.data.items[0].available, true);
  assert.equal(mine.data.items[0].place.name, '图书馆');

  const other = await privateCall(repositories, 'openid-b', 'campus.favorites', {
    operation: 'list',
  });
  assert.equal(other.data.total, 0);

  const spoofed = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'list',
    ownerId: 'acc_b',
  });
  // The router rejects identity fields before the handler runs.
  assert.equal(spoofed.error.code, 'INVALID_REQUEST');

  const removed = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'remove',
    placeId: 'p_library',
  });
  assert.equal(removed.data.removed, true);
  const removedAgain = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'remove',
    placeId: 'p_library',
  });
  assert.equal(removedAgain.data.removed, false);
});

test('a favorite whose place became unreachable is reported as unavailable, and can still be removed', async () => {
  const repositories = seed();
  await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'add',
    placeId: 'p_library',
  });
  const stored = repositories._state.places.find((row) => row.placeId === 'p_library');
  stored.enabled = false;

  const list = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'list',
  });
  assert.equal(list.data.total, 1);
  assert.equal(list.data.availableCount, 0);
  assert.equal(list.data.unavailableCount, 1);
  assert.equal(list.data.items[0].available, false);
  assert.equal(list.data.items[0].place, null);

  const removed = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    operation: 'remove',
    placeId: 'p_library',
  });
  assert.equal(removed.data.removed, true);
});

test('favoriting an unverified or synthetic place is refused', async () => {
  for (const placeId of ['p_synthetic', 'p_missing', 'p_nosource']) {
    const result = await privateCall(seed(), 'openid-a', 'campus.favorites', {
      operation: 'add',
      placeId,
    });
    assert.equal(result.error.code, 'NOT_FOUND', placeId);
  }
});

test('correction text is counted in Unicode code points and stays private', async () => {
  const repositories = seed();
  const accepted = await privateCall(repositories, 'openid-a', 'campus.correctPlace', {
    placeId: 'p_library',
    text: '😀'.repeat(200),
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.correction.status, 'pending');
  assert.equal(accepted.data.published, false);
  assert.equal(accepted.data.correction.published, false);
  const stored = repositories._state.corrections.at(-1);
  assert.equal(stored.ownerId, 'acc_a');
  assert.equal(stored.status, 'pending');

  const tooLong = await privateCall(repositories, 'openid-a', 'campus.correctPlace', {
    placeId: 'p_library',
    text: '😀'.repeat(201),
  });
  assert.equal(tooLong.error.code, 'INVALID_INPUT');

  const empty = await privateCall(repositories, 'openid-a', 'campus.correctPlace', {
    placeId: 'p_library',
    text: '',
  });
  assert.equal(empty.error.code, 'INVALID_INPUT');

  const unknownPlace = await privateCall(repositories, 'openid-a', 'campus.correctPlace', {
    placeId: 'p_missing',
    text: '这条不对。',
  });
  assert.equal(unknownPlace.error.code, 'NOT_FOUND');
});

test('campus payloads reject unknown fields instead of silently ignoring them', async () => {
  const repositories = seed();
  const unknownFilter = await publicCall(repositories, 'campus.listPlaces', { keyword: '图书馆' });
  assert.equal(unknownFilter.error.code, 'INVALID_INPUT');

  const badPageSize = await publicCall(repositories, 'campus.listPlaces', { pageSize: 21 });
  assert.equal(badPageSize.error.code, 'INVALID_INPUT');

  const filteredResources = await publicCall(repositories, 'campus.supportResources', {
    campus: '主校区',
  });
  assert.equal(filteredResources.error.code, 'INVALID_INPUT');

  const missingOperation = await privateCall(repositories, 'openid-a', 'campus.favorites', {
    placeId: 'p_library',
  });
  assert.equal(missingOperation.error.code, 'INVALID_INPUT');
});

test('the campus actions answer honestly while the data seam is not wired', async () => {
  const unwired = createRouter({ now: () => NOW });
  const cases = [
    ['campus.listPlaces', {}],
    ['campus.getPlace', { placeId: 'p_library' }],
    ['campus.supportResources', {}],
  ];
  for (const [action, payload] of cases) {
    const result = await unwired(request(action, payload));
    assert.equal(result.error.code, 'NOT_IMPLEMENTED', action);
  }
  const privateResult = await createRouter({
    now: () => NOW,
    resolveAccount: async () => ({ id: 'acc_a', status: 'active' }),
  })(request('campus.favorites', { operation: 'list' }), { OPENID: 'openid-a' });
  assert.equal(privateResult.error.code, 'NOT_IMPLEMENTED');
});

test('private campus actions still require a trusted active account', async () => {
  const noIdentity = await buildRouter(seed())(request('campus.favorites', { operation: 'list' }));
  assert.equal(noIdentity.error.code, 'UNAUTHENTICATED');
  const disabled = await privateCall(seed(), 'openid-disabled', 'campus.favorites', {
    operation: 'list',
  });
  assert.equal(disabled.error.code, 'ACCOUNT_DISABLED');
});
