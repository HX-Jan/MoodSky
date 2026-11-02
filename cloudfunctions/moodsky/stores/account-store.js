// ============================================================================
// MoodSky — account store  (W2 JF01 / JF03 / JF04, Jiawei Fang)
// ============================================================================
// One interface, two implementations:
//
//   createAccountStore()                        in-memory local double (tests)
//   createAccountStore({ cloud })               wx-server-sdk database access
//
// Collections (database/collections.json): accounts / preferences /
// cleanup_jobs / request_receipts. `accounts.openid` and
// `preferences.ownerId` are the declared unique keys.
//
// preferences writes are field-level: updatePreferences(ownerId, patch, at)
// writes only the fields the caller supplied, so two concurrent partial sets
// cannot overwrite each other (the memory store also holds a per-owner lock).
// The full-row default merge happens only on the first insert. `cleanup_jobs` has NO
// unique key, so "one open job per owner" is enforced by read-then-insert and
// remains racy — recorded as an open item instead of being claimed as safe.
//
// The cloud implementation below has NEVER been executed against the real
// cloud. Real-cloud authorisation, the exact duplicate-key error shape and the
// timestamp field types stay unverified; a stub that mimics the wx-server-sdk
// call shape stands in for it in the tests.
// ============================================================================

const { DEFAULT_PREFERENCES } = require('../shared/constants');

const ACCOUNTS = 'accounts';
const PREFERENCES = 'preferences';
const CLEANUP_JOBS = 'cleanup_jobs';
const REQUEST_RECEIPTS = 'request_receipts';
const OPEN_JOB_STATES = ['pending', 'processing'];
const SINGLE = 1;

function duplicateKeyError() {
  const error = new Error('Unique key conflict.');
  error.code = 'DUPLICATE_KEY';
  return error;
}

// The platform error shape for a unique-index hit is unverified. Treat the
// documented Mongo-style markers as a duplicate and rethrow everything else so
// a permission or timeout failure is never mistaken for "already exists".
function isDuplicateKeyError(error) {
  if (!error) {
    return false;
  }
  if (error.code === 'DUPLICATE_KEY' || error.errCode === 'DUPLICATE_KEY') {
    return true;
  }
  const text = String(error.errMsg || error.message || '');
  return /duplicate key|E11000/i.test(text);
}

const mapAccount = (row) => ({
  id: row._id,
  openid: row.openid,
  status: row.status,
  createdAt: row.createdAt || null,
  updatedAt: row.updatedAt || null,
});

const mapPreferences = (row) => ({
  ownerId: row.ownerId,
  cardTextPreview: row.cardTextPreview,
  decorationsEnabled: row.decorationsEnabled,
  updatedAt: row.updatedAt || null,
});

const mapJob = (row) => ({
  id: row._id,
  ownerId: row.ownerId,
  state: row.state,
  createdAt: row.createdAt || null,
  updatedAt: row.updatedAt || null,
});

const mapReceipt = (row) => ({
  ownerId: row.ownerId,
  action: row.action,
  requestId: row.requestId,
  data: row.data,
  createdAt: row.createdAt || null,
});

// Serialises preference writes for one owner. Two concurrent partial sets would
// otherwise read the same row and write it back whole, so the later write would
// silently drop the earlier field. This is a single-process guarantee only; the
// cloud store cannot lock across instances and instead writes ONLY the patched
// fields, which is what keeps a lost update from happening there.
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

