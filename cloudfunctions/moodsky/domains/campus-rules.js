// ============================================================================
// MoodSky — campus place policy, projection and payload rules
// W2 JH01 / JH03 / JH04, Junhan Huang
// ============================================================================
// Pure module: no cloud SDK, no database and no clock. Everything that decides
// what a caller may see lives here, so that
//   * the campus and admin domains cannot drift apart, and
//   * the rules can be tested without a live environment.
//
// The line the whole module draws (docs/week1/Junhan_Huang/README.md, W1 JH04):
//   a place reaches the public list only when it is enabled, NOT synthetic,
//   has a traceable source and a real verification date, and has not expired.
// Synthetic or placeholder data therefore cannot reach a public response even
// if a row was imported into the collection by mistake.
// ============================================================================

const { AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');
const { LIMITS } = require('../shared/constants');

// openState is deliberately coarse: it answers "can a student go there now?",
// not the full opening-hours table, which stays free text in openHours.
const OPEN_STATES = Object.freeze(['OPEN', 'CLOSED', 'LIMITED', 'UNKNOWN']);
const ACCESSIBLE_KEYS = Object.freeze([
  'available',
  'elevator',
  'ramp',
  'accessibleToilet',
  'notes',
]);
const CORRECTION_STATUS = Object.freeze(['pending', 'approved', 'rejected']);
const FAVORITE_OPERATIONS = Object.freeze(['list', 'add', 'remove']);

// A place stays publishable until validUntil passes. This window only marks it
// 'expiring' so an operator can re-verify before it silently disappears from
// the list; it does not change publishability.
const VERIFICATION_WARNING_DAYS = 14;
const DAY_MS = 86400000;

const PAGE_SIZE_DEFAULT = 10;
const PAGE_SIZE_MAX = 20;
const PAGE_MAX = 1000;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CAMPUS_MAX = 40;
const SHORT_TEXT_MAX = 200;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalid(message) {
  throw new AppError(ERROR_CODES.INVALID_INPUT, message);
}

function notFound(message) {
  throw new AppError(ERROR_CODES.NOT_FOUND, message);
}

function isNonEmptyString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function codePointLength(value) {
  return Array.from(value).length;
}

// CloudBase returns Date objects in some paths and ISO strings in others; the
// policy must read both without guessing.
function toTime(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string' && value.length > 0) {
    return Date.parse(value);
  }
  return NaN;
}

