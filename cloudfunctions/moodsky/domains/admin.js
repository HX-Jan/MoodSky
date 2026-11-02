const { notImplemented, AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');
const rules = require('./campus-rules');
const adminRules = require('./admin-rules');

// Junhan Huang: operator-only place/task/support maintenance. No journal access.
//
// The role gate is enforced once, in router.js, before this module runs: an
// operator action with no server-side `data_operator` grant answers FORBIDDEN
// and never reaches this handler. Repeating the check here would only create a
// second place where the rule can drift.
//
// Reads exist because client access to every collection is denied
// (database/client-access-policy.json). Without them an operator could save a
// place and be unable to see what was saved.

function requireRepository(repositories, name) {
  if (!repositories || !repositories[name]) {
    return notImplemented();
  }
  return repositories[name];
}

function requireActor(actor) {
  if (!actor || typeof actor.accountId !== 'string' || actor.accountId.length === 0) {
    throw new AppError(ERROR_CODES.FORBIDDEN, '需要资料维护权限。');
  }
  return actor;
}

function readNow(now) {
  return typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
}

async function listPlaces(payload, repositories, nowMs) {
  const query = adminRules.validateAdminListPlaces(payload);
  const store = requireRepository(repositories, 'places');
  const { rows, truncated } = await store.listAll();
  // Unpublished rows are included on purpose: the operator is the only caller
  // allowed to see what is still unverified, synthetic or disabled.
  return { ...adminRules.selectAdminPlaces(rows, query, nowMs), truncated };
}

async function getPlace(payload, repositories, nowMs) {
  const query = adminRules.validateAdminGetPlace(payload);
  const store = requireRepository(repositories, 'places');
  const place = await store.findByPlaceId(query.placeId);
  return adminRules.selectAdminPlace(place ? [place] : [], query.placeId, nowMs);
}

async function updatePlace(payload, actor, repositories, nowMs) {
  // The default closed entry does not load write-only dependencies.
  const { isDeepStrictEqual } = require('node:util');
  const input = adminRules.validateUpdatePlace(payload);
  const { accountId } = requireActor(actor);
  const store = requireRepository(repositories, 'places');
  const existing = await store.findByPlaceId(input.placeId);
  if (!existing) {
    rules.notFound('未找到该地点。');
  }
  if (typeof existing._id !== 'string' || existing._id.length === 0) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, '资料记录缺少内部标识，未写入。');
  }
  const result = await store.updateById(existing._id, (current) => {
    if (!current || current._id !== existing._id || current.placeId !== input.placeId) {
      throw new AppError(ERROR_CODES.CONFLICT, '资料已变化，请重新读取。');
    }
    return adminRules.planPlaceUpdate({ existing: current, input, actor: { accountId }, nowMs })
      .changes;
  });
  if (result?.updated !== 1 || !result.changes) {
    throw new AppError(ERROR_CODES.CONFLICT, '未确认资料写入，请重新读取。');
  }

  // Re-read: "保存成功" is only reported when the stored value is what the
  // operator asked for. A write that cannot be read back is reported as
  // unverified, never as success.
  const reread = await store.findByPlaceId(input.placeId);
  if (!reread) {
    return {
      saved: true,
      verified: false,
      place: null,
      message: '修改已提交，但重新读取未返回该地点，请刷新后核对。',
    };
  }
  const applied = adminRules.selectAdminPlace([reread], input.placeId, nowMs);
  return {
    saved: true,
    verified: Object.entries(result.changes).every(([key, value]) =>
      isDeepStrictEqual(reread[key], value),
    ),
    place: applied,
    message: null,
  };
}

async function listCorrections(payload, repositories) {
  const query = adminRules.validateAdminListCorrections(payload);
  const store = requireRepository(repositories, 'corrections');
  const { rows, truncated } = await store.listAll();
  return { ...adminRules.selectAdminCorrections(rows, query), truncated };
}

async function listTaskTemplates(payload, repositories) {
  const query = adminRules.validateAdminListTemplates(payload);
  const store = requireRepository(repositories, 'taskTemplates');
  const { rows, truncated } = await store.listAll();
  return { ...adminRules.selectAdminTemplates(rows, query), truncated };
}