// ---------------------------------------------------------------------------
// In-memory double. Deterministic ids, unique-key behaviour mirrored, and a
// call log so a test can prove a rejected request never reached the data.
// ---------------------------------------------------------------------------
function createMemoryStore({ seed = {} } = {}) {
  const counters = { account: 0, job: 0 };
  const calls = [];
  const rows = {
    accounts: (seed.accounts || []).map((row, index) => ({
      id: row.id || 'account_seed_' + (index + 1),
      openid: row.openid,
      status: row.status,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
    })),
    preferences: (seed.preferences || []).map((row) => ({ ...row })),
    cleanupJobs: (seed.cleanupJobs || []).map((row) => ({ ...row })),
    requestReceipts: (seed.requestReceipts || []).map((row) => ({ ...row })),
  };
  const withPreferenceLock = createOwnerLocks();

  return {
    rows,
    calls,
    isMemory: true,
    async findAccountByOpenid(openid) {
      calls.push({ op: 'findAccountByOpenid', openid });
      return rows.accounts.find((row) => row.openid === openid) || null;
    },
    async insertAccount(account) {
      calls.push({ op: 'insertAccount', openid: account.openid });
      if (rows.accounts.some((row) => row.openid === account.openid)) {
        throw duplicateKeyError();
      }
      counters.account += 1;
      const stored = {
        id: 'account_' + counters.account,
        openid: account.openid,
        status: account.status,
        createdAt: account.createdAt || null,
        updatedAt: account.updatedAt || null,
      };
      rows.accounts.push(stored);
      return { ...stored };
    },
    async getAccount(accountId) {
      calls.push({ op: 'getAccount', accountId });
      const row = rows.accounts.find((item) => item.id === accountId);
      return row ? { ...row } : null;
    },
    async setAccountStatus(accountId, status, updatedAt) {
      calls.push({ op: 'setAccountStatus', accountId, status });
      const row = rows.accounts.find((item) => item.id === accountId);
      if (!row) {
        return null;
      }
      row.status = status;
      row.updatedAt = updatedAt;
      return { ...row };
    },
    async getPreferences(ownerId) {
      calls.push({ op: 'getPreferences', ownerId });
      const row = rows.preferences.find((item) => item.ownerId === ownerId);
      return row ? { ...row } : null;
    },
    // Only the patched fields are written. The read-merge-write runs inside the
    // per-owner lock, so the returned row is the value that actually landed and a
    // concurrent partial set of another field can never be dropped by it.
    async updatePreferences(ownerId, patch, updatedAt) {
      calls.push({ op: 'updatePreferences', ownerId, fields: Object.keys(patch || {}) });
      return withPreferenceLock(ownerId, async () => {
        const row = rows.preferences.find((item) => item.ownerId === ownerId);
        if (row) {
          Object.assign(row, patch, { updatedAt });
          return { ...row };
        }
        // First write: the defaults only fill the fields this patch omitted.
        const stored = { ownerId, ...DEFAULT_PREFERENCES, ...patch, updatedAt };
        rows.preferences.push(stored);
        return { ...stored };
      });
    },
    async findOpenCleanupJob(ownerId) {
      calls.push({ op: 'findOpenCleanupJob', ownerId });
      const row = rows.cleanupJobs.find(
        (item) => item.ownerId === ownerId && OPEN_JOB_STATES.includes(item.state),
      );
      return row ? { ...row } : null;
    },
    async insertCleanupJob(job) {
      calls.push({ op: 'insertCleanupJob', ownerId: job.ownerId });
      counters.job += 1;
      const stored = {
        id: 'cleanup_' + counters.job,
        ownerId: job.ownerId,
        state: job.state,
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
      };
      rows.cleanupJobs.push(stored);
      return { ...stored };
    },
    async getCleanupJob(jobId) {
      calls.push({ op: 'getCleanupJob', jobId });
      const row = rows.cleanupJobs.find((item) => item.id === jobId);
      return row ? { ...row } : null;
    },
    async setCleanupJobState(jobId, state, updatedAt) {
      calls.push({ op: 'setCleanupJobState', jobId, state });
      const row = rows.cleanupJobs.find((item) => item.id === jobId);
      if (!row) {
        return null;
      }
      row.state = state;
      row.updatedAt = updatedAt;
      return { ...row };
    },
    async findRequestReceipt({ ownerId, action, requestId }) {
      calls.push({ op: 'findRequestReceipt', ownerId, action, requestId });
      const row = rows.requestReceipts.find(
        (item) =>
          item.ownerId === ownerId && item.action === action && item.requestId === requestId,
      );
      return row ? { ...row } : null;
    },
    async insertRequestReceipt(receipt) {
      calls.push({ op: 'insertRequestReceipt', ownerId: receipt.ownerId });
      const clash = rows.requestReceipts.some(
        (item) =>
          item.ownerId === receipt.ownerId &&
          item.action === receipt.action &&
          item.requestId === receipt.requestId,
      );
      if (clash) {
        throw duplicateKeyError();
      }
      const stored = {
        ownerId: receipt.ownerId,
        action: receipt.action,
        requestId: receipt.requestId,
        data: receipt.data,
        createdAt: receipt.createdAt || null,
      };
      rows.requestReceipts.push(stored);
      return { ...stored };
    },
  };
}

