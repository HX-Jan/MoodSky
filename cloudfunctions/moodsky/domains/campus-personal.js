// ============================================================================
// MoodSky — personal campus data for export and cleanup (W3 JH05)
// ============================================================================
// Junhan Huang. The campus side of the account export/cleanup contract:
//
//   * a student's favorites and corrections are read by the server-side
//     `accountId` only, and projected to the fields the export format needs;
//   * cleanup is idempotent — a second run removes 0 rows and does not fail;
//   * shared material (`places`, `support_resources`, `task_templates`) is never
//     deleted by a student cleanup.
//
// This module is a building block for Xiang Yu's export/cleanup executor. It
// does not mint files, credentials, receipts or restore markers, and it does not
// decide whether an account may be cleaned up — the caller resolves the trusted
// account and its status first.
// ============================================================================

const { AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');

const EXPORT_VERSION = 1;

function requireAccountId(accountId) {
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, '缺少可信账号，未读取或清理校园私人数据。');
  }
  return accountId;
}

function toIso(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(Date.parse(value)).toISOString();
  }
  return null;
}

function projectFavorite(row) {
  return {
    placeId: typeof row.placeId === 'string' ? row.placeId : null,
    createdAt: toIso(row.createdAt),
  };
}

function projectCorrection(row) {
  return {
    correctionId: row._id || row.correctionId || null,
    placeId: typeof row.placeId === 'string' ? row.placeId : null,
    text: typeof row.text === 'string' ? row.text : '',
    status: typeof row.status === 'string' ? row.status : null,
    createdAt: toIso(row.createdAt),
    reviewedAt: toIso(row.reviewedAt),
  };
}

function compareByCreatedAt(left, right) {
  const leftTime = Date.parse(left.createdAt) || 0;
  const rightTime = Date.parse(right.createdAt) || 0;
  return leftTime - rightTime;
}

/**
 * Collects the caller's own campus data. The owner is always the server-supplied
 * account, never a payload field; no other account's rows can be requested.
 *
 * @param {{ repositories: object, accountId: string }} input
 * @returns {Promise<{version:number,favorites:object[],corrections:object[],counts:object,truncated:boolean}>}
 */
async function collectPersonalCampusData({ repositories, accountId }) {
  const ownerId = requireAccountId(accountId);
  const favoritesStore = repositories && repositories.favorites;
  const correctionsStore = repositories && repositories.corrections;
  if (!favoritesStore || typeof favoritesStore.listByOwner !== 'function') {
    throw new Error('Campus personal data store is not wired: favorites');
  }
  if (!correctionsStore || typeof correctionsStore.listByOwner !== 'function') {
    throw new Error('Campus personal data store is not wired: corrections');
  }

  const [favoritesResult, correctionsResult] = await Promise.all([
    favoritesStore.listByOwner(ownerId),
    correctionsStore.listByOwner(ownerId),
  ]);
  for (const result of [favoritesResult, correctionsResult]) {
    if (!result || !Array.isArray(result.rows) || typeof result.truncated !== 'boolean') {
      throw new Error('Invalid campus personal data response');
    }
  }
  const favorites = (favoritesResult.rows || [])
    .filter((row) => row.ownerId === ownerId)
    .map(projectFavorite)
    .sort(compareByCreatedAt);
  const corrections = (correctionsResult.rows || [])
    .filter((row) => row.ownerId === ownerId)
    .map(projectCorrection)
    .sort(compareByCreatedAt);

  return {
    version: EXPORT_VERSION,
    favorites,
    corrections,
    counts: { favorites: favorites.length, corrections: corrections.length },
    truncated: Boolean(favoritesResult.truncated || correctionsResult.truncated),
  };
}

/**
 * Removes the caller's own favorites and corrections. Repeated execution is
 * expected: the second call returns zeroes. Shared places/resources/templates
 * are outside this module and are never removed.
 *
 * @param {{ repositories: object, accountId: string }} input
 * @returns {Promise<{favoritesRemoved:number,correctionsRemoved:number,sharedRetained:boolean}>}
 */
async function clearPersonalCampusData({ repositories, accountId }) {
  const ownerId = requireAccountId(accountId);
  const favoritesStore = repositories && repositories.favorites;
  const correctionsStore = repositories && repositories.corrections;
  if (!favoritesStore || typeof favoritesStore.removeByOwner !== 'function') {
    throw new Error('Campus cleanup store is not wired: favorites');
  }
  if (!correctionsStore || typeof correctionsStore.removeByOwner !== 'function') {
    throw new Error('Campus cleanup store is not wired: corrections');
  }

  const favoritesResult = await favoritesStore.removeByOwner(ownerId);
  const correctionsResult = await correctionsStore.removeByOwner(ownerId);
  const favoritesRemoved = favoritesResult && favoritesResult.removed;
  const correctionsRemoved = correctionsResult && correctionsResult.removed;
  if (
    !Number.isSafeInteger(favoritesRemoved) ||
    favoritesRemoved < 0 ||
    !Number.isSafeInteger(correctionsRemoved) ||
    correctionsRemoved < 0
  ) {
    throw new Error('Invalid campus cleanup acknowledgement');
  }
  return {
    favoritesRemoved,
    correctionsRemoved,
    // Explicit: a student cleanup never deletes shared campus material.
    sharedRetained: true,
  };
}

module.exports = {
  EXPORT_VERSION,
  collectPersonalCampusData,
  clearPersonalCampusData,
  projectFavorite,
  projectCorrection,
};
