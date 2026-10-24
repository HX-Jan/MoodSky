const { ERROR_CODES } = require('../shared/contracts');
const { LIMITS, TASK_STATUS } = require('../shared/constants');
const { businessDate, isBusinessDate } = require('../shared/date');
const { AppError, notImplemented } = require('../shared/result');

// Jiawei Fang: F17-F20. Voluntary tasks; no photo or location evidence.
//
// W2 JF02 implements the four task actions against an injected store + clock.
// Payload whitelists live in this module on purpose: shared/validation.js is
// frozen this week (the structure check compares both copies) and adding a task
// validator there needs an interface review. See the W2 JF02 document.
//
// task_state semantics (docs/week1/Jiawei_Fang/w1-jf02-task-contract.md §3):
//   no record      -> select / complete / skip / replace are all allowed
//   selected       -> complete / skip / replace; a second select is a replay
//   terminal       -> the same target state replays ok, any other target CONFLICT

const TRANSITIONS = Object.freeze(['select', 'complete', 'skip', 'replace']);
const TARGET_STATE = Object.freeze({
  select: TASK_STATUS.SELECTED,
  complete: TASK_STATUS.COMPLETED,
  skip: TASK_STATUS.SKIPPED,
  replace: TASK_STATUS.REPLACED,
});
const TERMINAL_STATES = Object.freeze([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.SKIPPED,
  TASK_STATUS.REPLACED,
]);
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;
// W1 JF02 §5 leaves the task history window open; 90 days matches the largest
// review window until Xiang Hong confirms a task-specific value.
const HISTORY_MAX_RANGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUGGESTION_NOTICE = '完成由你自行确认，不做打卡惩罚。';
const QUICK_CHOICE_NOTICE = '不读取你的日记正文。';
const QUICK_CHOICE_ENTRIES = Object.freeze([
  Object.freeze({ kind: 'places', label: '找个安静角落', enabled: true }),
  Object.freeze({ kind: 'tasks', label: '做一件小事', enabled: true }),
]);

// Kept as the unwired fallback: router.js still maps tasks to this module, and a
// domain without a store must answer NOT_IMPLEMENTED instead of pretending.
async function handle(_request) {
  return notImplemented();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(message) {
  throw new AppError(ERROR_CODES.INVALID_INPUT, message);
}
function conflict(message) {
  throw new AppError(ERROR_CODES.CONFLICT, message);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function hasOnlyKeys(payload, allowed) {
  if (!isPlainObject(payload)) {
    invalid('任务输入必须为对象。');
  }
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    invalid('任务输入包含未约定字段。');
  }
}

// task_templates fields follow docs/week1/XiangYu/data-dictionary.md §9:
// _id / title / steps / durationMin / tags / enabled. A row that does not match
// is skipped rather than repaired, so an empty or broken collection renders as an
// empty state instead of a fabricated task.
function templateSortKey(row) {
  if (row.createdAt instanceof Date) {
    return row.createdAt.getTime();
  }
  const parsed = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeTemplate(row) {
  if (!isPlainObject(row) || row.enabled !== true) {
    return null;
  }
  const taskId = typeof row._id === 'string' ? row._id : row.taskId;
  if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
    return null;
  }
  if (typeof row.title !== 'string') {
    return null;
  }
  const title = row.title.trim();
  if (title.length === 0 || Array.from(title).length > 60) {
    return null;
  }
  if (!Array.isArray(row.steps) || row.steps.length > 10) {
    return null;
  }
  const steps = [];
  for (const step of row.steps) {
    if (typeof step !== 'string') {
      return null;
    }
    const text = step.trim();
    if (text.length === 0 || Array.from(text).length > 120) {
      return null;
    }
    steps.push(text);
  }
  let durationMin = null;
  if (row.durationMin !== undefined && row.durationMin !== null) {
    if (!Number.isInteger(row.durationMin) || row.durationMin < 1 || row.durationMin > 600) {
      return null;
    }
    durationMin = row.durationMin;
  }
  const tags = [];
  if (row.tags !== undefined) {
    if (!Array.isArray(row.tags) || row.tags.length > 10) {
      return null;
    }
    for (const tag of row.tags) {
      if (typeof tag !== 'string') {
        return null;
      }
      const text = tag.trim();
      if (text.length === 0 || Array.from(text).length > 20) {
        return null;
      }
      tags.push(text);
    }
  }
  // Derived from the declared tag vocabulary (indoor / outdoor); null means the
  // template did not say, and the client must not guess.
  const indoor = tags.length === 0 ? null : tags.includes('indoor');
  return { taskId, title, steps, durationMin, tags, indoor, sortKey: templateSortKey(row) };
}
function normalizeTemplates(rows) {
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const template = normalizeTemplate(row);
    if (template) {
      items.push(template);
    }
  }
  items.sort((left, right) => {
    if (left.sortKey !== right.sortKey) {
      return left.sortKey - right.sortKey;
    }
    if (left.taskId === right.taskId) {
      return 0;
    }
    return left.taskId < right.taskId ? -1 : 1;
  });
  return items;
}
function toSuggestion(template) {
  return {
    taskId: template.taskId,
    title: template.title,
    steps: template.steps.slice(),
    durationMin: template.durationMin,
    indoor: template.indoor,
    tags: template.tags.slice(),
    // Public actions never receive an actor, so no private state is exposed.
    state: null,
  };
}
function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ c: row.createdAt, i: row._id }), 'utf8').toString(
    'base64url',
  );
}
function decodeCursor(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    invalid('分页游标无效。');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (_error) {
    invalid('分页游标无效。');
  }
  if (!isPlainObject(parsed)) {
    invalid('分页游标无效。');
  }
  if (typeof parsed.c !== 'string' || parsed.c.length === 0 || parsed.c.length > 40) {
    invalid('分页游标无效。');
  }
  if (typeof parsed.i !== 'string' || parsed.i.length === 0 || parsed.i.length > 120) {
    invalid('分页游标无效。');
  }
  return { c: parsed.c, i: parsed.i };
}
function stateOf(states, taskId) {
  return Object.prototype.hasOwnProperty.call(states, taskId) ? states[taskId] : null;
}

