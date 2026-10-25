// Explicit server candidate, not imported by the deployed foundation entry.
const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { TASK_STATUS } = require('../shared/constants');
const { isBusinessDate } = require('../shared/date');
const { createAccountTransactions } = require('./account-transaction');
const TASK_LAYOUT = 'deterministic-tasks-v1';
const key = (prefix, values) =>
  prefix + createHash('sha256').update(JSON.stringify(values)).digest('hex');
const historyId = (ownerId, taskId, date) => key('task_', [ownerId, taskId, date]);
const receiptId = (ownerId, action, requestId) =>
  key('task_receipt_', [ownerId, action, requestId]);
const conflict = () => {
  throw new AppError('CONFLICT', '任务数据布局或状态不一致，尚未修改。');
};
const rowsOf = (result) => {
  if (!result || !Array.isArray(result.data)) {
    throw new Error('Invalid task store response');
  }
  return result.data;
};
function checkHistory(row, ownerId) {
  if (
    !row ||
    row.ownerId !== ownerId ||
    row.layout !== TASK_LAYOUT ||
    typeof row.taskId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(row.taskId) ||
    !isBusinessDate(row.date) ||
    row._id !== historyId(ownerId, row.taskId, row.date) ||
    !Object.values(TASK_STATUS).includes(row.state) ||
    typeof row.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(row.createdAt))
  ) {
    conflict();
  }
  return row;
}
function checkReceiptResult(row) {
  let input;
  try {
    input = JSON.parse(row.digest);
  } catch {
    conflict();
  }
  const targets = {
    select: 'selected',
    complete: 'completed',
    skip: 'skipped',
    replace: 'replaced',
  };
  const result = row.result;
  if (
    !Array.isArray(input) ||
    input.length !== 3 ||
    typeof input[0] !== 'string' ||
    !Object.hasOwn(targets, input[1]) ||
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    result.taskId !== input[0] ||
    result.state !== targets[input[1]] ||
    !isBusinessDate(result.date) ||
    typeof result.replayed !== 'boolean' ||
    Object.keys(result).some(
      (field) =>
        !['taskId', 'date', 'state', 'replayed', 'replacementTaskId', 'replacementState'].includes(
          field,
        ),
    )
  ) {
    conflict();
  }
  if (
    input[1] === 'replace' &&
    !(
      (result.replacementTaskId === null && result.replacementState === null) ||
      (typeof result.replacementTaskId === 'string' &&
        /^[A-Za-z0-9_-]{1,64}$/.test(result.replacementTaskId) &&
        result.replacementTaskId !== result.taskId &&
        result.replacementState === 'selected')
    )
  ) {
    conflict();
  }
}
function createTransactionalTasksStore({ db } = {}) {
  const accounts = createAccountTransactions(db, { taskLayoutRequired: true });
  return {
    withOwnerLock: accounts.withOwner,
    async listTemplates() {
      const rows = rowsOf(
        await db
          .collection('task_templates')
          .where({ enabled: true })
          .orderBy('_id', 'asc')
          .limit(51)
          .get(),
      );
      if (rows.length > 50) {
        conflict();
      }
      return rows;
    },
    async getStatesForDate({ ownerId, date }) {
      accounts.transaction(ownerId);
      // Transactions support doc operations only. Bounded scans use the ordinary
      // DB; committing the shared account fence detects participating writers
      // after the snapshot. All task/journal writers must honor this fence.
      const rows = rowsOf(
        await db.collection('task_history').where({ ownerId, date }).limit(201).get(),
      );
      if (rows.length > 200) {
        conflict();
      }
      const states = Object.create(null);
      for (const row of rows) {
        checkHistory(row, ownerId);
        if (row.date !== date || Object.hasOwn(states, row.taskId)) {
          conflict();
        }
        states[row.taskId] = row.state;
      }
      return states;
    },
    listHistory({ ownerId, from, to, limit, after = null }) {
      return accounts.withOwner(ownerId, async () => {
        const command = db.command;
        const range = { ownerId, date: command.gte(from).and(command.lte(to)) };
        const filter = after
          ? command.and([
              range,
              command.or([
                { createdAt: command.lt(after.c) },
                { createdAt: after.c, _id: command.lt(after.i) },
              ]),
            ])
          : range;
        const rows = rowsOf(
          await db
            .collection('task_history')
            .where(filter)
            .orderBy('createdAt', 'desc')
            .orderBy('_id', 'desc')
            .limit(limit + 1)
            .get(),
        );
        rows.forEach((row) => checkHistory(row, ownerId));
        return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
      });
    },
    async getReceipt({ ownerId, action, requestId }) {
      const id = receiptId(ownerId, action, requestId);
      const row = (await accounts.transaction(ownerId).collection('request_receipts').doc(id).get())
        .data;
      if (
        row &&
        (row._id !== id ||
          row.ownerId !== ownerId ||
          row.action !== action ||
          row.requestId !== requestId ||
          row.layout !== TASK_LAYOUT ||
          typeof row.digest !== 'string' ||
          !row.result)
      ) {
        conflict();
      }
      if (row) {
        checkReceiptResult(row);
      }
      return row;
    },
    async commitTransition({ ownerId, action, requestId, digest, result, entries = [] }) {
      const tx = accounts.transaction(ownerId);
      const ref = tx.collection('request_receipts').doc(receiptId(ownerId, action, requestId));
      if ((await ref.get()).data) {
        conflict();
      }
      for (const entry of entries) {
        const id = historyId(ownerId, entry.taskId, entry.date);
        const history = tx.collection('task_history').doc(id);
        const previous = (await history.get()).data;
        if (previous) {
          checkHistory(previous, ownerId);
        }
        const data = {
          layout: TASK_LAYOUT,
          ownerId,
          taskId: entry.taskId,
          date: entry.date,
          state: entry.state,
          createdAt: previous ? previous.createdAt : entry.createdAt,
        };
        checkHistory({ _id: id, ...data }, ownerId);
        await history.set({ data });
      }
      await ref.set({ data: { layout: TASK_LAYOUT, ownerId, action, requestId, digest, result } });
      if (entries.length) {
        accounts.changed(ownerId);
      }
    },
  };
}
module.exports = { createTransactionalTasksStore, TASK_LAYOUT, historyId, receiptId };
