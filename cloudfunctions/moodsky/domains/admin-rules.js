// ============================================================================
// MoodSky — operator (admin) payload rules for campus material
// W2 JH02 / JH03, Junhan Huang
// ============================================================================
// Pure module, same reason as campus-rules.js: the operator path must be
// testable without a cloud environment.
//
// Scope guard: operator actions maintain campus material only. Nothing in this
// file can reach journal, preferences, export or account collections — the
// domain handler only ever receives the four campus collections.
// ============================================================================

const { ERROR_CODES } = require('../shared/contracts');
const { AppError } = require('../shared/result');
const rules = require('./campus-rules');

const { invalid, isObject, hasOwn } = rules;

const VERIFICATION_STATES = Object.freeze([
  'verified',
  'expiring',
  'expired',
  'unverified',
  'synthetic',
  'disabled',
]);

// Field that may be written by an operator, with the rule that guards it.
// verifiedBy / verifiedAt / updatedBy / updatedAt are NOT here: they are only
// ever stamped by the server from the trusted actor.
const NAME_MAX = 60;
const CAMPUS_MAX = 40;
const SHORT_TEXT_MAX = 200;
const MAX_TAGS = 8;

function readOptionalFilterString(payload, key, max) {
  const value = payload[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (!rules.isNonEmptyString(value, max)) {
    invalid(key + '必须为1至' + max + '个字符。');
  }
  return value;
}

function readPage(payload) {
  const page = payload.page === undefined ? 1 : payload.page;
  const pageSize = payload.pageSize === undefined ? rules.PAGE_SIZE_DEFAULT : payload.pageSize;
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    invalid('page必须为1至1000的整数。');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > rules.PAGE_SIZE_MAX) {
    invalid('pageSize必须为1至' + rules.PAGE_SIZE_MAX + '的整数。');
  }
  return { page, pageSize };
}

function readRequiredText(value, label, max) {
  if (!rules.isNonEmptyString(value, max)) {
    invalid(label + '必须为1至' + max + '个字符。');
  }
  return value;
}

// A required maintenance field may never be cleared with null; only the
// optional ones may, and only because "we no longer know the opening hours" is
// a real answer that must be expressible.
function readOptionalText(value, label, max) {
  if (value === null) {
    return null;
  }
  if (!rules.isNonEmptyString(value, max)) {
    invalid(label + '必须为1至' + max + '个字符，或为null表示待核实。');
  }
  return value;
}

function readTags(value) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_TAGS ||
    !value.every(
      (tag) =>
        typeof tag === 'string' &&
        tag.trim().length > 0 &&
        rules.codePointLength(tag) <= 40 &&
        !/[\u0000-\u001f\u007f]/.test(tag),
    ) ||
    new Set(value).size !== value.length
  ) {
    invalid('tags必须为不超过' + MAX_TAGS + '个互不重复的标签。');
  }
  return [...value];
}

function readAccessible(value) {
  if (value === null) {
    return null;
  }
  if (!isObject(value)) {
    invalid('accessible必须为对象或null。');
  }
  for (const key of Object.keys(value)) {
    if (!rules.ACCESSIBLE_KEYS.includes(key)) {
      invalid('accessible包含未约定字段：' + key + '。');
    }
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (key === 'notes') {
      result.notes = readOptionalText(value.notes, 'accessible.notes', SHORT_TEXT_MAX);
      continue;
    }
    if (typeof value[key] !== 'boolean') {
      invalid('accessible.' + key + '必须为布尔值。');
    }
    result[key] = value[key];
  }
  return result;
}

function readLocation(value) {
  if (value === null) {
    return null;
  }
  if (!isObject(value)) {
    invalid('location必须为对象或null。');
  }
  const { latitude, longitude } = value;
  if (Object.keys(value).length !== 2) {
    invalid('location只接受latitude与longitude。');
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    invalid('location.latitude超出范围。');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    invalid('location.longitude超出范围。');
  }
  return { latitude, longitude };
}

function readIsoDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(rules.toTime(value))) {
    invalid(label + '必须为可解析的日期字符串。');
  }
  return new Date(rules.toTime(value)).toISOString();
}

const CHANGE_READERS = Object.freeze({
  name: (value) => readRequiredText(value, 'name', NAME_MAX),
  campus: (value) => readRequiredText(value, 'campus', CAMPUS_MAX),
  tags: (value) => readTags(value),
  openState: (value) => {
    if (!rules.OPEN_STATES.includes(value)) {
      invalid('openState不在约定取值内。');
    }
    return value;
  },
  openHours: (value) => readOptionalText(value, 'openHours', SHORT_TEXT_MAX),
  address: (value) => readOptionalText(value, 'address', SHORT_TEXT_MAX),
  contact: (value) => readOptionalText(value, 'contact', SHORT_TEXT_MAX),
  accessible: (value) => readAccessible(value),
  location: (value) => readLocation(value),
  source: (value) => readRequiredText(value, 'source', SHORT_TEXT_MAX),
  validUntil: (value) => readIsoDate(value, 'validUntil'),
  enabled: (value) => {
    if (typeof value !== 'boolean') {
      invalid('enabled必须为布尔值。');
    }
    return value;
  },
  isSynthetic: (value) => {
    if (typeof value !== 'boolean') {
      invalid('isSynthetic必须为布尔值。');
    }
    return value;
  },
});

