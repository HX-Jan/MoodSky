const api = require('../../services/api');
const { validateRequest, validateJournalInput } = require('../../shared/validation');
const { isBusinessDate, canCreateEntry } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const { readEntry } = require('./controller');
const { weatherFields } = require('../../shared/weather');
const clone = (value) => JSON.parse(JSON.stringify(value));

// Explicit memory-only UI fixture. This is not a trusted account or database adapter.
function createMemoryJournalService({ now = () => new Date(), seedEntries = [] } = {}) {
  const days = new Map();
  const replies = new Map();
  const seedIds = new Set();
  let serial = 0;
  let failure = '';
  for (const entry of seedEntries) {
    let checked;
    try {
      const source = clone(entry);
      checked = readEntry({ ok: true, data: { entry: source } }, source && source.date);
    } catch (_error) {
      throw new AppError('INVALID_INPUT', '合成初始记录无效。');
    }
    if (!checked || days.has(checked.date) || seedIds.has(checked.id)) {
      throw new AppError('INVALID_INPUT', '合成初始记录无效。');
    }
    seedIds.add(checked.id);
    days.set(checked.date, { version: checked.version, entry: checked });
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
    const saving = request.action === 'journal.upsert';
    const input = saving ? validateJournalInput(request.payload) : request.payload;
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      (saving
        ? input.tags.some((tag) => typeof tag !== 'string')
        : Object.keys(input).some((name) => !['date', 'expectedVersion'].includes(name)) ||
          !isBusinessDate(input.date) ||
          input.expectedVersion <= 0) ||
      Object.values(request.payload).some((value) => value === undefined)
    ) {
      throw new AppError('INVALID_INPUT', '本地演示记录输入无效。');
    }
    // Memory-only exact input snapshot, NOT a server HMAC or an authorization credential.
    const binding = JSON.stringify(
      Object.keys(request.payload)
        .sort()
        .map((name) => [name, request.payload[name]]),
    );
    const key = request.action + ':' + request.requestId;
    const previous = replies.get(key);
    const current = days.get(request.payload.date);
    if (previous) {
      if (previous.binding !== binding) {
        return conflict();
      }
      if (previous.kind === 'rejected') {
        throw new AppError(previous.code, '本地演示原请求已拒绝，请重新读取后操作。');
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
      if ((current ? current.version : 0) !== previous.version || (current && current.entry)) {
        return conflict();
      }
      return result(request, { date: request.payload.date, deleted: previous.deleted });
    }
    const fail = failure;
    failure = '';
    if (fail === 'before-save') {
      throw new AppError('NETWORK_ERROR', '合成连接失败。');
    }
    const reject = (code) => {
      replies.set(key, { binding, kind: 'rejected', code });
      throw new AppError(code, '本地演示请求未执行，请检查日期或重新读取。');
    };
    const generation = current ? current.version : 0;
    if (saving) {
      const active = current && current.entry;
      if (
        (input.expectedVersion === 0 && active) ||
        (input.expectedVersion > 0 && (!active || current.version !== input.expectedVersion))
      ) {
        return reject('CONFLICT');
      }
      const instant = now();
      if (!active && !canCreateEntry(input.date, instant)) {
        return reject('INVALID_INPUT');
      }
      if (generation === Number.MAX_SAFE_INTEGER) {
        return reject('CONFLICT');
      }
      const version = generation + 1;
      const timestamp = instant.toISOString();
      let id = active ? active.id : '';
      if (!active) {
        do {
          if (serial === Number.MAX_SAFE_INTEGER) {
            return reject('CONFLICT');
          }
          id = 'demo_entry_' + ++serial;
        } while (seedIds.has(id));
        // The counter survives clear(): only seed collisions need retained IDs.
      }
      const entry = {
        id,
        date: input.date,
        ...weatherFields(input),
        tags: input.tags,
        text: input.text,
        version,
        createdAt: active ? active.createdAt : timestamp,
        updatedAt: timestamp,
      };
      days.set(input.date, { version, entry });
      replies.set(key, { binding, kind: 'save', id: entry.id, version });
      if (fail === 'after-save') {
        throw new AppError('NETWORK_ERROR', '合成保存后响应丢失。');
      }
      return result(request, { entry });
    }
    const deleted = !!(current && current.entry);
    if (
      deleted &&
      (current.version !== input.expectedVersion || generation === Number.MAX_SAFE_INTEGER)
    ) {
      return reject('CONFLICT');
    }
    const version = generation + (deleted ? 1 : 0);
    if (deleted) {
      days.set(input.date, { version, entry: null });
    }
    replies.set(key, { binding, kind: 'delete', deleted, version });
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
