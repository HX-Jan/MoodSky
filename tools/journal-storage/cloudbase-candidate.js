// REVIEW CANDIDATE ONLY. No production entry imports this module.
// Requires wx-server-sdk database({ throwOnNotFound: false }), not the raw Node SDK.
const { createHash } = require('node:crypto');
const { AppError } = require('../../cloudfunctions/moodsky/shared/result');
const { isBusinessDate } = require('../../cloudfunctions/moodsky/shared/date');
const { validateJournalInput } = require('../../cloudfunctions/moodsky/shared/validation');
const LAYOUT = 'deterministic-days-v1';
const DAY_MS = 86400000;
const idFor = (...parts) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const dayId = (ownerId, date) => idFor('journal-day', ownerId, date);
const receiptId = (ownerId, action, requestId) =>
  idFor('journal-receipt', ownerId, action, requestId);
const decorationId = (ownerId, month) => idFor('month-decoration', ownerId, month);
const corrupt = () => {
  throw new Error('Invalid journal storage candidate data');
};
function validVersion(value, min = 0) {
  return Number.isSafeInteger(value) && value >= min;
}
function canonicalInstant(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() === value;
}
function decodeDay(row, ownerId, date) {
  if (row === null) {
    return undefined;
  }
  if (
    !row ||
    row.layout !== LAYOUT ||
    row.ownerId !== ownerId ||
    row.date !== date ||
    !validVersion(row.version, 1) ||
    !['active', 'deleted'].includes(row.state)
  ) {
    return corrupt();
  }
  if (row.state === 'deleted') {
    if (
      ['text', 'tags', 'weather', 'entryId', 'createdAt', 'updatedAt'].some((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      )
    ) {
      return corrupt();
    }
    return { version: row.version, entry: null };
  }
  try {
    validateJournalInput({
      date,
      weather: row.weather,
      tags: row.tags,
      text: row.text,
      expectedVersion: row.version,
    });
  } catch (_error) {
    return corrupt();
  }
  if (
    typeof row.entryId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(row.entryId) ||
    !Array.isArray(row.tags) ||
    typeof row.text !== 'string' ||
    ![row.createdAt, row.updatedAt].every(canonicalInstant) ||
    Date.parse(row.updatedAt) < Date.parse(row.createdAt)
  ) {
    return corrupt();
  }
  return {
    version: row.version,
    entry: {
      id: row.entryId,
      date,
      weather: row.weather,
      tags: [...row.tags],
      text: row.text,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}
function snapshotDates(range) {
  if (!range || !isBusinessDate(range.startDate) || !isBusinessDate(range.endDate)) {
    return corrupt();
  }
  const first = Date.parse(range.startDate + 'T00:00:00.000Z');
  const last = Date.parse(range.endDate + 'T00:00:00.000Z');
  const length = (last - first) / DAY_MS + 1;
  if (length < 1 || length > 90) {
    return corrupt();
  }
  return Array.from({ length }, (_, index) =>
    new Date(first + index * DAY_MS).toISOString().slice(0, 10),
  );
}

function createCloudJournalRepository(db) {
  if (
    !db ||
    typeof db.runTransaction !== 'function' ||
    !db.config ||
    db.config.throwOnNotFound !== false
  ) {
    throw new TypeError('Candidate requires wx database({ throwOnNotFound: false }).');
  }
  async function inAccount(ownerId, work) {
    if (typeof ownerId !== 'string' || !ownerId) {
      throw new AppError('UNAUTHENTICATED', '请先登录。');
    }
    return db.runTransaction(async (transaction) => {
      const accountDoc = transaction.collection('accounts').doc(ownerId);
      const account = (await accountDoc.get()).data;
      if (!account) {
        throw new AppError('UNAUTHENTICATED', '账号尚未就绪。');
      }
      if (account._id !== ownerId) {
        return corrupt();
      }
      if (account.status !== 'active') {
        throw new AppError('ACCOUNT_DISABLED', '账号已停用。');
      }
      // Never silently interpret an unmigrated random-ID collection as an empty journal.
      if (account.journalLayout !== LAYOUT) {
        throw new AppError('NOT_IMPLEMENTED', '记录存储方案尚未启用。');
      }
      if (
        !validVersion(account.journalRevision) ||
        !validVersion(account.operationFence) ||
        !validVersion(account.exportEpoch)
      ) {
        return corrupt();
      }
      return work(
        transaction,
        accountDoc,
        account.journalRevision,
        account.operationFence,
        account.exportEpoch,
      );
    });
  }
  async function getDay(transaction, ownerId, date) {
    if (!isBusinessDate(date)) {
      return corrupt();
    }
    const row = (await transaction.collection('journals').doc(dayId(ownerId, date)).get()).data;
    return decodeDay(row, ownerId, date);
  }
  return {
    readDay: (ownerId, date) => inAccount(ownerId, (tx) => getDay(tx, ownerId, date)),
    transact(ownerId, work) {
      return inAccount(ownerId, async (transaction, accountDoc, revision, fence, exportEpoch) => {
        let advanced = false;
        let touched = false;
        let exportAdvanced = false;
        const tx = {
          getDay: (date) => getDay(transaction, ownerId, date),
          async setDay(date, day) {
            const base = { layout: LAYOUT, ownerId, date, version: day.version };
            const row = day.entry
              ? {
                  ...base,
                  state: 'active',
                  entryId: day.entry.id,
                  weather: day.entry.weather,
                  tags: [...day.entry.tags],
                  text: day.entry.text,
                  createdAt: day.entry.createdAt,
                  updatedAt: day.entry.updatedAt,
                }
              : { ...base, state: 'deleted' };
            decodeDay(row, ownerId, date);
            // set replaces the whole document; update would retain deleted private fields.
            await transaction.collection('journals').doc(dayId(ownerId, date)).set({ data: row });
          },
          async getReceipt(action, requestId) {
            const row = (
              await transaction
                .collection('request_receipts')
                .doc(receiptId(ownerId, action, requestId))
                .get()
            ).data;
            if (row === null) {
              return undefined;
            }
            if (
              row &&
              row.layout === LAYOUT &&
              row.ownerId === ownerId &&
              row.action === action &&
              row.requestId === requestId &&
              row.state === 'expired'
            ) {
              return { state: 'expired' };
            }
            if (
              !row ||
              row.layout !== LAYOUT ||
              row.ownerId !== ownerId ||
              row.action !== action ||
              row.requestId !== requestId ||
              typeof row.digest !== 'string' ||
              !/^[a-f0-9]{64}$/.test(row.digest) ||
              !validVersion(row.version) ||
              (row.state === 'rejected'
                ? !['journal.upsert', 'journal.delete', 'review.decorations'].includes(action) ||
                  !['CONFLICT', 'INVALID_INPUT'].includes(row.code) ||
                  (action === 'review.decorations'
                    ? typeof row.month !== 'string' ||
                      !/^\d{4}-\d{2}$/.test(row.month) ||
                      !isBusinessDate(row.month + '-01')
                    : Object.hasOwn(row, 'month')) ||
                  [
                    'entryId',
                    'deleted',
                    'text',
                    'tags',
                    'weather',
                    'payload',
                    'stickers',
                    'backgroundId',
                  ].some((key) => Object.hasOwn(row, key))
                : row.state !== undefined ||
                  (action === 'journal.upsert'
                    ? typeof row.entryId !== 'string' || !validVersion(row.version, 1)
                    : action === 'review.decorations'
                      ? typeof row.month !== 'string' ||
                        !/^\d{4}-\d{2}$/.test(row.month) ||
                        !isBusinessDate(row.month + '-01')
                      : typeof row.deleted !== 'boolean'))
            ) {
              return corrupt();
            }
            const binding = {
              digest: row.digest,
              canonicalVersion: row.canonicalVersion,
              keyId: row.keyId,
              acceptedAt: row.acceptedAt,
              expiresAt: row.expiresAt,
            };
            if (row.state === 'rejected') {
              return {
                ...binding,
                state: 'rejected',
                code: row.code,
                version: row.version,
                ...(action === 'review.decorations' ? { month: row.month } : {}),
              };
            }
            return action === 'journal.upsert'
              ? { ...binding, version: row.version, entryId: row.entryId }
              : action === 'review.decorations'
                ? { ...binding, version: row.version, month: row.month }
                : { ...binding, version: row.version, deleted: row.deleted };
          },
          async setReceipt(action, requestId, receipt) {
            const data = {
              layout: LAYOUT,
              ownerId,
              action,
              requestId,
              digest: receipt.digest,
              canonicalVersion: receipt.canonicalVersion,
              keyId: receipt.keyId,
              acceptedAt: receipt.acceptedAt,
              expiresAt: receipt.expiresAt,
              version: receipt.version,
            };
            if (receipt.state === 'rejected') {
              data.state = receipt.state;
              data.code = receipt.code;
              if (action === 'review.decorations') {
                data.month = receipt.month;
              }
            } else if (action === 'journal.upsert') {
              data.entryId = receipt.entryId;
            } else if (action === 'review.decorations') {
              data.month = receipt.month;
            } else {
              data.deleted = receipt.deleted;
            }
            await transaction
              .collection('request_receipts')
              .doc(receiptId(ownerId, action, requestId))
              .set({ data });
          },
          async advanceRevision() {
            if (
              advanced ||
              exportAdvanced ||
              revision === Number.MAX_SAFE_INTEGER ||
              exportEpoch === Number.MAX_SAFE_INTEGER
            ) {
              return corrupt();
            }
            advanced = true;
            exportAdvanced = true;
            const result = await accountDoc.update({
              data: { journalRevision: revision + 1, exportEpoch: exportEpoch + 1 },
            });
            if (!result.stats || result.stats.updated !== 1) {
              return corrupt();
            }
          },
          async touchAccount() {
            if (touched || fence === Number.MAX_SAFE_INTEGER) {
              return corrupt();
            }
            touched = true;
            const result = await accountDoc.update({ data: { operationFence: fence + 1 } });
            if (!result.stats || result.stats.updated !== 1) {
              return corrupt();
            }
          },
          async invalidateExports() {
            if (exportAdvanced || exportEpoch === Number.MAX_SAFE_INTEGER) {
              return corrupt();
            }
            exportAdvanced = true;
            const result = await accountDoc.update({ data: { exportEpoch: exportEpoch + 1 } });
            if (!result.stats || result.stats.updated !== 1) {
              return corrupt();
            }
          },
          async writeDeletionMarker(marker) {
            const key = idFor('journal-deletion', ownerId, marker.entryId, marker.deletedVersion);
            const doc = transaction.collection('deletion_markers').doc(key);
            // An existing ledger event must never be overwritten or silently reset.
            // It may indicate a collision, corrupted state or an unsafe restore.
            if ((await doc.get()).data !== null) {
              return corrupt();
            }
            await transaction
              .collection('deletion_markers')
              .doc(key)
              .set({
                data: {
                  layout: LAYOUT,
                  ownerId,
                  collection: 'journals',
                  docId: dayId(ownerId, marker.date),
                  date: marker.date,
                  month: marker.date.slice(0, 7),
                  entryId: marker.entryId,
                  deletedVersion: marker.deletedVersion,
                  deletedAt: marker.deletedAt,
                  cleanupState: 'pending',
                },
              });
          },
          async getDecorations(month) {
            const row = (
              await transaction
                .collection('month_decorations')
                .doc(decorationId(ownerId, month))
                .get()
            ).data;
            if (row === null) {
              return undefined;
            }
            if (
              !row ||
              row.layout !== LAYOUT ||
              row.ownerId !== ownerId ||
              row.month !== month ||
              !validVersion(row.version, 1)
            ) {
              return corrupt();
            }
            return { version: row.version, stickers: row.stickers, backgroundId: row.backgroundId };
          },
          async setDecorations(month, doc) {
            await transaction
              .collection('month_decorations')
              .doc(decorationId(ownerId, month))
              .set({
                data: {
                  layout: LAYOUT,
                  ownerId,
                  month,
                  version: doc.version,
                  stickers: doc.stickers.map((sticker) =>
                    sticker.targetEntryId
                      ? { stickerId: sticker.stickerId, targetEntryId: sticker.targetEntryId }
                      : { stickerId: sticker.stickerId },
                  ),
                  backgroundId: doc.backgroundId,
                },
              });
          },
          async listMonthMarks(month) {
            if (
              typeof month !== 'string' ||
              !/^\d{4}-\d{2}$/.test(month) ||
              !isBusinessDate(month + '-01')
            ) {
              return corrupt();
            }
            const lastDay = new Date(month + '-01T00:00:00.000Z');
            lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
            lastDay.setUTCDate(0);
            const dates = snapshotDates({
              startDate: month + '-01',
              endDate: lastDay.toISOString().slice(0, 10),
            });
            const marks = [];
            for (const date of dates) {
              const day = await getDay(transaction, ownerId, date);
              if (day && day.entry) {
                marks.push({ id: day.entry.id, date, weather: day.entry.weather });
              }
            }
            return marks;
          },
        };
        return work(tx);
      });
    },
    readSnapshot(ownerId, range) {
      const dates = snapshotDates(range);
      return inAccount(ownerId, async (transaction, _account, revision) => {
        const entries = [];
        // One account read plus <=90 day reads stays below the documented 100-operation cap.
        // Latency/30-second limit still requires a real-environment benchmark before enabling.
        for (const date of dates) {
          const day = await getDay(transaction, ownerId, date);
          if (day && day.entry) {
            entries.push({ id: day.entry.id, date, weather: day.entry.weather });
          }
        }
        return { revision, entries };
      });
    },
  };
}
module.exports = { createCloudJournalRepository, LAYOUT, dayId, receiptId, decorationId };
