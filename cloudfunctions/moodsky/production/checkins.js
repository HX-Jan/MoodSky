const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { PLACES } = require('../shared/campus-checkins');
const { businessDate, isBusinessDate } = require('../shared/date');
const { ownerPage } = require('../domains/storage-support');
const { createAccountTransactions } = require('../stores/account-transaction');
const key = (prefix, values) =>
  prefix + createHash('sha256').update(JSON.stringify(values)).digest('hex');
const checkinId = (ownerId, placeId, date) => key('checkin_', [ownerId, placeId, date]);
const fail = () => {
  throw new AppError('CONFLICT', '打卡记录暂时无法确认，请重试原操作。');
};
function createProductionCheckins({ db, now = () => new Date() }) {
  // A separate record collection shares the existing activity export revision/fence.
  const accounts = createAccountTransactions(db, {
    taskLayoutRequired: true,
    sourceDomain: 'tasks',
  });
  function project(row, ownerId) {
    if (
      !row ||
      row.ownerId !== ownerId ||
      !PLACES.some((p) => p.placeId === row.placeId) ||
      !isBusinessDate(row.date) ||
      row._id !== checkinId(ownerId, row.placeId, row.date) ||
      typeof row.completedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(
        row.completedAt,
      ) ||
      !isBusinessDate(row.completedAt.slice(0, 10)) ||
      !Number.isFinite(Date.parse(row.completedAt)) ||
      businessDate(new Date(row.completedAt)) !== row.date
    ) {
      fail();
    }
    return { placeId: row.placeId, date: row.date, completedAt: row.completedAt };
  }
  return async (request) => {
    const ownerId = request.actor.accountId;
    const { payload, requestId, action } = request;
    const writing = ['campus.checkIn', 'campus.checkin'].includes(action);
    const history =
      action === 'campus.checkinHistory' || (!writing && Object.keys(payload).length > 0);
    if (
      Object.keys(payload).some((k) =>
        writing ? k !== 'placeId' : !['page', 'pageSize'].includes(k),
      ) ||
      (history &&
        (!Number.isInteger(payload.page ?? 1) ||
          (payload.page ?? 1) < 1 ||
          !Number.isInteger(payload.pageSize ?? 10) ||
          (payload.pageSize ?? 10) < 1 ||
          (payload.pageSize ?? 10) > 50)) ||
      (writing && !PLACES.some((p) => p.placeId === payload.placeId))
    ) {
      throw new AppError('INVALID_INPUT', '请选择推荐列表中的地点。');
    }
    const result = await accounts.withOwner(ownerId, async () => {
      const tx = accounts.transaction(ownerId);
      const stamp = now();
      const date = businessDate(stamp);
      const legacyId = createHash('sha256').update(ownerId).digest('hex');
      const legacy = (await tx.collection('campus_checkin_states').doc(legacyId).get()).data;
      if (
        legacy &&
        (legacy.owner !== ownerId ||
          legacy.ownerId !== ownerId ||
          !Array.isArray(legacy.visits) ||
          !Array.isArray(legacy.requests))
      ) {
        fail();
      }
      const legacyRow = (row) =>
        project({ ...row, ownerId, _id: checkinId(ownerId, row.placeId, row.date) }, ownerId);
      async function pair(placeId, day) {
        const row = (
          await tx
            .collection('place_checkins')
            .doc(checkinId(ownerId, placeId, day))
            .get()
        ).data;
        const prior = legacy?.visits.find((v) => v.placeId === placeId && v.date === day);
        if (row) {
          project(row, ownerId);
        }
        if (prior) {
          legacyRow(prior);
        }
        if (row && prior && project(row, ownerId).completedAt !== legacyRow(prior).completedAt) {
          fail();
        }
        return { row, prior };
      }
      if (history) {
        const rows = new Map();
        for (const row of legacy?.visits || []) {
          const view = legacyRow(row);
          rows.set(JSON.stringify([view.placeId, view.date]), view);
        }
        let cursor = '',
          scanned = 0;
        for (;;) {
          const page = await ownerPage(db, 'place_checkins', ownerId, cursor, 100);
          scanned += page.length;
          if (scanned > 500) {
            fail();
          }
          for (const candidate of page) {
            const row = (await tx.collection('place_checkins').doc(candidate._id).get()).data;
            const view = project(row, ownerId),
              id = JSON.stringify([view.placeId, view.date]);
            const prior = rows.get(id);
            if (prior && prior.completedAt !== view.completedAt) {
              fail();
            }
            rows.set(id, view);
          }
          if (page.length < 100) {
            break;
          }
          cursor = page.at(-1)._id;
        }
        const items = [...rows.values()].sort(
          (a, b) =>
            Date.parse(b.completedAt) - Date.parse(a.completedAt) ||
            a.placeId.localeCompare(b.placeId),
        );
        const page = payload.page ?? 1,
          pageSize = payload.pageSize ?? 10;
        return {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: items.length,
          hasMore: page * pageSize < items.length,
        };
      }
      if (!writing) {
        const items = [];
        for (const place of PLACES) {
          const { row, prior } = await pair(place.placeId, date);
          if (row || prior) {
            items.push(row ? project(row, ownerId) : legacyRow(prior));
          }
        }
        return { date, items };
      }
      const oldReceipt = legacy?.requests.find((r) => r.id === requestId);
      if (oldReceipt) {
        if (
          oldReceipt.placeId !== payload.placeId ||
          oldReceipt.result?.visit?.placeId !== payload.placeId
        ) {
          fail();
        }
        if (typeof oldReceipt.result.duplicated !== 'boolean') {
          fail();
        }
        legacyRow(oldReceipt.result.visit);
        await pair(payload.placeId, oldReceipt.result.visit.date);
        return {
          view: legacyRow(oldReceipt.result.visit),
          replayed: true,
          legacyResult: oldReceipt.result,
        };
      }
      const receiptKey = key('checkin_receipt_', [ownerId, requestId]);
      const receiptRef = tx.collection('request_receipts').doc(receiptKey);
      const receipt = (await receiptRef.get()).data;
      if (receipt) {
        if (
          receipt._id !== receiptKey ||
          receipt.ownerId !== ownerId ||
          !['campus.checkIn', 'campus.checkin'].includes(receipt.action) ||
          receipt.requestId !== requestId ||
          receipt.placeId !== payload.placeId
        ) {
          fail();
        }
        const result = project(receipt.result, ownerId);
        if (result.placeId !== payload.placeId) {
          fail();
        }
        await pair(payload.placeId, result.date);
        const duplicated = receipt.duplicated === true;
        const visit = receipt.legacyVisit || result;
        if (
          legacyRow(visit).completedAt !== result.completedAt ||
          visit.placeId !== result.placeId ||
          visit.date !== result.date
        ) {
          fail();
        }
        return { view: result, replayed: true, legacyResult: { visit, duplicated } };
      }
      const id = checkinId(ownerId, payload.placeId, date);
      const ref = tx.collection('place_checkins').doc(id);
      const existing = await pair(payload.placeId, date);
      const duplicated = Boolean(existing.row || existing.prior);
      let row = existing.row;
      if (row) {
        project(row, ownerId);
      } else if (existing.prior) {
        row = { ...legacyRow(existing.prior), ownerId, _id: id };
      } else {
        row = {
          _id: id,
          ownerId,
          placeId: payload.placeId,
          date,
          completedAt: stamp.toISOString(),
        };
        const data = { ...row };
        delete data._id;
        await ref.set({ data });
        accounts.changed(ownerId);
      }
      const visit = existing.prior ? { ...existing.prior } : project(row, ownerId);
      await receiptRef.set({
        data: {
          ownerId,
          action,
          requestId,
          placeId: payload.placeId,
          result: row,
          duplicated,
          legacyVisit: visit,
        },
      });
      return { view: project(row, ownerId), replayed: false, legacyResult: { visit, duplicated } };
    });
    if (!writing) {
      return result;
    }
    return action === 'campus.checkin'
      ? result.legacyResult
      : { ...result.view, replayed: result.replayed };
  };
}
module.exports = { createProductionCheckins, checkinId };
