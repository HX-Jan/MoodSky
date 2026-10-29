// ============================================================================
// MoodSky — campus data access  (W2 JH01 / JH03 / JH04, Junhan Huang)
// ============================================================================
// The only place in the campus/admin scope that talks to CloudBase. The domain
// handlers receive this object as `repositories`, which is what makes them
// testable with an in-memory substitute and keeps every policy decision out of
// the query layer.
//
// Two deliberate choices, both provisional:
//
// 1. Reads sweep the whole collection (bounded by SWEEP_LIMIT) and the domain
//    applies the publishability rules in one place. Campus material is tens of
//    rows, so this is cheaper than duplicating the verification predicate as a
//    database query that could silently disagree with the tested rule. When the
//    collections grow, move the predicate into `where` and keep a single test
//    against the rule module.
//
// 2. Place writes re-read and plan inside a transaction. The handler separately
//    checks committed fields on read-back before reporting verified success.
//
// STATUS: not executed against a live environment in week two. The cloud SDK
// call shapes follow cloudfunctions/moodsky/adapters.js, but they remain
// unverified until an authorized test deployment runs the campus flow.
// ============================================================================

const { AppError } = require('./shared/result');
const conflict = () => {
  throw new AppError('CONFLICT', '资料已变化，请重新读取。');
};
const rowsOf = (result) => {
  if (!result || !Array.isArray(result.data)) {
    throw new Error('Invalid campus database response');
  }
  return result.data;
};
function createdId(result) {
  if (!result || typeof result._id !== 'string' || !result._id.trim()) {
    throw new Error('Invalid campus create acknowledgement');
  }
  return result._id;
}
const PLACES = 'places';
const FAVORITES = 'favorites';
const CORRECTIONS = 'place_corrections';
const SUPPORT_RESOURCES = 'support_resources';
const TASK_TEMPLATES = 'task_templates';

// CloudBase returns at most 100 rows per get() on the server side.
const BATCH_SIZE = 100;
// Ceiling for one sweep; exceeding it is reported, never hidden.
const SWEEP_LIMIT = 500;