// ---------------------------------------------------------------------------
// wx-server-sdk implementation. Written from the documented call shape only;
// it has not been run against the deployed environment.
// ---------------------------------------------------------------------------
function createCloudStore(cloud) {
  if (!cloud || typeof cloud.database !== 'function') {
    throw new TypeError('createCloudStore requires an initialised wx-server-sdk instance.');
  }
  const db = cloud.database();
  const table = (name) => db.collection(name);

  async function readOne(name, filter) {
    const result = await table(name).where(filter).limit(SINGLE).get();
    return result && Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
  }

  async function addRow(name, data) {
    try {
      const result = await table(name).add({ data });
      return result && result._id ? result._id : null;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw duplicateKeyError();
      }
      throw error;
    }
  }

  async function updateRow(name, id, data) {
    const result = await table(name).doc(id).update({ data });
    if (!result || !result.stats || result.stats.updated !== 1) {
      throw new Error('Candidate account update did not confirm one stored row.');
    }
  }

  async function readDoc(name, id) {
    const result = await table(name).doc(id).get();
    const row = result && result.data ? result.data : null;
    return Array.isArray(row) ? row[0] || null : row;
  }

  return {
    isMemory: false,
    async findAccountByOpenid(openid) {
      const row = await readOne(ACCOUNTS, { openid });
      return row ? mapAccount(row) : null;
    },
    async insertAccount(account) {
      const id = await addRow(ACCOUNTS, {
        openid: account.openid,
        status: account.status,
        createdAt: account.createdAt || null,
        updatedAt: account.updatedAt || null,
      });
      return {
        id,
        openid: account.openid,
        status: account.status,
        createdAt: account.createdAt || null,
        updatedAt: account.updatedAt || null,
      };
    },
    async getAccount(accountId) {
      const row = await readDoc(ACCOUNTS, accountId);
      return row ? mapAccount(row) : null;
    },
    async setAccountStatus(accountId, status, updatedAt) {
      await updateRow(ACCOUNTS, accountId, { status, updatedAt });
      return { id: accountId, status, updatedAt };
    },
    async getPreferences(ownerId) {
      const row = await readOne(PREFERENCES, { ownerId });
      return row ? mapPreferences(row) : null;
    },
    // Writes only the patched fields. A concurrent partial set of the other field
    // therefore survives: its value is not part of this update at all.
    async updatePreferences(ownerId, patch, updatedAt) {
      const existing = await readOne(PREFERENCES, { ownerId });
      if (existing) {
        await updateRow(PREFERENCES, existing._id, { ...patch, updatedAt });
        return mapPreferences({ ...existing, ...patch, ownerId, updatedAt });
      }
      // First write: the defaults only fill the fields this patch omitted.
      const first = { ownerId, ...DEFAULT_PREFERENCES, ...patch, updatedAt };
      try {
        await addRow(PREFERENCES, first);
        return { ...first };
      } catch (error) {
        // A concurrent first write may win the unique key; reuse its row and then
        // patch only this call's fields.
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        const raced = await readOne(PREFERENCES, { ownerId });
        if (!raced) {
          throw error;
        }
        await updateRow(PREFERENCES, raced._id, { ...patch, updatedAt });
        return mapPreferences({ ...raced, ...patch, ownerId, updatedAt });
      }
    },
    async findOpenCleanupJob(ownerId) {
      for (const state of OPEN_JOB_STATES) {
        const row = await readOne(CLEANUP_JOBS, { ownerId, state });
        if (row) {
          return mapJob(row);
        }
      }
      return null;
    },
    async insertCleanupJob(job) {
      const id = await addRow(CLEANUP_JOBS, {
        ownerId: job.ownerId,
        state: job.state,
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
      });
      return {
        id,
        ownerId: job.ownerId,
        state: job.state,
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
      };
    },
    async getCleanupJob(jobId) {
      const row = await readDoc(CLEANUP_JOBS, jobId);
      return row ? mapJob(row) : null;
    },
    async setCleanupJobState(jobId, state, updatedAt) {
      await updateRow(CLEANUP_JOBS, jobId, { state, updatedAt });
      return { id: jobId, state, updatedAt };
    },
    async findRequestReceipt({ ownerId, action, requestId }) {
      const row = await readOne(REQUEST_RECEIPTS, { ownerId, action, requestId });
      return row ? mapReceipt(row) : null;
    },
    async insertRequestReceipt(receipt) {
      try {
        await addRow(REQUEST_RECEIPTS, {
          ownerId: receipt.ownerId,
          action: receipt.action,
          requestId: receipt.requestId,
          data: receipt.data,
          createdAt: receipt.createdAt || null,
        });
        return { ...receipt };
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        const existing = await readOne(REQUEST_RECEIPTS, {
          ownerId: receipt.ownerId,
          action: receipt.action,
          requestId: receipt.requestId,
        });
        return existing ? mapReceipt(existing) : { ...receipt };
      }
    },
  };
}

function createAccountStore(options = {}) {
  if (options && options.cloud) {
    return createCloudStore(options.cloud);
  }
  return createMemoryStore(options);
}

module.exports = { createAccountStore, createMemoryStore, createCloudStore, isDuplicateKeyError };
