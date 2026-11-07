// ============================================================================
// MoodSky — personal campus data for export and cleanup (W3 JH05, W4 JH05)
// ============================================================================
// Junhan Huang. The campus side of the account export/cleanup contract:
//
//   * a student's favorites, corrections and manual check-ins are read by the
//     server-side `accountId` only, and projected to the fields the export
//     format needs;
//   * check-ins are self-reported completions, never device location;
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

// v2 adds manual check-ins; favorites/corrections keep their v1 field shape.
const EXPORT_VERSION = 2;

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

function projectCheckin(row) {
  return {
    placeId: typeof row.placeId === 'string' ? row.placeId : null,
    // Business date in Asia/Shanghai, as stored by the check-in service.
    date: typeof row.date === 'string' ? row.date : null,
    completedAt: toIso(row.completedAt),
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
  const checkinsStore = repositories && repositories.checkins;
  if (!favoritesStore || typeof favoritesStore.listByOwner !== 'function') {
    throw new Error('Campus personal data store is not wired: favorites');
  }
  if (!correctionsStore || typeof correctionsStore.listByOwner !== 'function') {
    throw new Error('Campus personal data store is not wired: corrections');
  }
  if (!checkinsStore || typeof checkinsStore.listByOwner !== 'function') {
    throw new Error('Campus personal data store is not wired: checkins');
  }

  const [favoritesResult, correctionsResult, checkinsResult] = await Promise.all([
    favoritesStore.listByOwner(ownerId),
    correctionsStore.listByOwner(ownerId),
    checkinsStore.listByOwner(ownerId),
  ]);
  for (const result of [favoritesResult, correctionsResult, checkinsResult]) {
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
  const checkins = (checkinsResult.rows || [])
    .filter((row) => row.ownerId === ownerId)
    .map(projectCheckin)
    .sort(
      (left, right) => (Date.parse(left.completedAt) || 0) - (Date.parse(right.completedAt) || 0),
    );

  return {
    version: EXPORT_VERSION,
    favorites,
    corrections,
    checkins,
    counts: {
      favorites: favorites.length,
      corrections: corrections.length,
      checkins: checkins.length,
    },
    truncated: Boolean(
      favoritesResult.truncated || correctionsResult.truncated || checkinsResult.truncated,
    ),
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
  const checkinsStore = repositories && repositories.checkins;
  if (!favoritesStore || typeof favoritesStore.removeByOwner !== 'function') {
    throw new Error('Campus cleanup store is not wired: favorites');
  }
  if (!correctionsStore || typeof correctionsStore.removeByOwner !== 'function') {
    throw new Error('Campus cleanup store is not wired: corrections');
  }
  if (!checkinsStore || typeof checkinsStore.removeByOwner !== 'function') {
    throw new Error('Campus cleanup store is not wired: checkins');
  }

  const favoritesResult = await favoritesStore.removeByOwner(ownerId);
  const correctionsResult = await correctionsStore.removeByOwner(ownerId);
  const checkinsResult = await checkinsStore.removeByOwner(ownerId);
  const favoritesRemoved = favoritesResult && favoritesResult.removed;
  const correctionsRemoved = correctionsResult && correctionsResult.removed;
  const checkinsRemoved = checkinsResult && checkinsResult.removed;
  if (
    !Number.isSafeInteger(favoritesRemoved) ||
    favoritesRemoved < 0 ||
    !Number.isSafeInteger(correctionsRemoved) ||
    correctionsRemoved < 0 ||
    !Number.isSafeInteger(checkinsRemoved) ||
    checkinsRemoved < 0
  ) {
    throw new Error('Invalid campus cleanup acknowledgement');
  }
  return {
    favoritesRemoved,
    correctionsRemoved,
    checkinsRemoved,
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
  projectCheckin,
};
