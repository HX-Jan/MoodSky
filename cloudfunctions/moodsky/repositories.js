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
// 2. Writes re-read nothing here; the handler re-reads through the repository
//    so a "saved but not yet visible" response cannot be reported as success.
//
// STATUS: not executed against a live environment in week two. The cloud SDK
// call shapes follow cloudfunctions/moodsky/adapters.js, but they remain
// unverified until an authorized test deployment runs the campus flow.
// ============================================================================

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
  const db = cloud.database();

  async function sweep(collection, where) {
    const rows = [];
    let skip = 0;
    for (;;) {
      const query =
        where && Object.keys(where).length > 0
          ? db.collection(collection).where(where)
          : db.collection(collection);
      const result = await query.skip(skip).limit(BATCH_SIZE).get();
      const batch = result && Array.isArray(result.data) ? result.data : [];
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
    const result = await db.collection(FAVORITES).where({ ownerId, placeId }).limit(1).get();
    const rows = result && Array.isArray(result.data) ? result.data : [];
    return rows.length > 0 ? rows[0] : null;
  }

  return {
    places: {
      listAll() {
        return sweep(PLACES);
      },

      async findByPlaceId(placeId) {
        const result = await db.collection(PLACES).where({ placeId }).limit(1).get();
        const rows = result && Array.isArray(result.data) ? result.data : [];
        return rows.length > 0 ? rows[0] : null;
      },

      /**
       * Updates one place by document id. `places` has no unique key
       * (database/collections.json), so the caller must have resolved the id
       * through findByPlaceId first.
       */
      async updateById(id, changes) {
        const result = await db.collection(PLACES).doc(id).update({ data: changes });
        const updated = result && typeof result.stats === 'object' ? result.stats.updated : 0;
        return { updated };
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
          return { id: result && result._id ? result._id : null, duplicated: false };
        } catch (error) {
          const existing = await findFavorite(ownerId, placeId);
          if (existing) {
            return { id: existing._id || null, duplicated: true };
          }
          throw error;
        }
      },

      /** Idempotent removal; returns how many rows actually disappeared. */
      async remove(ownerId, placeId) {
        const result = await db.collection(FAVORITES).where({ ownerId, placeId }).remove();
        const removed = result && typeof result.stats === 'object' ? result.stats.removed : 0;
        return { removed };
      },
    },

    corrections: {
      async create(document) {
        const result = await db.collection(CORRECTIONS).add({ data: document });
        return { id: result && result._id ? result._id : null };
      },

      listAll() {
        return sweep(CORRECTIONS);
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
