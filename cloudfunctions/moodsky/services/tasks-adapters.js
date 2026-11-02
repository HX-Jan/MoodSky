// ============================================================================
// MoodSky — tasks adapter seam  (W3 JF02, Jiawei Fang)
// ============================================================================
// Turns the W2 task candidates into the two callable seams the router needs:
//
//   public   tasks.suggestions / tasks.quickChoice -> read-only public service
//            (services/task-suggestions.js shape: bounded catalogue read, no
//            actor, no journal lookup, no task history, non-fabricated empty
//            state)
//   private  tasks.transition / tasks.history      -> services/tasks-candidate
//            domain; history is projected to the client's items/nextCursor
//            while the server entries/nextCursor stays the only source
//
// Every other action (tasks.mine included) answers NOT_IMPLEMENTED, and a
// missing dependency answers NOT_IMPLEMENTED at dispatch time instead of a
// fabricated empty success. tasks.mine is deliberately outside this seam: it
// mixes the public catalogue with private state, and tools/week2-integration
// already keeps it unwired.
//
// Local opt-in factory only. domains/tasks.js keeps its NOT_IMPLEMENTED stub and
// index.js does not assemble this module (packaging gate).
// ============================================================================

const { AppError, notImplemented } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');

const PUBLIC_ACTIONS = Object.freeze(['tasks.suggestions', 'tasks.quickChoice']);
const PRIVATE_ACTIONS = Object.freeze(['tasks.transition', 'tasks.history']);
// Client history item fields. ownerId/query metadata never leave the domain.
const CLIENT_HISTORY_FIELDS = Object.freeze(['taskId', 'date', 'state', 'createdAt']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse(message) {
  throw new AppError(ERROR_CODES.INVALID_RESPONSE, message);
}

// Only renames the server page for the current client controller. No entry is
// reordered, dropped, defaulted or enriched here.
function toClientHistory(data) {
  if (!isPlainObject(data) || !Array.isArray(data.entries)) {
    invalidResponse('任务历史结果不完整。');
  }
  const nextCursor = data.nextCursor === undefined ? null : data.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== 'string') {
    invalidResponse('任务历史游标不完整。');
  }
  const items = data.entries.map((entry) => {
    if (!isPlainObject(entry)) {
      invalidResponse('任务历史条目不完整。');
    }
    const item = {};
    for (const field of CLIENT_HISTORY_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        // A missing field is reported, never dropped: a client row without a date
        // or state would look like a task that was never transitioned.
        invalidResponse('任务历史条目不完整。');
      }
      item[field] = entry[field];
    }
    return item;
  });
  return { items, nextCursor: nextCursor === '' ? null : nextCursor };
}

function publicReader(publicSuggestions) {
  if (typeof publicSuggestions === 'function') {
    return (request) => publicSuggestions(request);
  }
  if (isPlainObject(publicSuggestions) && typeof publicSuggestions.handle === 'function') {
    return (request) => publicSuggestions.handle(request);
  }
  return null;
}

/**
 * Builds the action->seam router for the task domain.
 *
 * @param {object} options
 *   tasksDomain      services/tasks-candidate createTasksDomain result ({ handle })
 *   publicSuggestions services/task-suggestions handler, or { handle }
 *   clock            shared time source for the caller's assembly; this adapter
 *                    never reads a clock itself (the domain owns the business day)
 */
function createTasksAdapters({ tasksDomain, publicSuggestions, clock } = {}) {
  if (
    tasksDomain !== undefined &&
    tasksDomain !== null &&
    (!isPlainObject(tasksDomain) || typeof tasksDomain.handle !== 'function')
  ) {
    throw new TypeError('createTasksAdapters requires a task domain exposing handle().');
  }
  if (
    publicSuggestions !== undefined &&
    publicSuggestions !== null &&
    typeof publicSuggestions !== 'function' &&
    !(isPlainObject(publicSuggestions) && typeof publicSuggestions.handle === 'function')
  ) {
    throw new TypeError('createTasksAdapters requires a public read handler or { handle }.');
  }
  if (clock !== undefined && clock !== null && typeof clock !== 'function') {
    throw new TypeError('createTasksAdapters clock must be a function when provided.');
  }

  const readClock = typeof clock === 'function' ? clock : () => new Date();
  const readPublic = publicReader(publicSuggestions);
  const privateHandle =
    tasksDomain && typeof tasksDomain.handle === 'function' ? tasksDomain.handle : null;

  async function handle(request) {
    const action = request && request.action;
    if (PUBLIC_ACTIONS.includes(action)) {
      if (!readPublic) {
        // No public read service is assembled: fail closed, never synthesize tasks.
        return notImplemented();
      }
      // The actor is neither required nor forwarded; a public answer can therefore
      // never depend on a private row.
      return readPublic({
        action,
        payload: request.payload === undefined ? {} : request.payload,
      });
    }
    if (PRIVATE_ACTIONS.includes(action)) {
      if (!privateHandle) {
        return notImplemented();
      }
      const data = await privateHandle(request);
      return action === 'tasks.history' ? toClientHistory(data) : data;
    }
    // tasks.mine, account.* and anything outside this seam.
    return notImplemented();
  }

  return {
    handle,
    // Exposed so one assembly can share a single time source with the task domain.
    clock: readClock,
  };
}

module.exports = { createTasksAdapters, PUBLIC_ACTIONS, PRIVATE_ACTIONS };
