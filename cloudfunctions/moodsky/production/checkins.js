const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { PLACES } = require('../shared/campus-checkins');
const { businessDate, isBusinessDate } = require('../shared/date');
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
    const writing = action === 'campus.checkIn';
    if (
      Object.keys(payload).some((k) => !writing || k !== 'placeId') ||
      (writing && !PLACES.some((p) => p.placeId === payload.placeId))
    ) {
      throw new AppError('INVALID_INPUT', '请选择推荐列表中的地点。');
    }
    return accounts.withOwner(ownerId, async () => {
      const tx = accounts.transaction(ownerId);
      const stamp = now();
      const date = businessDate(stamp);
      if (!writing) {
        const items = [];
        for (const place of PLACES) {
          const row = (
            await tx
              .collection('place_checkins')
              .doc(checkinId(ownerId, place.placeId, date))
              .get()
          ).data;
          if (row) {
            items.push(project(row, ownerId));
          }
        }
        return { date, items };
      }
      const receiptKey = key('checkin_receipt_', [ownerId, requestId]);
      const receiptRef = tx.collection('request_receipts').doc(receiptKey);
      const receipt = (await receiptRef.get()).data;
      if (receipt) {
        if (
          receipt._id !== receiptKey ||
          receipt.ownerId !== ownerId ||
          receipt.action !== action ||
          receipt.requestId !== requestId ||
          receipt.placeId !== payload.placeId
        ) {
          fail();
        }
        const result = project(receipt.result, ownerId);
        if (result.placeId !== payload.placeId) {
          fail();
        }
        return { ...result, replayed: true };
      }
      const id = checkinId(ownerId, payload.placeId, date);
      const ref = tx.collection('place_checkins').doc(id);
      let row = (await ref.get()).data;
      if (row) {
        project(row, ownerId);
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
      await receiptRef.set({
        data: { ownerId, action, requestId, placeId: payload.placeId, result: row },
      });
      return { ...project(row, ownerId), replayed: false };
    });
  };
}
module.exports = { createProductionCheckins, checkinId };
