// W2 JF02 — task data access for task_templates / task_history / request_receipts.
// Owner: Jiawei Fang. The in-memory store is the only implementation exercised by
// tests. createCloudTasksStore is a production draft and has NOT been verified
// against a real cloud database (no cloud authorization in week 2).
//
// task_history semantics: one row per ownerId + taskId + date (state snapshot for
// that day). A later transition the same day updates the state and keeps the
// original createdAt so history pagination stays stable. Keeping exactly one row
// per key is still only a business rule here: database/collections.json declares
// uniqueKeys: [] for task_history, so concurrent transitions can produce two rows
// until Xiang Yu decides on the proposed unique key (W1 JF02 §2.1 option A).
const TEMPLATE_COLLECTION = 'task_templates';
const HISTORY_COLLECTION = 'task_history';
const RECEIPT_COLLECTION = 'request_receipts';
const TEMPLATE_LIMIT = 50;
const HISTORY_SCAN_LIMIT = 200;

const clone = (value) => JSON.parse(JSON.stringify(value));
const receiptKey = ({ ownerId, action, requestId }) =>
  ownerId + '\u0000' + action + '\u0000' + requestId;

function compareNewestFirst(left, right) {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1;
  }
  if (left._id === right._id) {
    return 0;
  }
  return left._id < right._id ? 1 : -1;
}

function isAfterCursor(row, cursor) {
  if (row.createdAt !== cursor.c) {
    return row.createdAt < cursor.c;
  }
  return row._id < cursor.i;
}

// Serialises transitions for one owner. Two awaited store calls can interleave in
// Node, so "read the current state, then write" needs a queue per owner. This is
// a single-process guarantee only; the cloud store below has no distributed lock.
function createOwnerLocks() {
  const tails = new Map();
  return function withOwnerLock(ownerId, task) {
    const previous = tails.get(ownerId) || Promise.resolve();
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    tails.set(ownerId, tail);
    return (async () => {
      await previous;
      try {
        return await task();
      } finally {
        release();
        if (tails.get(ownerId) === tail) {
          tails.delete(ownerId);
        }
      }
    })();
  };
}

function createMemoryTasksStore({ templates = [], history = [], receipts = [] } = {}) {
  const templateRows = templates.map((row) => clone(row));
  const historyRows = [];
  const receiptRows = new Map();
  let serial = 0;
  const nextId = (prefix) => {
    serial += 1;
    return prefix + '_' + String(serial).padStart(4, '0');
  };
  const withOwnerLock = createOwnerLocks();

  for (const row of history) {
    historyRows.push({
      _id: typeof row._id === 'string' ? row._id : nextId('hist'),
      ownerId: row.ownerId,
      taskId: row.taskId,
      date: row.date,
      state: row.state,
      createdAt: row.createdAt,
    });
  }
  for (const row of receipts) {
    receiptRows.set(receiptKey(row), clone(row));
  }

  async function listTemplates() {
    return templateRows.map((row) => clone(row));
  }

  async function getStatesForDate({ ownerId, date }) {
    const latest = new Map();
    for (const row of historyRows) {
      if (row.ownerId !== ownerId || row.date !== date) {
        continue;
      }
      const seen = latest.get(row.taskId);
      if (!seen || compareNewestFirst(seen, row) > 0) {
        latest.set(row.taskId, row);
      }
    }
    const states = {};
    for (const [taskId, row] of latest) {
      states[taskId] = row.state;
    }
    return states;
  }

  async function listHistory({ ownerId, from, to, limit, after = null }) {
    const scoped = historyRows
      .filter((row) => row.ownerId === ownerId && row.date >= from && row.date <= to)
      .sort(compareNewestFirst);
    const remaining = after ? scoped.filter((row) => isAfterCursor(row, after)) : scoped;
    return {
      rows: remaining.slice(0, limit).map((row) => clone(row)),
      hasMore: remaining.length > limit,
    };
  }

  async function getReceipt({ ownerId, action, requestId }) {
    const row = receiptRows.get(receiptKey({ ownerId, action, requestId }));
    return row ? clone(row) : null;
  }

  // Called inside withOwnerLock. In memory the receipt and the history rows are
  // written in one synchronous section, so there is no partial-write window.
  async function commitTransition({ ownerId, action, requestId, digest, result, entries = [] }) {
    const key = receiptKey({ ownerId, action, requestId });
    if (receiptRows.has(key)) {
      throw new Error('duplicate request receipt');
    }
    receiptRows.set(key, {
      ownerId,
      action,
      requestId,
      digest,
      result: clone(result),
    });
    for (const entry of entries) {
      const existing = historyRows.find(
        (row) => row.ownerId === ownerId && row.taskId === entry.taskId && row.date === entry.date,
      );
      if (existing) {
        existing.state = entry.state;
        continue;
      }
      historyRows.push({
        _id: nextId('hist'),
        ownerId,
        taskId: entry.taskId,
        date: entry.date,
        state: entry.state,
        createdAt: entry.createdAt,
      });
    }
  }

  function snapshot() {
    return {
      history: clone(historyRows),
      receipts: Array.from(receiptRows.values(), (row) => clone(row)),
    };
  }

  return {
    withOwnerLock,
    listTemplates,
    getStatesForDate,
    listHistory,
    getReceipt,
    commitTransition,
    snapshot,
  };
}

