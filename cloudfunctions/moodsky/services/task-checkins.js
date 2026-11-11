// W4 JF03 — task + place check-in composite service (opt-in candidate).
//
// Two existing seams stay untouched:
//   services/tasks-candidate.js   tasks.transition payload is exactly
//                                 taskId / transition / replacementTaskId, and
//                                 its result shape is not changed here.
//   services/checkins.js          campus.checkin payload is exactly placeId, and
//                                 complete() still returns { visit, duplicated }.
//
// The association is expressed as a *separate* action (tasks.checkin) whose
// payload carries both ids at the top level. The same requestId is forwarded to
// both halves, so their existing receipts make a retry idempotent without
// teaching either protocol about the other domain. The only new persisted fact
// is the link row in stores/task-checkin-links.js.
//
// NOT wired into index.js / production/backend.js and not registered in
// shared/contracts.js ACTIONS: the action names below are candidates pending an
// interface review. Every unassembled dependency answers NOT_IMPLEMENTED.
const { ERROR_CODES } = require('../shared/contracts');
const { AppError, notImplemented } = require('../shared/result');
const { businessDate, isBusinessDate } = require('../shared/date');
const { classification } = require('../domains/campus-rules');
const {
  createTaskCheckinLinkStore,
  isPendingRetryUnavailable,
  REQUEST_ID_PATTERN,
  TASK_ID_PATTERN,
} = require('../stores/task-checkin-links');

const COMPOSITE_ACTIONS = Object.freeze([
  'tasks.checkin',
  'tasks.checkinHistory',
  'tasks.checkinStatus',
]);
const DELEGATED_ACTIONS = Object.freeze([
  'tasks.transition',
  'tasks.history',
  'campus.checkin',
  'campus.checkinHistory',
]);
const PAGE_MAX = 50;
const PLACE_NOT_AVAILABLE = '地点不可打卡。';
// This is a failure, never a success: the task half may already be committed
// while the place check-in is still unconfirmed. The same requestId is the only
// supported recovery path.
const CHECKIN_UNCONFIRMED = '任务已完成，打卡尚未确认，请用原请求标识重试。';
// L1: a pending-intent retry whose place is still unavailable is a recovery
// attempt, not a first request. The task half may already be complete, so the
// answer must explain the partial state and the only completion path instead of
// repeating the first-request "place unavailable" NOT_FOUND.
const CHECKIN_PENDING_PLACE_UNAVAILABLE =
  '任务已完成，打卡尚未确认，地点当前不可用；地点恢复后请用原请求标识补全。';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(message) {
  throw new AppError(ERROR_CODES.INVALID_INPUT, message);
}
function invalidResponse(message) {
  throw new AppError(ERROR_CODES.INVALID_RESPONSE, message);
}
function hasOnlyKeys(payload, allowed) {
  if (!isPlainObject(payload)) {
    invalid('请求内容必须为对象。');
  }
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    invalid('请求包含未约定字段。');
  }
}
function payloadOf(request) {
  return request && request.payload !== undefined ? request.payload : {};
}
// A replay keeps the stored first-execution values except for the two response
// flags: this call created nothing and repeats an earlier result.
function replayView(result) {
  return { ...JSON.parse(JSON.stringify(result)), created: false, replayed: true };
}
function checkTaskOutcome(task, taskId) {
  if (
    !isPlainObject(task) ||
    task.taskId !== taskId ||
    task.state !== 'completed' ||
    !isBusinessDate(task.date) ||
    typeof task.replayed !== 'boolean'
  ) {
    invalidResponse('任务完成结果不完整。');
  }
  return task;
}
function checkCheckinOutcome(checkin, placeId) {
  if (
    !isPlainObject(checkin) ||
    typeof checkin.duplicated !== 'boolean' ||
    !isPlainObject(checkin.visit) ||
    checkin.visit.placeId !== placeId ||
    !isBusinessDate(checkin.visit.date) ||
    typeof checkin.visit.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(checkin.visit.completedAt))
  ) {
    invalidResponse('地点打卡结果不完整。');
  }
  return checkin.visit;
}
function readPage(payload) {
  const page = payload.page === undefined ? 1 : payload.page;
  const pageSize = payload.pageSize === undefined ? 10 : payload.pageSize;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PAGE_MAX
  ) {
    invalid('分页无效。');
  }
  return { page, pageSize };
}
// L3: once the task half committed, any failure of the check-in half or of the
// association commit leaves the same partial state (task completed, check-in
// unconfirmed, link pending). Both are reported as the recovery CONFLICT; the
// account gate keeps its own code and is never wrapped.
function unconfirmedFailure(error) {
  if (error instanceof AppError && error.code === ERROR_CODES.ACCOUNT_DISABLED) {
    return error;
  }
  return new AppError(ERROR_CODES.CONFLICT, CHECKIN_UNCONFIRMED);
}

