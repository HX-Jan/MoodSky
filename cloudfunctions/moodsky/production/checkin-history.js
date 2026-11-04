const { AppError } = require('../shared/result');
const { PLACES } = require('../shared/campus-checkins');
const { isBusinessDate } = require('../shared/date');
const invalid = () => {
  throw new AppError('INVALID_INPUT', '打卡记录翻页信息无效，请重新读取。');
};
function decode(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    invalid();
  }
  let result;
  try {
    if (Buffer.from(value, 'base64url').toString('base64url') !== value) {
      invalid();
    }
    result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    invalid();
  }
  if (
    !result ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(',') !== 'date,placeId' ||
    !isBusinessDate(result.date) ||
    !PLACES.some((p) => p.placeId === result.placeId)
  ) {
    invalid();
  }
  return result;
}
function createCheckinHistory({ db, accounts, project }) {
  return async ({ actor, payload }) => {
    if (Object.keys(payload).some((k) => k !== 'cursor')) {
      invalid();
    }
    const after = decode(payload.cursor),
      ownerId = actor.accountId;
    return accounts.withOwner(ownerId, async () => {
      const command = db.command;
      const filter = after
        ? command.and([
            { ownerId },
            command.or([
              { date: command.lt(after.date) },
              { date: after.date, placeId: command.gt(after.placeId) },
            ]),
          ])
        : { ownerId };
      // Join the same account fence as writes/closure. As with task history, the
      // bounded query is outside tx; a concurrent participating write retries tx.
      const result = await db
        .collection('place_checkins')
        .where(filter)
        .orderBy('date', 'desc')
        .orderBy('placeId', 'asc')
        .limit(11)
        .get();
      if (!Array.isArray(result.data) || result.data.length > 11) {
        throw new AppError('CONFLICT', '打卡记录暂时无法读取，请重试。');
      }
      const projected = result.data.map((row) => project(row, ownerId));
      const items = projected.slice(0, 10),
        last = items.at(-1);
      return {
        items,
        nextCursor:
          projected.length > 10
            ? Buffer.from(JSON.stringify({ date: last.date, placeId: last.placeId })).toString(
                'base64url',
              )
            : null,
      };
    });
  };
}
module.exports = { createCheckinHistory };
