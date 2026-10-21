// 回顾演示数据源（W1 Z05 刷新事件的基础）。内存单例：Today 页保存/编辑/删除成功后，
// 由页面把该日最新记录同步进来并发布“回顾失效事件”；月历、月份档案与时间线页面订阅后刷新。
// 这是对真实架构（journal 写入 → review 视图失效 → 重新查询）的本地演示替身，不含任何云端调用。
const { SEED_ENTRIES } = require('./demo-data');
const { readEntry } = require('../journal/controller');
const { isBusinessDate } = require('../../shared/date');

const clone = (value) => JSON.parse(JSON.stringify(value));

// 合成初始修订号：仅用于演示比对来源新旧，不是授权凭证，也不是记录版本（见 w1-h04 第 2 节约定）。
const INITIAL_REVISION = 6;
function checkedEntry(value, date) {
  const entry = readEntry({ ok: true, data: { entry: clone(value) } }, date);
  if (!entry) {
    throw new Error('合成回顾数据无效。');
  }
  return entry;
}

function createLocalStore(entries = [], initialRevision = INITIAL_REVISION) {
  const state = {
    entries: new Map(),
    revision: initialRevision,
    listeners: new Set(),
    generation: 0,
    pending: new Map(),
  };
  const ids = new Set();
  for (const entry of entries) {
    let checked;
    try {
      checked = checkedEntry(entry, entry && entry.date);
    } catch (_error) {
      throw new Error('合成回顾数据无效。');
    }
    if (state.entries.has(checked.date) || ids.has(checked.id)) {
      throw new Error('合成回顾数据无效。');
    }
    ids.add(checked.id);
    state.entries.set(checked.date, checked);
  }
  function subscribe(listener) {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }
  function publish() {
    state.revision += 1;
    for (const listener of [...state.listeners]) {
      try {
        listener({ sourceRevision: state.revision });
      } catch (_error) {
        // 单个订阅者的异常不阻断其他页面刷新。
      }
    }
  }
  return {
    getEntry(date) {
      const entry = state.entries.get(date);
      return entry ? clone(entry) : null;
    },
    listMonth(month) {
      return [...state.entries.values()]
        .filter((entry) => entry.date.slice(0, 7) === month)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map(clone);
    },
    listAll() {
      return [...state.entries.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(clone);
    },
    revision() {
      return state.revision;
    },
    // 清空全部演示记录（含合成种子）：与 Today 页“清空演示数据”按钮配对，
    // 保证 journal 演示单例与回顾演示数据源同时回到空白状态。重新编译可恢复种子。
    clearAll() {
      state.generation += 1;
      state.pending.clear();
      state.entries.clear();
      publish();
    },
    // A confirmed notification invalidates a view; the latest read determines
    // whether the day now exists. Clearing or a newer read invalidates this one.
    async syncFromJournal(service, change) {
      if (
        !service ||
        typeof service.get !== 'function' ||
        !change ||
        !isBusinessDate(change.date) ||
        !['saved', 'deleted'].includes(change.kind)
      ) {
        return false;
      }
      const generation = state.generation;
      const token = {};
      state.pending.set(change.date, token);
      try {
        const result = await service.get(change.date);
        if (generation !== state.generation || state.pending.get(change.date) !== token) {
          return false;
        }
        const entry = readEntry(result, change.date);
        return this.applyChange({ date: change.date, kind: entry ? 'saved' : 'deleted', entry });
      } finally {
        if (state.pending.get(change.date) === token) {
          state.pending.delete(change.date);
        }
      }
    },
    // Only confirmed absence may directly delete. Bare invalidations must use syncFromJournal.
    applyChange(change) {
      if (!change || !isBusinessDate(change.date) || !['saved', 'deleted'].includes(change.kind)) {
        return false;
      }
      if (change.kind === 'saved') {
        let checked;
        try {
          checked = checkedEntry(change.entry, change.date);
        } catch (_error) {
          return false;
        }
        if (
          [...state.entries.values()].some(
            (entry) => entry.id === checked.id && entry.date !== checked.date,
          )
        ) {
          return false;
        }
        state.pending.delete(change.date);
        state.entries.set(change.date, checked);
        publish();
        return true;
      }
      if (change.kind === 'deleted') {
        // Even an already-empty date invalidates an older in-flight read of its removed row.
        state.pending.delete(change.date);
        if (state.entries.delete(change.date)) {
          publish();
          return true;
        }
        return false;
      }
      return false;
    },
    subscribe,
  };
}

// 页面共用的演示单例：与 Today 页的内存记录演示保持同一份种子数据，并通过失效事件保持同步。
const reviewStore = createLocalStore(SEED_ENTRIES);

module.exports = { createLocalStore, reviewStore, INITIAL_REVISION };
