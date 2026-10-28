// In-memory stand-in for cloudfunctions/moodsky/repositories.js.
//
// The campus/admin handlers only ever touch this shape, so the policy can be
// tested without CloudBase. Every method mirrors the cloud implementation's
// contract: listAll() resolves to { rows, truncated }.
function createMemoryRepositories(seed = {}) {
  let counter = 0;
  const nextId = (prefix) => {
    counter += 1;
    return prefix + '_' + counter;
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));

  const places = (seed.places || []).map((row) => ({ _id: nextId('doc'), ...copy(row) }));
  const favorites = (seed.favorites || []).map((row) => ({ _id: nextId('fav'), ...copy(row) }));
  const corrections = (seed.corrections || []).map((row) => ({ _id: nextId('cor'), ...copy(row) }));
  const supportResources = (seed.supportResources || []).map((row) => ({
    _id: nextId('res'),
    ...copy(row),
  }));
  const taskTemplates = (seed.taskTemplates || []).map((row) => ({
    _id: nextId('tpl'),
    ...copy(row),
  }));

  const writeLog = [];
  let placeQueue = Promise.resolve();

  return {
    // Exposed for assertions only; handlers never see it.
    _state: { places, favorites, corrections, supportResources, taskTemplates, writeLog },

    places: {
      async listAll() {
        return { rows: places.map(copy), truncated: false };
      },
      async findByPlaceId(placeId) {
        const found = places.find((row) => row.placeId === placeId);
        return found ? copy(found) : null;
      },
      updateById(id, buildChanges) {
        const pending = placeQueue.then(() => {
          const found = places.find((row) => row._id === id);
          const changes = buildChanges(found ? copy(found) : null);
          if (!found) {
            return { updated: 0 };
          }
          Object.assign(found, copy(changes));
          writeLog.push({ collection: 'places', id, changes: copy(changes) });
          return { updated: 1, changes: copy(changes) };
        });
        placeQueue = pending.catch(() => {});
        return pending;
      },
    },

    favorites: {
      async listByOwner(ownerId) {
        return {
          rows: favorites.filter((row) => row.ownerId === ownerId).map(copy),
          truncated: false,
        };
      },
      async findByOwnerAndPlace(ownerId, placeId) {
        const found = favorites.find((row) => row.ownerId === ownerId && row.placeId === placeId);
        return found ? copy(found) : null;
      },
      async add(ownerId, placeId, createdAt) {
        const existing = favorites.find(
          (row) => row.ownerId === ownerId && row.placeId === placeId,
        );
        if (existing) {
          // Same behaviour as the unique key [ownerId, placeId] in the cloud.
          return { id: existing._id, duplicated: true };
        }
        const row = { _id: nextId('fav'), ownerId, placeId, createdAt };
        favorites.push(row);
        return { id: row._id, duplicated: false };
      },
      async remove(ownerId, placeId) {
        const index = favorites.findIndex(
          (row) => row.ownerId === ownerId && row.placeId === placeId,
        );
        if (index < 0) {
          return { removed: 0 };
        }
        favorites.splice(index, 1);
        return { removed: 1 };
      },
    },

    corrections: {
      async create(document) {
        const row = { _id: nextId('cor'), ...copy(document) };
        corrections.push(row);
        return { id: row._id };
      },
      async listAll() {
        return { rows: corrections.map(copy), truncated: false };
      },
    },

    supportResources: {
      async listAll() {
        return { rows: supportResources.map(copy), truncated: false };
      },
    },

    taskTemplates: {
      async listAll() {
        return { rows: taskTemplates.map(copy), truncated: false };
      },
    },
  };
}

module.exports = { createMemoryRepositories };