// Production draft — NOT verified against a real cloud database.
//
// Atomicity: there is no transaction, so a transition is committed as
//   1) insert the receipt (unique ownerId + action + requestId), then
//   2) upsert each history row.
// This is option C from docs/week1/Jiawei_Fang/w1-jf02-task-contract.md §2.1.
// Remaining windows, to be closed by the option A unique key plus a transaction:
//   - crash between 1 and 2: a retry with the same requestId replays the stored
//     receipt and never writes the missing history row;
//   - two concurrent transitions with different requestIds can both read "no
//     record" and insert two rows because task_history has no unique key yet.
function createCloudTasksStore({ db }) {
  if (!db || typeof db.collection !== 'function') {
    throw new TypeError('createCloudTasksStore requires an initialised database instance.');
  }
  const command = db.command;
  const rowsOf = (result) => (result && Array.isArray(result.data) ? result.data : []);

  return {
    // No distributed lock is available; callers still need the database-level
    // unique key and transaction described above.
    async withOwnerLock(_ownerId, task) {
      return task();
    },

    async listTemplates() {
      const result = await db.collection(TEMPLATE_COLLECTION).limit(TEMPLATE_LIMIT).get();
      return rowsOf(result);
    },

    async getStatesForDate({ ownerId, date }) {
      const result = await db
        .collection(HISTORY_COLLECTION)
        .where({ ownerId, date })
        .limit(HISTORY_SCAN_LIMIT)
        .get();
      const latest = {};
      for (const row of rowsOf(result)) {
        const seen = latest[row.taskId];
        if (!seen || compareNewestFirst(seen, row) > 0) {
          latest[row.taskId] = row;
        }
      }
      const states = {};
      for (const [taskId, row] of Object.entries(latest)) {
        states[taskId] = row.state;
      }
      return states;
    },

    async listHistory({ ownerId, from, to, limit, after = null }) {
      const range = { ownerId, date: command.gte(from).and(command.lte(to)) };
      let filter = range;
      if (after) {
        filter = command.and([
          range,
          command.or([
            { createdAt: command.lt(after.c) },
            { createdAt: after.c, _id: command.lt(after.i) },
          ]),
        ]);
      }
      const result = await db
        .collection(HISTORY_COLLECTION)
        .where(filter)
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .limit(limit + 1)
        .get();
      const rows = rowsOf(result);
      return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
    },

    async getReceipt({ ownerId, action, requestId }) {
      const result = await db
        .collection(RECEIPT_COLLECTION)
        .where({ ownerId, action, requestId })
        .limit(1)
        .get();
      return rowsOf(result)[0] || null;
    },

    async commitTransition({ ownerId, action, requestId, digest, result, entries = [] }) {
      await db.collection(RECEIPT_COLLECTION).add({
        data: {
          ownerId,
          action,
          requestId,
          digest,
          result,
          createdAt: new Date().toISOString(),
        },
      });
      for (const entry of entries) {
        const query = await db
          .collection(HISTORY_COLLECTION)
          .where({ ownerId, taskId: entry.taskId, date: entry.date })
          .limit(1)
          .get();
        const existing = rowsOf(query)[0];
        if (existing) {
          await db
            .collection(HISTORY_COLLECTION)
            .doc(existing._id)
            .update({ data: { state: entry.state } });
        } else {
          await db.collection(HISTORY_COLLECTION).add({
            data: {
              ownerId,
              taskId: entry.taskId,
              date: entry.date,
              state: entry.state,
              createdAt: entry.createdAt,
            },
          });
        }
      }
    },
  };
}

module.exports = { createMemoryTasksStore, createCloudTasksStore };
