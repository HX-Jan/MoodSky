const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../cloudfunctions/moodsky/domains/admin');
const { createRepositories } = require('../cloudfunctions/moodsky/repositories');
const {
  collectPersonalCampusData,
  clearPersonalCampusData,
} = require('../cloudfunctions/moodsky/domains/campus-personal');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const original = {
  _id: 'synthetic_correction',
  ownerId: 'synthetic_owner',
  status: 'pending',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const review = (repositories, decision = 'approved') =>
  admin.handle({
    action: 'admin.reviewCorrection',
    payload: { correctionId: original._id, decision },
    actor: { accountId: 'synthetic_operator' },
    repositories,
    now: Date.parse('2026-10-29T04:00:00.000Z'),
  });

test('review never invents a successful reread or accepts unapplied review fields', async () => {
  for (const mismatch of [null, { ...original, status: 'approved' }]) {
    let reads = 0;
    const repositories = {
      corrections: {
        findByCorrectionId: async () => (++reads === 1 ? original : mismatch),
        reviewById: async (_id, build) => ({ updated: 1, changes: build(original).changes }),
      },
    };
    await assert.rejects(review(repositories), { code: 'CONFLICT' });
  }
});

test('a zero-write acknowledgement is not idempotent success without an explicit terminal replay', async () => {
  let reads = 0;
  await assert.rejects(
    review({
      corrections: {
        findByCorrectionId: async () =>
          ++reads === 1 ? original : { ...original, status: 'approved' },
        reviewById: async () => ({ updated: 0 }),
      },
    }),
    { code: 'CONFLICT' },
  );
});

test('campus cleanup rechecks ownership inside the transaction before deleting a scanned row', async () => {
  let removals = 0;
  const repositories = createRepositories({
    database: () => ({
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ data: [{ _id: 'synthetic_row', ownerId: 'synthetic_owner' }] }),
          }),
        }),
      }),
      runTransaction: (work) =>
        work({
          collection: () => ({
            doc: () => ({
              get: async () => ({ data: { _id: 'synthetic_row', ownerId: 'synthetic_other' } }),
              remove: async () => {
                removals++;
                return { stats: { removed: 1 } };
              },
            }),
          }),
        }),
    }),
  });
  await assert.rejects(repositories.favorites.removeByOwner('synthetic_owner'), {
    code: 'CONFLICT',
  });
  assert.equal(removals, 0);
});

test('personal export rejects malformed responses and cleanup rejects invalid counts', async () => {
  const valid = { rows: [], truncated: false };
  await assert.rejects(
    collectPersonalCampusData({
      accountId: 'synthetic_owner',
      repositories: {
        favorites: { listByOwner: async () => ({}) },
        corrections: { listByOwner: async () => valid },
      },
    }),
    /Invalid campus/,
  );
  for (const removed of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      clearPersonalCampusData({
        accountId: 'synthetic_owner',
        repositories: {
          favorites: { removeByOwner: async () => ({ removed }) },
          corrections: { removeByOwner: async () => ({ removed: 0 }) },
        },
      }),
      /acknowledgement/,
    );
  }
});

test('actual review repository crosses the installed SDK transaction serializer and rejects competing decisions', async () => {
  await withOfflineWxDatabase(
    { ['place_corrections:' + original._id]: original },
    async ({ db, inspect }) => {
      const repositories = createRepositories({
        database: () => ({
          runTransaction: (work) => db.runTransaction(work),
          collection: () => ({
            doc: (id) => ({ get: async () => ({ data: inspect()['place_corrections:' + id] }) }),
          }),
        }),
      });
      const results = await Promise.allSettled([
        review(repositories),
        review(repositories, 'rejected'),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CONFLICT');
    },
    { conflictScope: 'written-documents' },
  );
});
