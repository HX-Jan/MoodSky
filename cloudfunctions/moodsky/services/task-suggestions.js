const { LIMITS } = require('../shared/constants');
const { AppError, notImplemented } = require('../shared/result');

// Read-only candidate. Bounds are local adapter constraints, not an approved
// replacement for JF02 or the task_templates dictionary. Never fill missing data.
const text = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= max;
function publicTask(row) {
  if (
    !row ||
    row.enabled !== true ||
    typeof row._id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(row._id) ||
    !text(row.title, 120) ||
    !Array.isArray(row.steps) ||
    row.steps.length < 1 ||
    row.steps.length > 10 ||
    !row.steps.every((step) => text(step, 500)) ||
    !Number.isSafeInteger(row.durationMin) ||
    row.durationMin < 1 ||
    row.durationMin > 1440 ||
    (row.tags !== undefined &&
      (!Array.isArray(row.tags) ||
        row.tags.length > 8 ||
        new Set(row.tags).size !== row.tags.length ||
        !row.tags.every((tag) => text(tag, 32))))
  ) {
    throw new Error('Task catalogue is incompatible with the read candidate');
  }
  // An explicit projection prevents storage metadata/private state from becoming
  // public. No account lookup, journal read, task history or display tracking.
  return {
    taskId: row._id,
    title: row.title,
    description: row.steps.join('\n'),
    durationMin: row.durationMin,
    tags: row.tags ? [...row.tags] : [],
    state: null,
  };
}
function createTaskSuggestionsService({ repository } = {}) {
  if (!repository || typeof repository.listEnabled !== 'function') {
    throw new TypeError('A server-owned task catalogue repository is required');
  }
  return async ({ action, payload }) => {
    if (!['tasks.suggestions', 'tasks.quickChoice'].includes(action)) {
      return notImplemented();
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 0
    ) {
      throw new AppError('INVALID_INPUT', '任务建议暂不接受筛选或私人内容。');
    }
    if (action === 'tasks.quickChoice') {
      // This entry opens the public list, including its valid empty state. It
      // does not promise selection/writes or enable an unimplemented place API.
      return {
        entries: [{ kind: 'tasks', label: '浏览小任务', enabled: true }],
        notice: '无需保存日记即可浏览任务；任务操作仍待接入。',
      };
    }
    const rows = await repository.listEnabled({ limit: LIMITS.taskSuggestions });
    if (
      !Array.isArray(rows) ||
      rows.length > LIMITS.taskSuggestions ||
      new Set(rows.map((row) => row && row._id)).size !== rows.length
    ) {
      throw new Error('Invalid bounded task catalogue result');
    }
    return {
      items: rows.map(publicTask),
      readOnly: true,
      notice: '小任务由你自愿选择，不做打卡惩罚。',
    };
  };
}
module.exports = { createTaskSuggestionsService };