function createTasksDomain({ store, clock = () => new Date() } = {}) {
  if (!store || typeof store.listTemplates !== 'function') {
    throw new TypeError('createTasksDomain requires a task store.');
  }

  function readClock() {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  }

  async function listSuggestions() {
    const templates = normalizeTemplates(await store.listTemplates());
    return templates.slice(0, LIMITS.taskSuggestions).map(toSuggestion);
  }

  async function suggestions(payload) {
    hasOnlyKeys(payload, []);
    return { items: await listSuggestions(), notice: SUGGESTION_NOTICE };
  }

  // Independent from journal: it only assembles the public entry points and the
  // same suggestions, so "not saved a journal entry yet" changes nothing here.
  async function quickChoice(payload) {
    hasOnlyKeys(payload, []);
    return {
      entries: QUICK_CHOICE_ENTRIES.map((entry) => ({ ...entry })),
      suggestions: await listSuggestions(),
      notice: QUICK_CHOICE_NOTICE,
    };
  }

  async function transition({ payload, actor, requestId }) {
    hasOnlyKeys(payload, ['taskId', 'transition', 'replacementTaskId']);
    const ownerId = actor && typeof actor.accountId === 'string' ? actor.accountId : '';
    if (ownerId.length === 0) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, '请先登录。');
    }
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      invalid('请求标识格式无效。');
    }
    const taskId = payload.taskId;
    if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)) {
      invalid('任务标识无效。');
    }
    const name = payload.transition;
    if (!TRANSITIONS.includes(name)) {
      invalid('任务操作无效。');
    }
    let replacementTaskId = payload.replacementTaskId;
    if (replacementTaskId === null) {
      replacementTaskId = undefined;
    }
    if (replacementTaskId !== undefined) {
      if (name !== 'replace') {
        invalid('只有替换操作可以指定替换目标。');
      }
      if (
        typeof replacementTaskId !== 'string' ||
        !TASK_ID_PATTERN.test(replacementTaskId) ||
        replacementTaskId === taskId
      ) {
        invalid('替换目标无效。');
      }
    }
    // The receipt digest covers the client payload only; the server date is not
    // part of it, so a retry after midnight still replays the original result.
    const digest = JSON.stringify([
      taskId,
      name,
      replacementTaskId === undefined ? null : replacementTaskId,
    ]);
    const at = readClock();
    const date = businessDate(at);
    const createdAt = at.toISOString();
    const action = 'tasks.transition';

    return store.withOwnerLock(ownerId, async () => {
      const receipt = await store.getReceipt({ ownerId, action, requestId });
      if (receipt) {
        if (receipt.digest !== digest) {
          conflict('同一请求不能改变任务操作。');
        }
        return { ...clone(receipt.result), replayed: true };
      }
      const templates = normalizeTemplates(await store.listTemplates());
      const template = templates.find((item) => item.taskId === taskId);
      if (!template) {
        invalid('任务模板不存在或已停用。');
      }
      const states = await store.getStatesForDate({ ownerId, date });
      const current = stateOf(states, taskId);
      const target = TARGET_STATE[name];
      if (current !== null && current === target) {
        // Same final state (including a terminal state) is a safe replay by a new
        // requestId; nothing is written to task_history again. A replayed replace
        // keeps the first response's shape: the replacement target is read back
        // from the day's stored rows instead of being invented, and is reported as
        // null when the day no longer identifies it unambiguously.
        const replayed = { taskId, date, state: current };
        if (name === 'replace') {
          const replacedBy = todaysReplacement(states, taskId);
          replayed.replacementTaskId = replacedBy;
          replayed.replacementState = replacedBy === null ? null : TASK_STATUS.SELECTED;
        }
        replayed.replayed = true;
        await store.commitTransition({
          ownerId,
          action,
          requestId,
          digest,
          result: replayed,
          entries: [],
        });
        return replayed;
      }
      if (current !== null && TERMINAL_STATES.includes(current)) {
        conflict('任务已结束，不能改投其他状态。');
      }
      // Remaining cases: no record (any transition) or selected (complete/skip/replace).
      const entries = [];
      let result;
      if (name === 'replace') {
        const replacement =
          replacementTaskId === undefined
            ? pickReplacement(templates, states, taskId)
            : checkReplacement(templates, states, replacementTaskId);
        entries.push({ taskId, date, state: TASK_STATUS.REPLACED, createdAt });
        entries.push({ taskId: replacement, date, state: TASK_STATUS.SELECTED, createdAt });
        result = {
          taskId,
          date,
          state: TASK_STATUS.REPLACED,
          replacementTaskId: replacement,
          replacementState: TASK_STATUS.SELECTED,
          replayed: false,
        };
      } else {
        entries.push({ taskId, date, state: target, createdAt });
        result = { taskId, date, state: target, replayed: false };
      }
      await store.commitTransition({ ownerId, action, requestId, digest, result, entries });
      return result;
    });
  }

  // A replayed replace starts under a new requestId, so it has no stored result of
  // its own. The replacement target is therefore read back from the day's rows: the
  // single task still in "selected" state. Two selected rows (or none) do not
  // identify the original target, and null is reported rather than a guess.
  function todaysReplacement(states, taskId) {
    const selected = Object.keys(states).filter(
      (id) => id !== taskId && states[id] === TASK_STATUS.SELECTED,
    );
    return selected.length === 1 ? selected[0] : null;
  }

  function pickReplacement(templates, states, taskId) {
    const candidate = templates.find(
      (item) => item.taskId !== taskId && stateOf(states, item.taskId) === null,
    );
    if (!candidate) {
      conflict('暂无可替换的任务。');
    }
    return candidate.taskId;
  }

  function checkReplacement(templates, states, replacementTaskId) {
    const candidate = templates.find((item) => item.taskId === replacementTaskId);
    if (!candidate) {
      invalid('替换目标模板不存在或已停用。');
    }
    if (stateOf(states, replacementTaskId) !== null) {
      conflict('替换目标今天已有记录。');
    }
    return replacementTaskId;
  }

  async function history({ payload, actor }) {
    hasOnlyKeys(payload, ['from', 'to', 'cursor', 'limit']);
    const ownerId = actor && typeof actor.accountId === 'string' ? actor.accountId : '';
    if (ownerId.length === 0) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, '请先登录。');
    }
    const from = payload.from;
    const to = payload.to;
    if (!isBusinessDate(from) || !isBusinessDate(to)) {
      invalid('日期必须为真实的YYYY-MM-DD日期。');
    }
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (span < 1) {
      invalid('开始日期不能晚于结束日期。');
    }
    if (span > HISTORY_MAX_RANGE_DAYS) {
      invalid('查询区间不能超过90天。');
    }
    const limit = payload.limit === undefined ? HISTORY_DEFAULT_LIMIT : payload.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
      invalid('每页条数必须为1到50的整数。');
    }
    const after = decodeCursor(payload.cursor);
    const page = await store.listHistory({ ownerId, from, to, limit, after });
    const rows = Array.isArray(page.rows) ? page.rows : [];
    const last = rows[rows.length - 1];
    return {
      entries: rows.map((row) => ({
        taskId: row.taskId,
        date: row.date,
        state: row.state,
        createdAt: row.createdAt,
      })),
      nextCursor: page.hasMore && last ? encodeCursor(last) : null,
    };
  }

  async function handle(request) {
    const action = request && request.action;
    const payload = request && request.payload !== undefined ? request.payload : {};
    switch (action) {
      case 'tasks.suggestions':
        return suggestions(payload);
      case 'tasks.quickChoice':
        return quickChoice(payload);
      case 'tasks.transition':
        return transition({ payload, actor: request.actor, requestId: request.requestId });
      case 'tasks.history':
        return history({ payload, actor: request.actor });
      default:
        return notImplemented();
    }
  }

  return { handle };
}

module.exports = { handle, createTasksDomain };