function createRepositories(cloud) {
  if (!cloud || typeof cloud.database !== 'function') {
    throw new TypeError('createRepositories requires an initialised wx-server-sdk instance.');
  }
  const db = cloud.database({ throwOnNotFound: false });

  async function sweep(collection, where) {
    const rows = [];
    let skip = 0;
    for (;;) {
      const query =
        where && Object.keys(where).length > 0
          ? db.collection(collection).where(where)
          : db.collection(collection);
      const result = await query.orderBy('_id', 'asc').skip(skip).limit(BATCH_SIZE).get();
      const batch = rowsOf(result);
      rows.push(...batch);
      if (batch.length < BATCH_SIZE) {
        return { rows, truncated: false };
      }
      skip += BATCH_SIZE;
      if (rows.length >= SWEEP_LIMIT) {
        return { rows: rows.slice(0, SWEEP_LIMIT), truncated: true };
      }
    }
  }

  async function findFavorite(ownerId, placeId) {
    const result = await db.collection(FAVORITES).where({ ownerId, placeId }).limit(2).get();
    const rows = rowsOf(result);
    if (rows.length > 1) {
      conflict();
    }
    return rows.length > 0 ? rows[0] : null;
  }

  // Cleanup is bounded and verified one document at a time: a partial delete is
  // reported as an error rather than silently counted as success, because the
  // caller (account cleanup) records the removed count it gets back.
  async function removeOwned(collection, ownerId) {
    let removed = 0;
    for (let round = 0; round <= SWEEP_LIMIT; round += 1) {
      const batch = await db.collection(collection).where({ ownerId }).limit(BATCH_SIZE).get();
      const rows = rowsOf(batch);
      if (rows.length === 0) {
        return { removed };
      }
      for (const row of rows) {
        if (typeof row._id !== 'string' || row._id.length === 0) {
          throw new Error('Invalid campus cleanup row');
        }
        const result = await db.collection(collection).doc(row._id).remove();
        if (result?.stats?.removed !== 1) {
          throw new Error('Invalid campus cleanup acknowledgement');
        }
        removed += 1;
      }
    }
    throw new Error('Campus cleanup exceeded the sweep limit');
  }

  return {
    places: {
      listAll() {
        return sweep(PLACES);
      },

      async findByPlaceId(placeId) {
        const result = await db.collection(PLACES).where({ placeId }).limit(2).get();
        const rows = rowsOf(result);
        if (rows.length > 1) {
          conflict();
        }
        return rows.length > 0 ? rows[0] : null;
      },

      /**
       * Resolve an unambiguous place ID first, then build changes from the
       * current transaction row on every SDK retry; require exactly one update.
       */
      async updateById(id, buildChanges) {
        if (typeof buildChanges !== 'function') {
          throw new TypeError('Place updates require a transaction-owned change builder.');
        }
        return db.runTransaction(async (tx) => {
          const document = tx.collection(PLACES).doc(id);
          const current = (await document.get()).data;
          const changes = buildChanges(current);
          const result = await document.update({ data: changes });
          if (result?.stats?.updated !== 1) {
            conflict();
          }
          return { updated: 1, changes };
        });
      },
    },

    favorites: {
      listByOwner(ownerId) {
        return sweep(FAVORITES, { ownerId });
      },

      async findByOwnerAndPlace(ownerId, placeId) {
        return findFavorite(ownerId, placeId);
      },

      /**
       * Idempotent add. The unique key [ownerId, placeId] is the guarantee; a
       * duplicate rejection is translated into `duplicated: true` rather than
       * an error, because tapping the star twice is not a failure.
       */
      async add(ownerId, placeId, createdAt) {
        try {
          const result = await db
            .collection(FAVORITES)
            .add({ data: { ownerId, placeId, createdAt } });
          return { id: createdId(result), duplicated: false };
        } catch (error) {
          const existing = await findFavorite(ownerId, placeId);
          if (existing) {
            return { id: createdId(existing), duplicated: true };
          }
          throw error;
        }
      },

      /** Idempotent removal; returns how many rows actually disappeared. */
      async remove(ownerId, placeId) {
        const result = await db.collection(FAVORITES).where({ ownerId, placeId }).remove();
        const removed = result?.stats?.removed;
        if (!Number.isInteger(removed) || removed < 0) {
          throw new Error('Invalid campus remove acknowledgement');
        }
        return { removed };
      },

      /** Account cleanup: idempotent removal of every favorite owned by one account. */
      removeByOwner(ownerId) {
        return removeOwned(FAVORITES, ownerId);
      },
    },

    corrections: {
      async create(document) {
        const result = await db.collection(CORRECTIONS).add({ data: document });
        return { id: createdId(result) };
      },

      async findByCorrectionId(correctionId) {
        const result = await db.collection(CORRECTIONS).doc(correctionId).get();
        const row = result && result.data;
        if (!row) {
          return null;
        }
        return { ...row, _id: typeof row._id === 'string' ? row._id : correctionId };
      },

      /**
       * Reviews one correction inside a transaction, so two operators cannot
       * both "approve" the same pending record from stale reads. The builder
       * re-plans against the current row on every SDK retry.
       */
      async reviewById(id, buildChanges) {
        if (typeof buildChanges !== 'function') {
          throw new TypeError('Correction reviews require a transaction-owned change builder.');
        }
        return db.runTransaction(async (tx) => {
          const document = tx.collection(CORRECTIONS).doc(id);
          const current = (await document.get()).data;
          if (!current) {
            return { updated: 0, changes: null };
          }
          const planned = buildChanges({ ...current, _id: current._id || id });
          if (!planned || planned.changes === null) {
            return { updated: 0, changes: null, alreadyReviewed: true };
          }
          const result = await document.update({ data: planned.changes });
          if (result?.stats?.updated !== 1) {
            conflict();
          }
          return { updated: 1, changes: planned.changes };
        });
      },

      listAll() {
        return sweep(CORRECTIONS);
      },

      listByOwner(ownerId) {
        return sweep(CORRECTIONS, { ownerId });
      },

      /** Account cleanup: idempotent removal of every correction owned by one account. */
      removeByOwner(ownerId) {
        return removeOwned(CORRECTIONS, ownerId);
      },
    },

    supportResources: {
      listAll() {
        return sweep(SUPPORT_RESOURCES);
      },
    },

    taskTemplates: {
      listAll() {
        return sweep(TASK_TEMPLATES);
      },
    },
  };
}

module.exports = { createRepositories, SWEEP_LIMIT, BATCH_SIZE };
