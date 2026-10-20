const api = require('../../services/api');
const { validateRequest, validateJournalInput } = require('../../shared/validation');
const { isBusinessDate, canCreateEntry } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const clone = (value) => JSON.parse(JSON.stringify(value));

// Explicit memory-only UI fixture. This is not a trusted account or database adapter.
function createMemoryJournalService({ now = () => new Date(), seedEntries = [] } = {}) {
  const days = new Map();
  const replies = new Map();
  let serial = 0;
  let failure = '';
  for (const entry of seedEntries) {
    validateJournalInput({
      date: entry.date,
      weather: entry.weather,
      tags: entry.tags,
      text: entry.text,
      expectedVersion: entry.version,
    });
    if (!Number.isSafeInteger(entry.version) || entry.version <= 0 || days.has(entry.date)) {
      throw new AppError('INVALID_INPUT', '合成初始记录无效。');
    }
    days.set(entry.date, { version: entry.version, entry: clone(entry) });
  }
  const conflict = () => {
    throw new AppError('CONFLICT', '本地演示记录状态已变化。');
  };
  const result = (request, data) => ({
    apiVersion: '1',
    requestId: request.requestId,
    ok: true,
    data: clone(data),
  });
  function failNext(mode = 'after-save') {
    failure = mode;
  }
  async function submit(request) {
    validateRequest(request);
    if (!['journal.upsert', 'journal.delete'].includes(request.action)) {
      throw new AppError('INVALID_INPUT', '本地演示仅支持记录操作。');
    }
    const key = request.action + ':' + request.requestId;
    const previous = replies.get(key);
    const current = days.get(request.payload.date);
    if (previous) {
      if (JSON.stringify(previous.request.payload) !== JSON.stringify(request.payload)) {
        return conflict();
      }
      if (previous.kind === 'save') {
        if (
          !current ||
          !current.entry ||
          current.entry.id !== previous.id ||
          current.version !== previous.version
        ) {
          return conflict();
        }
        return result(request, { entry: current.entry });
      }
      return result(request, { date: request.payload.date, deleted: previous.deleted });
    }
    const fail = failure;
    failure = '';
    if (fail === 'before-save') {
      throw new AppError('NETWORK_ERROR', '合成连接失败。');
    }
    if (request.action === 'journal.upsert') {
      const input = validateJournalInput(request.payload);
      const active = current && current.entry;
      if (
        (input.expectedVersion === 0 && active) ||
        (input.expectedVersion > 0 && (!active || current.version !== input.expectedVersion))
      ) {
        return conflict();
      }
      if (!active && !canCreateEntry(input.date, now())) {
        throw new AppError('INVALID_INPUT', '已超出新建窗口。');
      }
      const version = (current ? current.version : 0) + 1;
      const timestamp = now().toISOString();
      const entry = {
        id: active ? active.id : 'demo_entry_' + ++serial,
        date: input.date,
        weather: input.weather,
        tags: input.tags,
        text: input.text,
        version,
        createdAt: active ? active.createdAt : timestamp,
        updatedAt: timestamp,
      };
      days.set(input.date, { version, entry });
      // Retain the caller's immutable synthetic request by reference, never persist it.
      replies.set(key, { request, kind: 'save', id: entry.id, version });
      if (fail === 'after-save') {
        throw new AppError('NETWORK_ERROR', '合成保存后响应丢失。');
      }
      return result(request, { entry });
    }
    const input = request.payload;
    if (
      Object.keys(input).some((name) => !['date', 'expectedVersion'].includes(name)) ||
      !isBusinessDate(input.date) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion <= 0
    ) {
      throw new AppError('INVALID_INPUT', '删除输入无效。');
    }
    const deleted = !!(current && current.entry);
    if (deleted && current.version !== input.expectedVersion) {
      return conflict();
    }
    if (deleted) {
      days.set(input.date, { version: current.version + 1, entry: null });
    }
    replies.set(key, { request, kind: 'delete', deleted });
    if (fail === 'after-save') {
      throw new AppError('NETWORK_ERROR', '合成删除后响应丢失。');
    }
    return result(request, { date: input.date, deleted });
  }
  async function get(date) {
    if (!isBusinessDate(date)) {
      throw new AppError('INVALID_INPUT', '日期无效。');
    }
    const request = api.createRequest('journal.get', { date });
    const value = days.get(date);
    return result(request, { entry: value && value.entry ? value.entry : null });
  }
  function clear() {
    days.clear();
    replies.clear();
    failure = '';
  }
  return {
    createSaveRequest: (input) => api.createRequest('journal.upsert', input),
    createDeleteRequest: (input) => api.createRequest('journal.delete', input),
    submit,
    get,
    failNext,
    clear,
  };
}
module.exports = { createMemoryJournalService };
