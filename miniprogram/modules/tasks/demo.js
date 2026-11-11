const { LIMITS, TASK_STATUS } = require('../../shared/constants');
const { businessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const { activityDestination } = require('./destination');
const { DEFAULT_TASKS } = require('../../shared/task-catalogue');

// This fixture is deliberately separate from modules/tasks/service.js. It is a
// memory-only UI demo: it never calls the cloud function and never represents a
// trusted account or a successful cloud write.
const SUGGESTIONS = DEFAULT_TASKS.map((task, index) => ({
  id: 'task_demo_00' + (index + 1),
  title: task.title,
  description: task.steps.join('\n'),
  durationMin: task.durationMin,
  tags: task.tags,
}));

const STATE_LABELS = Object.freeze({
  available: '可以选择',
  [TASK_STATUS.SELECTED]: '已选择',
  [TASK_STATUS.COMPLETED]: '已完成',
  [TASK_STATUS.SKIPPED]: '已跳过',
  [TASK_STATUS.REPLACED]: '已替换',
});

const ACTION_TO_STATE = Object.freeze({
  select: TASK_STATUS.SELECTED,
  complete: TASK_STATUS.COMPLETED,
  replace: TASK_STATUS.REPLACED,
  skip: TASK_STATUS.SKIPPED,
});

const VALID_ACTIONS = Object.freeze(Object.keys(ACTION_TO_STATE));
const clone = (value) => JSON.parse(JSON.stringify(value));

function assertTaskId(taskId) {
  if (!SUGGESTIONS.some((task) => task.id === taskId)) {
    throw new AppError('INVALID_INPUT', '合成任务不存在。');
  }
}

function createSeedHistory(now) {
  const first = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const second = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  return [
    {
      id: 'task_demo_history_001',
      taskId: 'task_demo_004',
      title: '把今天的一件小事写在便签上',
      date: businessDate(first),
      state: TASK_STATUS.COMPLETED,
      stateLabel: STATE_LABELS[TASK_STATUS.COMPLETED],
      createdAt: first.toISOString(),
    },
    {
      id: 'task_demo_history_002',
      taskId: 'task_demo_005',
      title: '去熟悉的地方走一小圈',
      date: businessDate(second),
      state: TASK_STATUS.SKIPPED,
      stateLabel: STATE_LABELS[TASK_STATUS.SKIPPED],
      createdAt: second.toISOString(),
    },
  ];
}

function createTaskDemoService({
  authenticated = false,
  seedHistory = true,
  now = () => new Date(),
} = {}) {
  let isAuthenticated = authenticated === true;
  let serial = 0;
  let currentSelection = '';
  const states = new Map();
  const receipts = new Map();
  const history = seedHistory ? createSeedHistory(now()) : [];

  function requireAuthentication() {
    if (!isAuthenticated) {
      throw new AppError('UNAUTHENTICATED', '游客可以浏览任务建议，登录后才能写入任务状态。');
    }
  }

  function taskState(taskId) {
    return states.get(taskId) || '';
  }

  function decorateTask(task, exposePrivateState = isAuthenticated) {
    const state = exposePrivateState ? taskState(task.id) : '';
    return {
      ...clone(task),
      tagText: task.tags.join(' · '),
      destination: activityDestination(task.tags),
      state: state || 'available',
      stateLabel: STATE_LABELS[state || 'available'],
      canSelect: !state || state === TASK_STATUS.REPLACED || state === TASK_STATUS.SKIPPED,
      canComplete: state === TASK_STATUS.SELECTED,
      canReplace: state === TASK_STATUS.SELECTED,
      canSkip: state === TASK_STATUS.SELECTED,
      selected: state === TASK_STATUS.SELECTED,
    };
  }

  function suggestions() {
    // Keep this limit coupled to the shared F17 contract.
    return SUGGESTIONS.slice(0, LIMITS.taskSuggestions).map((task) => decorateTask(task));
  }

  function getHistory() {
    requireAuthentication();
    return clone(history).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  function transition(input = {}) {
    requireAuthentication();
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['taskId', 'action', 'requestId'].includes(key))
    ) {
      throw new AppError('INVALID_INPUT', '任务输入不符合约定。');
    }
    const { taskId, action, requestId } = input;
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId))
    ) {
      throw new AppError('INVALID_INPUT', '请求编号无效。');
    }
    const stableInput = { taskId, action, requestId };
    assertTaskId(taskId);
    if (!VALID_ACTIONS.includes(action)) {
      throw new AppError('INVALID_INPUT', '任务操作无效。');
    }
    const before = taskState(taskId);
    // Only an explicit request ID replays a receipt. Implicit UI actions use
    // the current state so repeated selection/replacement cycles stay usable.
    const key = requestId;
    const previous = key ? receipts.get(key) : null;
    if (previous) {
      if (JSON.stringify(previous.input) !== JSON.stringify(stableInput)) {
        throw new AppError('CONFLICT', '同一请求不能修改任务操作。');
      }
      const replay = clone(previous.result);
      replay.idempotent = true;
      return replay;
    }

    const target = ACTION_TO_STATE[action];
    if (before === target) {
      const result = { taskId, action, state: before, idempotent: true };
      if (key) {
        receipts.set(key, { input: clone(stableInput), result });
      }
      return clone(result);
    }
    if (action === 'select' && before === TASK_STATUS.COMPLETED) {
      throw new AppError('INVALID_INPUT', '已完成的合成任务不能再次选择。');
    }
    if (action !== 'select' && before !== TASK_STATUS.SELECTED) {
      throw new AppError('INVALID_INPUT', '请先选择任务，再进行此操作。');
    }

    const timestamp = now();
    const entry = {
      id: 'task_demo_event_' + ++serial,
      taskId,
      date: businessDate(timestamp),
      state: target,
      stateLabel: STATE_LABELS[target],
      title: SUGGESTIONS.find((task) => task.id === taskId).title,
      createdAt: timestamp.toISOString(),
    };
    states.set(taskId, target);
    if (target === TASK_STATUS.SELECTED) {
      currentSelection = taskId;
    } else if (currentSelection === taskId) {
      currentSelection = '';
    }
    history.unshift(entry);
    const result = { taskId, action, state: target, entry, idempotent: false };
    if (key) {
      receipts.set(key, { input: clone(stableInput), result });
    }
    return clone(result);
  }

  function setAuthenticated(value) {
    isAuthenticated = value === true;
    return isAuthenticated;
  }

  function snapshot() {
    return {
      isAuthenticated,
      currentSelection: isAuthenticated ? currentSelection : '',
      suggestions: suggestions(),
      history: isAuthenticated ? getHistory() : [],
    };
  }

  function clear() {
    states.clear();
    receipts.clear();
    history.splice(0, history.length, ...createSeedHistory(now()));
    serial = 0;
    currentSelection = '';
    isAuthenticated = false;
  }

  return {
    suggestions,
    getHistory,
    transition,
    setAuthenticated,
    isAuthenticated: () => isAuthenticated,
    snapshot,
    clear,
  };
}

module.exports = { SUGGESTIONS, createTaskDemoService };
