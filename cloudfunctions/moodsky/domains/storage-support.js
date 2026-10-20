// Internal opt-in adapters only; no SDK initialization or network operation on import.
const { AppError, notImplemented } = require('../shared/result');
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (code = 'INVALID_INPUT') => {
  throw new AppError(code, '存储操作条件不满足。');
};
function database(db) {
  if (!db) {
    return notImplemented();
  }
  if (db.config?.throwOnNotFound !== false || typeof db.runTransaction !== 'function') {
    throw new TypeError('Use an injected wx database({ throwOnNotFound: false }).');
  }
  return db;
}
function identity(value) {
  if (!validId(value)) {
    return fail();
  }
  return value;
}
function account(row, ownerId, status) {
  if (!row || row._id !== ownerId || !['active', 'disabled'].includes(row.status)) {
    return fail('UNAUTHENTICATED');
  }
  if (row.status !== status) {
    return fail(status === 'active' ? 'ACCOUNT_DISABLED' : 'FORBIDDEN');
  }
  return row;
}
const SOURCE_DOMAINS = ['journals', 'favorites', 'tasks', 'preferences', 'decorations'];
function sourceState(value, ownerId) {
  if (
    !value ||
    value.ownerId !== ownerId ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 0 ||
    !value.revisions ||
    Object.keys(value.revisions).length !== SOURCE_DOMAINS.length ||
    !SOURCE_DOMAINS.every(
      (key) =>
        Object.hasOwn(value.revisions, key) &&
        Number.isSafeInteger(value.revisions[key]) &&
        value.revisions[key] >= 0,
    )
  ) {
    return fail('CONFLICT');
  }
  if (value.status !== 'active') {
    return fail('ACCOUNT_DISABLED');
  }
  return {
    epoch: value.epoch,
    revisions: Object.fromEntries(SOURCE_DOMAINS.map((key) => [key, value.revisions[key]])),
  };
}
async function ownerPage(db, collection, ownerId, cursor, pageSize) {
  const filter = cursor ? { ownerId, _id: db.command.gt(cursor) } : { ownerId };
  const result = await db
    .collection(collection)
    .where(filter)
    .orderBy('_id', 'asc')
    .limit(pageSize)
    .get();
  if (!Array.isArray(result.data) || result.data.length > pageSize) {
    return fail('CONFLICT');
  }
  let last = cursor;
  for (const row of result.data) {
    if (!row || row.ownerId !== ownerId || !validId(row._id) || (last && row._id <= last)) {
      return fail('CONFLICT');
    }
    last = row._id;
  }
  return result.data;
}
module.exports = { validId, fail, database, identity, account, sourceState, ownerPage };
