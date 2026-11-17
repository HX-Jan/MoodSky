// W6XY: SIMULATED WX-shaped database for local export/cleanup verification.
// No SDK, no network, no real user data. Serialized copy-on-write transactions
// mirror tests/helpers/w2-database.js and additionally support the query shape
// the production maintenance worker needs (lte) and the cleanup tick (in).
const clone = (value) => globalThis.structuredClone(value);
const KEY_SEPARATOR = ':';

function operatorFilter(value, row) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return row === value;
  }
  const ops = Object.keys(value);
  if (ops.length !== 1) {
    throw new Error('Unsupported fixture operator set: ' + ops.join(','));
  }
  const [op] = ops;
  const target = value[op];
  if (op === '$gt') {
    return row > target;
  }
  if (op === '$gte') {
    return row >= target;
  }
  if (op === '$lte') {
    return row <= target;
  }
  if (op === '$lt') {
    return row < target;
  }
  if (op === '$in') {
    if (!Array.isArray(target)) {
      throw new Error('$in expects an array');
    }
    return target.includes(row);
  }
  if (op === '$eq') {
    return row === target;
  }
  throw new Error('Unsupported fixture operator: ' + op);
}

function createMemoryDatabase(seed = {}) {
  let store = clone(seed);
  let queue = Promise.resolve();
  let serial = 0;
  const calls = [];

  function rowsOf(table, collection) {
    const prefix = collection + KEY_SEPARATOR;
    return Object.keys(table)
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key, row: table[key] }));
  }

  function collection(name, draft, transactional) {
    const table = () => draft || store;
    const record = (operation, id) =>
      calls.push({ operation, collection: name, id, transactional });

    const reference = {
      where(filter) {
        let limit = 100;
        let ordered = false;
        let projection = null;
        const query = {
          limit(value) {
            limit = value;
            return query;
          },
          field(value) {
            projection = value;
            return query;
          },
          orderBy(key, direction) {
            if (key !== '_id' || direction !== 'asc') {
              throw new Error('Unsupported fixture order: ' + key + ' ' + direction);
            }
            ordered = true;
            return query;
          },
          async get() {
            record('query');
            let rows = rowsOf(table(), name)
              .map(({ row }) => row)
              .filter((row) =>
                Object.entries(filter).every(([key, value]) => operatorFilter(value, row[key])),
              );
            if (ordered) {
              rows = rows.sort((a, b) => String(a._id).localeCompare(String(b._id)));
            }
            rows = rows.slice(0, limit);
            if (projection) {
              rows = rows.map((row) =>
                Object.fromEntries(Object.entries(row).filter(([key]) => projection[key] === true)),
              );
            }
            return { data: clone(rows) };
          },
        };
        return query;
      },
      async add({ data }) {
        record('add');
        const id = 'add_' + ++serial;
        table()[name + KEY_SEPARATOR + id] = { ...clone(data), _id: id };
        return { _id: id };
      },
      doc(id) {
        const key = name + KEY_SEPARATOR + id;
        return {
          async get() {
            record('get', id);
            return { data: clone(table()[key] || null) };
          },
          async set({ data }) {
            record('set', id);
            table()[key] = { ...clone(data), _id: id };
            return { stats: { updated: 1 } };
          },
          async update({ data }) {
            record('update', id);
            if (!table()[key]) {
              return { stats: { updated: 0 } };
            }
            Object.assign(table()[key], clone(data));
            return { stats: { updated: 1 } };
          },
          async remove() {
            record('remove', id);
            const exists = Boolean(table()[key]);
            delete table()[key];
            return { stats: { removed: exists ? 1 : 0 } };
          },
        };
      },
    };
    return reference;
  }

  const db = {
    config: { throwOnNotFound: false },
    command: {
      gt: (value) => ({ $gt: value }),
      gte: (value) => ({ $gte: value }),
      lt: (value) => ({ $lt: value }),
      lte: (value) => ({ $lte: value }),
      in: (values) => ({ $in: values }),
    },
    // Deterministic server timestamp so every run is reproducible.
    serverDate: () => '2026-11-17T02:00:00.000Z',
    collection: (name) => collection(name, null, false),
    runTransaction(work) {
      const result = queue.then(async () => {
        const draft = clone(store);
        const value = await work({ collection: (name) => collection(name, draft, true) });
        store = draft;
        return value;
      });
      queue = result.catch(() => {});
      return result;
    },
  };

  return {
    db,
    calls,
    inspect: () => clone(store),
    put(collectionName, row) {
      store[collectionName + KEY_SEPARATOR + row._id] = clone(row);
    },
  };
}

module.exports = { createMemoryDatabase };
