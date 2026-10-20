// W2XY01/02 (Phoenix-Yx), revised in PR31: trusted opt-in construction, no import-time SDK.
const { notImplemented } = require('../shared/result');
const { createJournalService } = require('../services/journal');
const { database, identity, fail } = require('./storage-support');

function createRepository({
  db,
  accountUniqueIndexReady = false,
  journalRepository,
  receiptPolicy,
  now,
} = {}) {
  const journal = journalRepository
    ? createJournalService({ repository: journalRepository, receiptPolicy, now })
    : null;
  function accountView(row, openid) {
    if (!row || row.openid !== openid || !['active', 'disabled'].includes(row.status)) {
      return fail('CONFLICT');
    }
    identity(row._id);
    return {
      id: row._id,
      status: row.status,
      ...(row.campusId === undefined ? {} : { campusId: row.campusId }),
    };
  }
  async function getOrCreateAccount(openid) {
    identity(openid); // Value must come from trusted invocation context, never payload.
    database(db);
    const accountsRef = db.collection('accounts');
    const lookup = async () => {
      const result = await accountsRef.where({ openid }).limit(2).get();
      if (!Array.isArray(result.data) || result.data.length > 1) {
        return fail('CONFLICT');
      }
      return result.data[0] ? accountView(result.data[0], openid) : null;
    };
    const existing = await lookup();
    if (existing) {
      return existing;
    } // Disabled accounts are returned disabled, never reactivated.
    if (accountUniqueIndexReady !== true) {
      return notImplemented();
    }
    try {
      const result = await accountsRef.add({
        data: { openid, status: 'active', createdAt: db.serverDate(), updatedAt: db.serverDate() },
      });
      return { id: identity(result._id), status: 'active' };
    } catch (error) {
      // Duplicate creation or an ambiguous committed response: re-read the unique identity.
      // Never treat a broad SDK error code as proof of a duplicate or retry a second add.
      const winner = await lookup();
      if (winner) {
        return winner;
      }
      throw error;
    }
  }
  const invoke = async (action, ownerId, payload, requestId) => {
    identity(ownerId);
    if (!journal) {
      return notImplemented();
    }
    return journal({ action, actor: { accountId: ownerId }, payload, requestId });
  };
  return {
    getOrCreateAccount,
    async getJournalByDate(ownerId, date) {
      return (await invoke('journal.get', ownerId, { date })).entry;
    },
    async saveJournal(ownerId, input, requestId) {
      return (await invoke('journal.upsert', ownerId, input, requestId)).entry;
    },
    async deleteJournal(ownerId, date, expectedVersion, requestId) {
      return (await invoke('journal.delete', ownerId, { date, expectedVersion }, requestId))
        .deleted;
    },
  };
}
module.exports = { createRepository, ...createRepository() };