function toIso(value) {
  const time = toTime(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function shortText(value) {
  return isNonEmptyString(value, SHORT_TEXT_MAX) ? value : null;
}

function tagList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((tag) => typeof tag === 'string' && tag.length > 0);
}

function accessibleInfo(value) {
  if (!isObject(value)) {
    return null;
  }
  const result = {};
  for (const key of ACCESSIBLE_KEYS) {
    if (!hasOwn(value, key)) {
      continue;
    }
    if (key === 'notes') {
      if (isNonEmptyString(value.notes, SHORT_TEXT_MAX)) {
        result.notes = value.notes;
      }
      continue;
    }
    if (typeof value[key] === 'boolean') {
      result[key] = value[key];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function locationInfo(value) {
  if (!isObject(value)) {
    return null;
  }
  const { latitude, longitude } = value;
  const validLatitude = typeof latitude === 'number' && latitude >= -90 && latitude <= 90;
  const validLongitude = typeof longitude === 'number' && longitude >= -180 && longitude <= 180;
  return validLatitude && validLongitude ? { latitude, longitude } : null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Why a row may or may not be published. The order matters: a disabled record
 * is reported as disabled even if it is also synthetic.
 *
 * 'disabled'   enabled !== true
 * 'synthetic'  isSynthetic !== false, i.e. the row is NOT explicitly marked real
 * 'unverified' no source, no verification date, or an unreadable date
 * 'expired'    validUntil is in the past
 * 'expiring'   validUntil is within VERIFICATION_WARNING_DAYS
 * 'verified'   publishable with room to spare
 */
function classification(place, nowMs) {
  if (!isObject(place) || place.enabled !== true) {
    return 'disabled';
  }
  if (place.isSynthetic !== false) {
    return 'synthetic';
  }
  if (
    !isNonEmptyString(place.source, SHORT_TEXT_MAX) ||
    !place.source.trim() ||
    !Number.isFinite(toTime(place.verifiedAt)) ||
    toTime(place.verifiedAt) > nowMs
  ) {
    return 'unverified';
  }
  const validUntil = toTime(place.validUntil);
  if (!Number.isFinite(validUntil)) {
    // No expiry means no way to keep the record honest over time.
    return 'unverified';
  }
  if (validUntil <= nowMs) {
    return 'expired';
  }
  if (validUntil - nowMs <= VERIFICATION_WARNING_DAYS * DAY_MS) {
    return 'expiring';
  }
  return 'verified';
}

function isPublishable(place, nowMs) {
  const state = classification(place, nowMs);
  return state === 'verified' || state === 'expiring';
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function publicSummary(place, state) {
  return {
    placeId: place.placeId,
    name: shortText(place.name),
    campus: shortText(place.campus),
    tags: tagList(place.tags),
    openState: OPEN_STATES.includes(place.openState) ? place.openState : 'UNKNOWN',
    openHours: shortText(place.openHours),
    address: shortText(place.address),
    accessible: accessibleInfo(place.accessible),
    verificationState: state,
    source: shortText(place.source),
    verifiedAt: toIso(place.verifiedAt),
    validUntil: toIso(place.validUntil),
  };
}

// Contact details and coordinates are only shown on a verified detail page: a
// stale record must not send a student to a phone number that nobody rechecked.
function publicDetail(place, state, nowMs) {
  const verified = state === 'verified' || state === 'expiring';
  return {
    ...publicSummary(place, state),
    contact: verified ? shortText(place.contact) : null,
    location: verified ? locationInfo(place.location) : null,
    source: shortText(place.source),
    verifiedAt: toIso(place.verifiedAt),
    validUntil: toIso(place.validUntil),
    updatedAt: toIso(place.updatedAt),
    stale: state !== 'verified' && state !== 'expiring',
    validForDays: (() => {
      const validUntil = toTime(place.validUntil);
      return Number.isFinite(validUntil) ? Math.floor((validUntil - nowMs) / DAY_MS) : null;
    })(),
  };
}

// Operator view. It carries the maintenance fields and never anything private:
// places have no owner and this projection must stay that way.
function adminRecord(place, state) {
  return {
    id: typeof place._id === 'string' ? place._id : null,
    placeId: place.placeId,
    name: shortText(place.name),
    campus: shortText(place.campus),
    tags: tagList(place.tags),
    openState: OPEN_STATES.includes(place.openState) ? place.openState : 'UNKNOWN',
    openHours: shortText(place.openHours),
    address: shortText(place.address),
    contact: shortText(place.contact),
    accessible: accessibleInfo(place.accessible),
    location: locationInfo(place.location),
    source: shortText(place.source),
    verifiedBy: shortText(place.verifiedBy),
    verifiedAt: toIso(place.verifiedAt),
    validUntil: toIso(place.validUntil),
    enabled: place.enabled === true,
    isSynthetic: place.isSynthetic === true,
    updatedBy: shortText(place.updatedBy),
    updatedAt: toIso(place.updatedAt),
    verificationState: state,
  };
}

// ---------------------------------------------------------------------------
// Ordering and pagination
// ---------------------------------------------------------------------------

function compareText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

// Stable order independent of the database: campus, then name, then placeId.
// Without the last key two rows with the same name could swap between pages.
function comparePlaces(left, right) {
  return (
    compareText(String(left.campus || ''), String(right.campus || '')) ||
    compareText(String(left.name || ''), String(right.name || '')) ||
    compareText(String(left.placeId || ''), String(right.placeId || ''))
  );
}

function paginate(items, page, pageSize) {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return {
    items: start >= total ? [] : items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
  };
}

// ---------------------------------------------------------------------------
// Payload validation — campus (public / private)
// ---------------------------------------------------------------------------

function assertPayload(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
}

function rejectUnknownKeys(payload, allowed) {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
}

function readPagination(payload) {
  const page = payload.page === undefined ? 1 : payload.page;
  const pageSize = payload.pageSize === undefined ? PAGE_SIZE_DEFAULT : payload.pageSize;
  if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) {
    invalid('page必须为1至' + PAGE_MAX + '的整数。');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
    invalid('pageSize必须为1至' + PAGE_SIZE_MAX + '的整数。');
  }
  return { page, pageSize };
}

function readOptionalString(payload, key, max) {
  if (payload[key] === undefined || payload[key] === null) {
    return null;
  }
  if (!isNonEmptyString(payload[key], max)) {
    invalid(key + '必须为1至' + max + '个字符。');
  }
  return payload[key];
}

function readPlaceId(payload) {
  if (typeof payload.placeId !== 'string' || !PLACE_ID_PATTERN.test(payload.placeId)) {
    invalid('placeId格式无效。');
  }
  return payload.placeId;
}

function readTagsFilter(payload) {
  if (payload.tags === undefined) {
    return [];
  }
  const tags = payload.tags;
  if (
    !Array.isArray(tags) ||
    tags.length > 5 ||
    !tags.every(
      (tag) =>
        typeof tag === 'string' &&
        tag.trim().length > 0 &&
        codePointLength(tag) <= 40 &&
        !/[\u0000-\u001f\u007f]/.test(tag),
    )
  ) {
    invalid('tags必须为1至5个筛选标签。');
  }
  return [...tags];
}

function readOpenStateFilter(payload) {
  if (payload.openState === undefined) {
    return null;
  }
  if (!OPEN_STATES.includes(payload.openState)) {
    invalid('openState不在约定取值内。');
  }
  return payload.openState;
}

function validateListPlaces(payload) {
  assertPayload(payload);
  rejectUnknownKeys(payload, ['campus', 'tags', 'openState', 'page', 'pageSize']);
  return {
    campus: readOptionalString(payload, 'campus', CAMPUS_MAX),
    tags: readTagsFilter(payload),
    openState: readOpenStateFilter(payload),
    ...readPagination(payload),
  };
}

function validateGetPlace(payload) {
  assertPayload(payload);
  rejectUnknownKeys(payload, ['placeId']);
  return { placeId: readPlaceId(payload) };
}

// supportResources takes no parameter today (miniprogram/modules/campus/service.js).
// Accepting an unknown key here would silently pretend to filter, so any key is
// rejected until the frontend and this contract change together.
function validateSupportResources(payload) {
  assertPayload(payload);
  rejectUnknownKeys(payload, []);
  return {};
}

function validateFavorites(payload) {
  assertPayload(payload);
  rejectUnknownKeys(payload, ['operation', 'placeId', 'page', 'pageSize']);
  if (!FAVORITE_OPERATIONS.includes(payload.operation)) {
    invalid('operation必须为list、add或remove。');
  }
  if (payload.operation === 'list') {
    if (payload.placeId !== undefined) {
      invalid('列表操作不接受placeId。');
    }
    return { operation: 'list', placeId: null, ...readPagination(payload) };
  }
  if (payload.page !== undefined || payload.pageSize !== undefined) {
    invalid('单条收藏操作不接受分页参数。');
  }
  return { operation: payload.operation, placeId: readPlaceId(payload) };
}

function validateCorrectPlace(payload) {
  assertPayload(payload);
  rejectUnknownKeys(payload, ['placeId', 'text']);
  const placeId = readPlaceId(payload);
  if (typeof payload.text !== 'string') {
    invalid('纠错内容必须为文本。');
  }
  const length = codePointLength(payload.text);
  if (length < 1 || length > LIMITS.correctionTextCodePoints) {
    invalid('纠错内容需为1至' + LIMITS.correctionTextCodePoints + '个Unicode码点。');
  }
  return { placeId, text: payload.text };
}

// ---------------------------------------------------------------------------
// Selection — the only places a caller can reach
// ---------------------------------------------------------------------------

function matchesCampusFilter(place, campus) {
  return campus === null || place.campus === campus;
}

// tags are an OR filter: choosing two chips shows places that carry either one.
// An AND filter would return an empty list for most campus combinations.
function matchesTagsFilter(place, tags) {
  if (tags.length === 0) {
    return true;
  }
  const owned = tagList(place.tags);
  return tags.some((tag) => owned.includes(tag));
}

function matchesOpenStateFilter(place, openState) {
  return openState === null || place.openState === openState;
}

function selectPublicList(rows, query, nowMs) {
  const visible = rows
    .filter((place) => isPublishable(place, nowMs))
    .filter((place) => matchesCampusFilter(place, query.campus))
    .filter((place) => matchesTagsFilter(place, query.tags))
    .filter((place) => matchesOpenStateFilter(place, query.openState))
    .sort(comparePlaces);
  const page = paginate(visible, query.page, query.pageSize);
  return {
    ...page,
    items: page.items.map((place) => publicSummary(place, classification(place, nowMs))),
  };
}

function findPlace(rows, placeId) {
  return rows.find((place) => place.placeId === placeId) || null;
}

/**
 * Detail lookup. A row that is disabled, synthetic or never verified does not
 * exist as far as the public API is concerned, so the caller gets NOT_FOUND
 * rather than a half-empty record.
 */
function assertPlaceVisible(place, nowMs) {
  if (!place) {
    notFound('未找到该地点。');
  }
  const state = classification(place, nowMs);
  if (state === 'disabled' || state === 'synthetic' || state === 'unverified') {
    notFound('未找到该地点。');
  }
  return state;
}

function selectPublicDetail(rows, placeId, nowMs) {
  const place = findPlace(rows, placeId);
  const state = assertPlaceVisible(place, nowMs);
  return publicDetail(place, state, nowMs);
}

function selectSupportResources(rows, nowMs) {
  const items = rows
    .filter((resource) => isPublishable(resource, nowMs))
    .sort(comparePlaces)
    .map((resource) => ({
      resourceId: resource.resourceId || resource._id || null,
      name: shortText(resource.name),
      campus: shortText(resource.campus),
      category: shortText(resource.category),
      description: shortText(resource.description),
      contact: shortText(resource.contact),
      openHours: shortText(resource.openHours),
      source: shortText(resource.source),
      verificationState: classification(resource, nowMs),
      verifiedAt: toIso(resource.verifiedAt),
      validUntil: toIso(resource.validUntil),
    }));
  // "No verified support resource" is an empty state, not an error: inventing a
  // placeholder hotline is exactly what support_resources.notes forbids.
  return {
    items,
    total: items.length,
    emptyState:
      items.length === 0
        ? {
            code: 'NO_VERIFIED_RESOURCE',
            message: '暂无可核验的支持资源，请以学校官方渠道为准。',
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

function favoriteView(favorite, place, nowMs) {
  const state = place ? classification(place, nowMs) : 'unavailable';
  return {
    placeId: favorite.placeId,
    createdAt: toIso(favorite.createdAt),
    available: Boolean(place) && isPublishable(place, nowMs),
    place: place && isPublishable(place, nowMs) ? publicSummary(place, state) : null,
  };
}

/**
 * A favorite whose place was removed, disabled or expired is kept in the
 * response as unavailable instead of being silently dropped: the student chose
 * it, and the client needs to know that it can no longer be opened.
 */
function selectFavorites(favorites, rows, query, nowMs) {
  const views = favorites
    .map((favorite) => favoriteView(favorite, findPlace(rows, favorite.placeId), nowMs))
    .sort((left, right) => compareText(left.placeId, right.placeId));
  const available = views.filter((view) => view.available);
  const page = paginate(views, query.page, query.pageSize);
  return {
    ...page,
    items: page.items,
    availableCount: available.length,
    unavailableCount: views.length - available.length,
  };
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/**
 * A correction is private to its submitter until an operator reviews it, so the
 * write response never echoes the text back as published content.
 */
function correctionReceipt(correction) {
  return {
    correctionId: correction._id || correction.correctionId || null,
    placeId: correction.placeId,
    status: correction.status,
    createdAt: toIso(correction.createdAt),
    published: false,
  };
}

module.exports = {
  OPEN_STATES,
  CORRECTION_STATUS,
  FAVORITE_OPERATIONS,
  ACCESSIBLE_KEYS,
  VERIFICATION_WARNING_DAYS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  toTime,
  toIso,
  isObject,
  hasOwn,
  invalid,
  notFound,
  isNonEmptyString,
  codePointLength,
  classification,
  isPublishable,
  publicSummary,
  publicDetail,
  adminRecord,
  comparePlaces,
  paginate,
  validateListPlaces,
  validateGetPlace,
  validateSupportResources,
  validateFavorites,
  validateCorrectPlace,
  selectPublicList,
  selectPublicDetail,
  assertPlaceVisible,
  selectSupportResources,
  selectFavorites,
  correctionReceipt,
  findPlace,
};