async function listSupportResources(payload, repositories, nowMs) {
  const query = adminRules.validateAdminListResources(payload);
  const store = requireRepository(repositories, 'supportResources');
  const { rows, truncated } = await store.listAll();
  return { ...adminRules.selectAdminResources(rows, query, nowMs), truncated };
}

/**
 * Reviews one private correction. The decision is recorded on the correction
 * only: the place record is untouched (`placeUpdated: false`), because a
 * submission is a suggestion, not a verified fact. Applying it remains a
 * separate `admin.updatePlace` call with its own conflict and re-read rules.
 */
async function reviewCorrection(payload, actor, repositories, nowMs) {
  const input = adminRules.validateReviewCorrection(payload);
  const { accountId } = requireActor(actor);
  const store = requireRepository(repositories, 'corrections');
  const existing = await store.findByCorrectionId(input.correctionId);
  if (!existing) {
    rules.notFound('未找到该纠错记录。');
  }

  const planned = adminRules.planCorrectionReview({
    correction: existing,
    decision: input.decision,
    note: input.note,
    actor: { accountId },
    nowMs,
  });
  if (planned.alreadyReviewed) {
    // Replaying the same decision is not an error and not a second write.
    return {
      reviewed: false,
      alreadyReviewed: true,
      placeUpdated: false,
      correction: adminRules.selectAdminCorrection(existing),
    };
  }

  const result = await store.reviewById(input.correctionId, (current) => {
    if (!current) {
      rules.notFound('未找到该纠错记录。');
    }
    return adminRules.planCorrectionReview({
      correction: current,
      decision: input.decision,
      note: input.note,
      actor: { accountId },
      nowMs,
    });
  });
  if (!result || result.updated !== 1) {
    const reread = await store.findByCorrectionId(input.correctionId);
    if (result?.alreadyReviewed === true && reread && reread.status === input.decision) {
      return {
        reviewed: false,
        alreadyReviewed: true,
        placeUpdated: false,
        correction: adminRules.selectAdminCorrection(reread),
      };
    }
    throw new AppError(ERROR_CODES.CONFLICT, '未确认审核写入，请重新读取。');
  }

  const reread = await store.findByCorrectionId(input.correctionId);
  const { isDeepStrictEqual } = require('node:util');
  if (
    !reread ||
    !result.changes ||
    !Object.entries(result.changes).every(([key, value]) => isDeepStrictEqual(reread[key], value))
  ) {
    throw new AppError(ERROR_CODES.CONFLICT, '审核已提交但读回未确认，请重新读取，勿重复提交。');
  }
  const stored = reread;
  return {
    reviewed: true,
    alreadyReviewed: false,
    // Approval records the suggestion; it never edits the place on its own.
    placeUpdated: false,
    correction: adminRules.selectAdminCorrection(stored),
  };
}

async function handle({ action, payload, actor, repositories, now }) {
  // Unwired deployment answers NOT_IMPLEMENTED before validating the payload, so
  // an environment without campus collections never reads as a client error.
  if (!repositories) {
    return notImplemented();
  }
  const nowMs = readNow(now);
  if (action === 'admin.listPlaces') {
    return listPlaces(payload, repositories, nowMs);
  }
  if (action === 'admin.getPlace') {
    return getPlace(payload, repositories, nowMs);
  }
  if (action === 'admin.updatePlace') {
    return updatePlace(payload, actor, repositories, nowMs);
  }
  if (action === 'admin.listCorrections') {
    return listCorrections(payload, repositories);
  }
  if (action === 'admin.listTaskTemplates') {
    return listTaskTemplates(payload, repositories);
  }
  if (action === 'admin.listSupportResources') {
    return listSupportResources(payload, repositories, nowMs);
  }
  if (action === 'admin.reviewCorrection') {
    return reviewCorrection(payload, actor, repositories, nowMs);
  }
  // admin.updateTaskTemplate and admin.updateSupportResource stay
  // NOT_IMPLEMENTED: the plan keeps those forms unimplemented until their fields
  // are agreed and the operator UI exists. They must not return a pretend
  // success.
  return notImplemented();
}

module.exports = { handle };