/**
 * Builds the composite seam for the tasks + campus check-in candidate.
 *
 * @param {object} options
 *   database          transactional storage ({ runTransaction }) used only for
 *                     the new link document
 *   tasksDomain       services/tasks-candidate createTasksDomain result
 *   checkins          services/checkins createPersistentService result
 *   findPlace         (tx, placeId) -> place row or null, read inside a
 *                     transaction exactly like services/checkins.js. Required
 *                     for the tasks.checkin write path: without it that action
 *                     fails closed with NOT_IMPLEMENTED before any write.
 *   resolveIdentity   binding -> trusted owner id or null
 *   resolveActive     (tx, owner) -> boolean
 *   resolveDisabled   (tx, owner) -> boolean; enables cleanupDisabled only
 *   publicSuggestions optional tasks.suggestions/quickChoice handler
 *   now               millisecond clock; server business day is derived from it
 *   capacity          committed link rows per owner (candidate limit; clamped
 *                     to the store's MAX_LINKS). Pending intents are not
 *                     counted here; they have their own small, age-reaped quota.
 */
function createTaskCheckinService({
  database,
  tasksDomain,
  checkins,
  findPlace,
  resolveIdentity,
  resolveActive,
  resolveDisabled,
  publicSuggestions,
  now = Date.now,
  capacity,
} = {}) {
  if (!tasksDomain || typeof tasksDomain.handle !== 'function') {
    throw new TypeError('Task check-in service requires a task domain exposing handle().');
  }
  if (
    !checkins ||
    typeof checkins.complete !== 'function' ||
    typeof checkins.history !== 'function'
  ) {
    throw new TypeError('Task check-in service requires the check-in candidate service.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('Task check-in service clock must be a function.');
  }
  if (
    publicSuggestions !== undefined &&
    publicSuggestions !== null &&
    typeof publicSuggestions !== 'function' &&
    !(isPlainObject(publicSuggestions) && typeof publicSuggestions.handle === 'function')
  ) {
    throw new TypeError(
      'Task check-in service publicSuggestions must be a function or { handle }.',
    );
  }
  const store = createTaskCheckinLinkStore({
    database,
    resolveIdentity,
    resolveActive,
    resolveDisabled,
    now,
    ...(capacity === undefined ? {} : { capacity }),
  });
  const readPublic =
    typeof publicSuggestions === 'function'
      ? (request) => publicSuggestions(request)
      : isPlainObject(publicSuggestions) && typeof publicSuggestions.handle === 'function'
        ? (request) => publicSuggestions.handle(request)
        : null;

  // Same rule as services/checkins.js: verified/expiring classification and an
  // OPEN/LIMITED place. Evaluating classification first keeps a null place from
  // reaching place.openState. This is a pre-write gate, not the check-in itself:
  // the window until checkins.complete is accepted and reported as unconfirmed.
  async function assertPlaceCallable(tx, placeId) {
    const instant = now();
    const place = await findPlace(tx, placeId);
    if (
      !['verified', 'expiring'].includes(classification(place, instant)) ||
      !['OPEN', 'LIMITED'].includes(place.openState)
    ) {
      throw new AppError(ERROR_CODES.NOT_FOUND, PLACE_NOT_AVAILABLE);
    }
  }

  async function completeWithCheckin(request, binding) {
    if (
      !request ||
      typeof request.requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(request.requestId)
    ) {
      invalid('任务打卡请求标识无效。');
    }
    const payload = payloadOf(request);
    hasOnlyKeys(payload, ['taskId', 'placeId']);
    const taskId = payload.taskId;
    const placeId = payload.placeId;
    if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
      invalid('任务标识无效。');
    }
    if (typeof placeId !== 'string' || !placeId.trim()) {
      invalid('地点标识无效。');
    }
    // Fail closed: the composite must not complete the task first and hope the
    // place check-in passes. Without the injected place reader no business write
    // is attempted at all.
    if (typeof findPlace !== 'function') {
      return notImplemented();
    }
    const requestId = request.requestId;
    const digest = JSON.stringify([taskId, placeId]);
    const date = businessDate(new Date(now()));
    // 1. Place precheck inside the request-mapping transaction, before the
    //    pending intent is persisted and before either half runs. A replay of an
    //    already committed request (or a same-day equivalent association) is
    //    answered first without re-reading the place. A pending-intent retry
    //    whose place is still unavailable is a recovery conflict, not a
    //    first-request NOT_FOUND: the task may already be complete.
    let prepared;
    try {
      prepared = await store.prepare(binding, { requestId, digest, taskId, placeId, date }, (tx) =>
        assertPlaceCallable(tx, placeId),
      );
    } catch (error) {
      if (isPendingRetryUnavailable(error)) {
        throw new AppError(ERROR_CODES.CONFLICT, CHECKIN_PENDING_PLACE_UNAVAILABLE);
      }
      throw error;
    }
    // A requestId already answered by an earlier call (including a same-day
    // equivalent dedupe) replays the stored result instead of executing again.
    if (prepared.replay) {
      return replayView(prepared.replay);
    }
    // 2. Task first: its state machine is the stricter half, and a rejected task
    //    transition must not leave a place check-in that looks like a finished task.
    const task = checkTaskOutcome(
      await tasksDomain.handle({
        action: 'tasks.transition',
        requestId,
        actor: { accountId: prepared.owner },
        payload: { taskId, transition: 'complete' },
      }),
      taskId,
    );
    // 3. Place check-in. A failure here happens after the task half committed
    //    (or replayed an earlier completion), so the composite answers a failure
    //    with a pending association; retrying the same requestId is the only
    //    supported recovery. The account gate keeps its own code.
    let checkin;
    try {
      checkin = await checkins.complete({ requestId, payload: { placeId } }, binding);
    } catch (error) {
      throw unconfirmedFailure(error);
    }
    let visit;
    try {
      visit = checkCheckinOutcome(checkin, placeId);
    } catch (error) {
      // The check-in half wrote its visit but answered an incomplete structure:
      // same partial state as a failed half, so use the same recovery answer.
      throw unconfirmedFailure(error);
    }
    const linkedDate = task.date === visit.date ? task.date : null;
    const result = {
      taskId,
      placeId,
      linkedDate,
      task: { taskId, date: task.date, state: task.state, replayed: task.replayed === true },
      checkin: {
        placeId,
        date: visit.date,
        completedAt: visit.completedAt,
        placeName: typeof visit.placeName === 'string' ? visit.placeName : null,
        duplicated: checkin.duplicated === true,
      },
      linkedAt: new Date(now()).toISOString(),
      created: true,
      replayed: false,
    };
    let committed;
    try {
      committed = await store.commit(binding, { requestId, result });
    } catch (error) {
      // Both business halves are already durable here; only the association is
      // missing. A bare storage error must still tell the client the task is
      // complete and the same requestId finishes the job.
      throw unconfirmedFailure(error);
    }
    // The later of two concurrent calls with the same requestId reports a replay:
    // only one of them actually created the association row.
    return committed.replayed ? replayView(committed.result) : committed.result;
  }

  async function transition(request, binding) {
    const owner = await store.assertActive(binding);
    // The task domain keeps its own payload whitelist; a placeId added here would
    // be rejected there with INVALID_INPUT instead of being silently accepted.
    return tasksDomain.handle({
      action: 'tasks.transition',
      requestId: request ? request.requestId : undefined,
      actor: { accountId: owner },
      payload: payloadOf(request),
    });
  }

  async function taskHistory(request, binding) {
    const owner = await store.assertActive(binding);
    return tasksDomain.handle({
      action: 'tasks.history',
      actor: { accountId: owner },
      payload: payloadOf(request),
    });
  }

  async function checkin(request, binding) {
    return checkins.complete(request, binding);
  }

  async function checkinHistory(request, binding) {
    return checkins.history(payloadOf(request), binding);
  }

  async function linkStatus(request, binding) {
    const payload = payloadOf(request);
    hasOnlyKeys(payload, ['requestId']);
    if (typeof payload.requestId !== 'string' || !REQUEST_ID_PATTERN.test(payload.requestId)) {
      invalid('请求标识无效。');
    }
    const found = await store.find(binding, payload.requestId);
    if (found.status !== 'committed') {
      return { requestId: payload.requestId, status: found.status };
    }
    return { requestId: payload.requestId, status: 'committed', result: replayView(found.result) };
  }

  async function linkHistory(request, binding) {
    const payload = payloadOf(request);
    hasOnlyKeys(payload, ['page', 'pageSize']);
    return store.history(binding, readPage(payload));
  }

  async function publicAction(request) {
    if (!readPublic) {
      return notImplemented();
    }
    return readPublic({
      action: request.action,
      payload: payloadOf(request),
    });
  }

  async function handle(request, binding) {
    const action = request && request.action;
    switch (action) {
      case 'tasks.transition':
        return transition(request, binding);
      case 'tasks.history':
        return taskHistory(request, binding);
      case 'tasks.checkin':
        return completeWithCheckin(request, binding);
      case 'tasks.checkinHistory':
        return linkHistory(request, binding);
      case 'tasks.checkinStatus':
        return linkStatus(request, binding);
      case 'campus.checkin':
        return checkin(request, binding);
      case 'campus.checkinHistory':
        return checkinHistory(request, binding);
      case 'tasks.suggestions':
      case 'tasks.quickChoice':
        return publicAction(request);
      default:
        return notImplemented();
    }
  }

  return {
    completeWithCheckin,
    transition,
    taskHistory,
    checkin,
    checkinHistory,
    linkHistory,
    linkStatus,
    handle,
    // Server-only lifecycle seam; caller must not expose it to the page transport.
    cleanupDisabled: (owner) => store.cleanupDisabled(owner),
  };
}

module.exports = { createTaskCheckinService, COMPOSITE_ACTIONS, DELEGATED_ACTIONS };
