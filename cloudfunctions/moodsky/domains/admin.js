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
  const { rows } = await store.listAll();
  return adminRules.selectAdminPlace(rows, query.placeId, nowMs);
}

async function updatePlace(payload, actor, repositories, nowMs) {
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
  const plan = adminRules.planPlaceUpdate({
    existing,
    input,
    actor: { accountId },
    nowMs,
  });
  await store.updateById(existing._id, plan.changes);

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
    verified: applied.updatedAt === plan.changes.updatedAt,
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
  // admin.reviewCorrection, admin.updateTaskTemplate and
  // admin.updateSupportResource stay NOT_IMPLEMENTED: the plan keeps forms
  // outside the place chain unimplemented until their fields are agreed and
  // the operator UI exists. They must not return a pretend success.
  return notImplemented();
}

module.exports = { handle };