const CHANGE_FIELDS = Object.freeze(Object.keys(CHANGE_READERS));

function validateUpdatePlace(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
  for (const key of Object.keys(payload)) {
    if (!['placeId', 'changes', 'markVerified', 'expectedUpdatedAt'].includes(key)) {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
  const placeId = payload.placeId;
  if (typeof placeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(placeId)) {
    invalid('placeId格式无效。');
  }
  if (!isObject(payload.changes)) {
    invalid('changes必须为对象。');
  }
  const keys = Object.keys(payload.changes);
  if (keys.length === 0) {
    invalid('changes不能为空。');
  }
  const changes = {};
  for (const key of keys) {
    if (!hasOwn(CHANGE_READERS, key)) {
      // verifiedAt / verifiedBy / updatedAt arrive here if a caller tries to
      // backdate a verification; only the server may stamp them.
      invalid('changes包含不可维护字段：' + key + '。');
    }
    changes[key] = CHANGE_READERS[key](payload.changes[key]);
  }
  let markVerified = false;
  if (payload.markVerified !== undefined) {
    if (typeof payload.markVerified !== 'boolean') {
      invalid('markVerified必须为布尔值。');
    }
    markVerified = payload.markVerified;
  }
  let expectedUpdatedAt = null;
  if (payload.expectedUpdatedAt !== undefined && payload.expectedUpdatedAt !== null) {
    expectedUpdatedAt = readIsoDate(payload.expectedUpdatedAt, 'expectedUpdatedAt');
  }
  return { placeId, changes, markVerified, expectedUpdatedAt };
}

function validateAdminListPlaces(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
  for (const key of Object.keys(payload)) {
    if (!['campus', 'enabled', 'verificationState', 'page', 'pageSize'].includes(key)) {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
  let enabled = null;
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') {
      invalid('enabled必须为布尔值。');
    }
    enabled = payload.enabled;
  }
  let verificationState = null;
  if (payload.verificationState !== undefined) {
    if (!VERIFICATION_STATES.includes(payload.verificationState)) {
      invalid('verificationState不在约定取值内。');
    }
    verificationState = payload.verificationState;
  }
  return {
    campus: readOptionalFilterString(payload, 'campus', CAMPUS_MAX),
    enabled,
    verificationState,
    ...readPage(payload),
  };
}

function validateAdminGetPlace(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
  for (const key of Object.keys(payload)) {
    if (key !== 'placeId') {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
  if (typeof payload.placeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.placeId)) {
    invalid('placeId格式无效。');
  }
  return { placeId: payload.placeId };
}

function validateAdminListCorrections(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
  for (const key of Object.keys(payload)) {
    if (!['status', 'page', 'pageSize'].includes(key)) {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
  let status = null;
  if (payload.status !== undefined) {
    if (!rules.CORRECTION_STATUS.includes(payload.status)) {
      invalid('status不在约定取值内。');
    }
    status = payload.status;
  }
  return { status, ...readPage(payload) };
}

function validateAdminListResources(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
  for (const key of Object.keys(payload)) {
    if (!['campus', 'enabled', 'page', 'pageSize'].includes(key)) {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
  let enabled = null;
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') {
      invalid('enabled必须为布尔值。');
    }
    enabled = payload.enabled;
  }
  return {
    campus: readOptionalFilterString(payload, 'campus', CAMPUS_MAX),
    enabled,
    ...readPage(payload),
  };
}

// ---------------------------------------------------------------------------
// Selection and write planning
// ---------------------------------------------------------------------------

function validateAdminListTemplates(payload) {
  if (!isObject(payload)) {
    invalid('请求参数必须为对象。');
  }
  for (const key of Object.keys(payload)) {
    if (!['enabled', 'page', 'pageSize'].includes(key)) {
      invalid('请求参数包含未约定字段：' + key + '。');
    }
  }
  let enabled = null;
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== 'boolean') {
      invalid('enabled必须为布尔值。');
    }
    enabled = payload.enabled;
  }
  return { enabled, ...readPage(payload) };
}
function selectAdminPlaces(rows, query, nowMs) {
  const annotated = rows.map((place) => ({
    place,
    state: rules.classification(place, nowMs),
  }));
  const filtered = annotated
    .filter((entry) => query.campus === null || entry.place.campus === query.campus)
    .filter((entry) => query.enabled === null || (entry.place.enabled === true) === query.enabled)
    .filter((entry) => query.verificationState === null || entry.state === query.verificationState)
    .sort((left, right) => rules.comparePlaces(left.place, right.place));
  const page = rules.paginate(filtered, query.page, query.pageSize);
  return {
    ...page,
    items: page.items.map((entry) => rules.adminRecord(entry.place, entry.state)),
  };
}

function selectAdminPlace(rows, placeId, nowMs) {
  const place = rules.findPlace(rows, placeId);
  if (!place) {
    rules.notFound('未找到该地点。');
  }
  return rules.adminRecord(place, rules.classification(place, nowMs));
}

/**
 * Plans the write for one place. Everything that a caller must not control —
 * who verified it, when, and who last touched it — is computed here from the
 * trusted actor and the server clock.
 *
 * @returns {{ changes: object, next: object }}
 */
function planPlaceUpdate({ existing, input, actor, nowMs }) {
  const expected = input.expectedUpdatedAt;
  if (expected !== null) {
    const current = rules.toIso(existing.updatedAt);
    if (current === null || rules.toIso(expected) !== current) {
      // A stale console tab must not overwrite a newer verification.
      throw new AppError(
        ERROR_CODES.CONFLICT,
        '该地点已被更新，请重新读取后再保存，当前修改未写入。',
      );
    }
  }
  const next = { ...input.changes };
  const source = hasOwn(next, 'source') ? next.source : existing.source;
  if (input.markVerified && !rules.isNonEmptyString(source, SHORT_TEXT_MAX)) {
    invalid('标记核验前必须填写可追溯来源。');
  }
  const previousTime = rules.toTime(existing.updatedAt);
  const nextTime = Math.max(nowMs, Number.isFinite(previousTime) ? previousTime + 1 : nowMs);
  if (!Number.isFinite(nextTime) || Math.abs(nextTime) > 8640000000000000) {
    throw new AppError(ERROR_CODES.CONFLICT, '资料版本已耗尽，未写入。');
  }
  const nowIso = new Date(nextTime).toISOString();
  const stamped = { ...next, updatedBy: actor.accountId, updatedAt: nowIso };
  if (input.markVerified) {
    stamped.verifiedAt = new Date(nowMs).toISOString();
    stamped.verifiedBy = actor.accountId;
  }
  return { changes: stamped, markedVerified: input.markVerified };
}

function selectAdminCorrections(rows, query) {
  const filtered = rows
    .filter((row) => query.status === null || row.status === query.status)
    .sort(
      (left, right) =>
        (rules.toTime(right.createdAt) || 0) - (rules.toTime(left.createdAt) || 0) ||
        String(left.placeId || '').localeCompare(String(right.placeId || '')),
    );
  const page = rules.paginate(filtered, query.page, query.pageSize);
  // The submitter's account is never returned: an operator reviewing a
  // correction does not need to know who wrote it, only which place it is about.
  return {
    ...page,
    items: page.items.map((row) => ({
      correctionId: row._id || row.correctionId || null,
      placeId: row.placeId,
      text: typeof row.text === 'string' ? row.text : '',
      status: row.status,
      createdAt: rules.toIso(row.createdAt),
    })),
  };
}

function selectAdminResources(rows, query, nowMs) {
  const filtered = rows
    .filter((row) => query.campus === null || row.campus === query.campus)
    .filter((row) => query.enabled === null || (row.enabled === true) === query.enabled)
    .sort(rules.comparePlaces);
  const page = rules.paginate(filtered, query.page, query.pageSize);
  return {
    ...page,
    items: page.items.map((row) => ({
      resourceId: row.resourceId || row._id || null,
      name: typeof row.name === 'string' ? row.name : null,
      campus: typeof row.campus === 'string' ? row.campus : null,
      category: typeof row.category === 'string' ? row.category : null,
      enabled: row.enabled === true,
      isSynthetic: row.isSynthetic === true,
      source: typeof row.source === 'string' ? row.source : null,
      validUntil: rules.toIso(row.validUntil),
      verificationState: rules.classification(row, nowMs),
    })),
  };
}

// Task templates are read-only in week two: admin.updateTaskTemplate stays
// NOT_IMPLEMENTED until the template fields are agreed with Jiawei and
// Qizhen Chen, so the projection deliberately stays minimal.
function selectAdminTemplates(rows, query) {
  const filtered = rows
    .filter((row) => query.enabled === null || (row.enabled === true) === query.enabled)
    .sort(
      (left, right) =>
        String(left.title || '').localeCompare(String(right.title || '')) ||
        String(left.templateId || '').localeCompare(String(right.templateId || '')),
    );
  const page = rules.paginate(filtered, query.page, query.pageSize);
  return {
    ...page,
    items: page.items.map((row) => ({
      templateId: row.templateId || row._id || null,
      title: typeof row.title === 'string' ? row.title : null,
      enabled: row.enabled === true,
      isSynthetic: row.isSynthetic === true,
      updatedAt: rules.toIso(row.updatedAt),
    })),
  };
}

module.exports = {
  VERIFICATION_STATES,
  CHANGE_FIELDS,
  validateUpdatePlace,
  validateAdminListPlaces,
  validateAdminGetPlace,
  validateAdminListCorrections,
  validateAdminListResources,
  validateAdminListTemplates,
  selectAdminPlaces,
  selectAdminPlace,
  planPlaceUpdate,
  selectAdminCorrections,
  selectAdminResources,
  selectAdminTemplates,
};
