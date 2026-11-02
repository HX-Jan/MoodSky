const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectPersonalCampusData,
  clearPersonalCampusData,
} = require('../cloudfunctions/moodsky/domains/campus-personal');
const { createMemoryRepositories } = require('./support/campus-repository');
const fixtures = require('./support/campus-fixtures');

function seed() {
  return createMemoryRepositories({
    places: fixtures.places,
    supportResources: fixtures.supportResources,
    taskTemplates: fixtures.taskTemplates,
    favorites: [
      { ownerId: 'acc_a', placeId: 'p_library', createdAt: '2026-10-10T00:00:00.000Z' },
      { ownerId: 'acc_a', placeId: 'p_gym', createdAt: '2026-10-11T00:00:00.000Z' },
      { ownerId: 'acc_b', placeId: 'p_library', createdAt: '2026-10-12T00:00:00.000Z' },
      { ownerId: 'acc_off', placeId: 'p_canteen', createdAt: '2026-10-01T00:00:00.000Z' },
    ],
    corrections: [
      {
        ownerId: 'acc_a',
        placeId: 'p_library',
        text: '开放时间改为 08:00-21:00。',
        status: 'approved',
        createdAt: '2026-10-09T00:00:00.000Z',
        reviewedAt: '2026-10-10T00:00:00.000Z',
        reviewedBy: 'acc_op',
      },
      {
        ownerId: 'acc_b',
        placeId: 'p_gym',
        text: '器械区周末也开放。',
        status: 'pending',
        createdAt: '2026-10-13T00:00:00.000Z',
      },
    ],
  });
}

test('export collects only the server-supplied owner and projects private fields', async () => {
  const repositories = seed();
  const exported = await collectPersonalCampusData({
    repositories,
    accountId: 'acc_a',
  });

  assert.equal(exported.version, 1);
  assert.deepEqual(exported.counts, { favorites: 2, corrections: 1 });
  assert.deepEqual(
    exported.favorites.map((row) => row.placeId),
    ['p_library', 'p_gym'],
  );
  assert.deepEqual(Object.keys(exported.favorites[0]).sort(), ['createdAt', 'placeId']);
  assert.deepEqual(Object.keys(exported.corrections[0]).sort(), [
    'correctionId',
    'createdAt',
    'placeId',
    'reviewedAt',
    'status',
    'text',
  ]);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes('acc_a'), false);
  assert.equal(serialized.includes('acc_b'), false);
  assert.equal(serialized.includes('acc_other'), false);
});

test('a second account cannot read the first account data', async () => {
  const repositories = seed();
  const exported = await collectPersonalCampusData({
    repositories,
    accountId: 'acc_b',
  });
  assert.deepEqual(exported.counts, { favorites: 1, corrections: 1 });
  assert.equal(exported.favorites[0].placeId, 'p_library');
  assert.equal(exported.corrections[0].placeId, 'p_gym');
});

test('cleanup is idempotent, owner-scoped and keeps shared campus material', async () => {
  const repositories = seed();
  const beforePlaces = repositories._state.places.length;
  const beforeResources = repositories._state.supportResources.length;
  const beforeTemplates = repositories._state.taskTemplates.length;

  const first = await clearPersonalCampusData({ repositories, accountId: 'acc_a' });
  assert.deepEqual(first, {
    favoritesRemoved: 2,
    correctionsRemoved: 1,
    sharedRetained: true,
  });

  const second = await clearPersonalCampusData({ repositories, accountId: 'acc_a' });
  assert.deepEqual(second, {
    favoritesRemoved: 0,
    correctionsRemoved: 0,
    sharedRetained: true,
  });

  // The other accounts' rows are untouched.
  assert.deepEqual(repositories._state.favorites.map((row) => row.ownerId).sort(), [
    'acc_b',
    'acc_off',
  ]);
  assert.equal(repositories._state.corrections.length, 1);
  assert.equal(repositories._state.corrections[0].ownerId, 'acc_b');

  // Shared material is never part of a student cleanup.
  assert.equal(repositories._state.places.length, beforePlaces);
  assert.equal(repositories._state.supportResources.length, beforeResources);
  assert.equal(repositories._state.taskTemplates.length, beforeTemplates);
});

test('cleanup runs for a disabled account resolved by the caller', async () => {
  // The account gate lives in account.close/cleanupStatus; this module only
  // needs the trusted accountId, so a disabled account can still be cleaned.
  const repositories = seed();
  const result = await clearPersonalCampusData({
    repositories,
    accountId: 'acc_off',
  });
  assert.equal(result.favoritesRemoved, 1);
  assert.equal(result.correctionsRemoved, 0);
});

test('an absent trusted account is rejected instead of exporting everyone', async () => {
  const repositories = seed();
  await assert.rejects(
    () => collectPersonalCampusData({ repositories, accountId: '' }),
    (error) => error.code === 'UNAUTHENTICATED',
  );
  await assert.rejects(
    () => clearPersonalCampusData({ repositories, accountId: null }),
    (error) => error.code === 'UNAUTHENTICATED',
  );
});
