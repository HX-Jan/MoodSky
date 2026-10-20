// SIMULATED database with serialized copy-on-write transactions. No SDK or network.
const clone = (value) => globalThis.structuredClone(value);
function databaseFixture(seed = {}, { fail = () => false } = {}) {
  let store = clone(seed),
    queue = Promise.resolve(),
    serial = 0;
  const calls = [];
  function collection(name, draft, transactional) {
    const table = () => draft || store;
    const check = (operation, id) => {
      calls.push({ operation, collection: name, id, transactional });
      if (fail({ operation, collection: name, id, transactional })) {
        throw new Error('SIMULATED_FAILURE');
      }
    };
    const reference = {
      where(filter) {
        let limit = 100,
          ordered = false;
        const query = {
          limit(value) {
            limit = value;
            return query;
          },
          orderBy(key, direction) {
            if (key !== '_id' || direction !== 'asc') {
              throw new Error('Unsupported fixture order');
            }
            ordered = true;
            return query;
          },
          async get() {
            check('query');
            let rows = Object.entries(table())
              .filter(([key]) => key.startsWith(name + ':'))
              .map(([, row]) => row)
              .filter((row) =>
                Object.entries(filter).every(([key, value]) =>
                  value && typeof value === 'object' && '$gt' in value
                    ? row[key] > value.$gt
                    : row[key] === value,
                ),
              );
            if (ordered) {
              rows = rows.sort((a, b) => a._id.localeCompare(b._id));
            }
            return { data: clone(rows.slice(0, limit)) };
          },
        };
        return query;
      },
      async add({ data }) {
        check('add');
        if (
          name === 'accounts' &&
          Object.values(table()).some((row) => row.openid && row.openid === data.openid)
        ) {
          throw new Error('SIMULATED_UNIQUE_CONFLICT');
        }
        const id = 'synthetic_added_' + ++serial;
        table()[name + ':' + id] = { ...clone(data), _id: id };
        check('addResponse', id);
        return { _id: id };
      },
      doc(id) {
        const key = name + ':' + id;
        return {
          async get() {
            check('get', id);
            return { data: clone(table()[key] || null) };
          },
          async set({ data }) {
            check('set', id);
            table()[key] = { ...clone(data), _id: id };
            return { stats: { updated: 1 } };
          },
          async update({ data }) {
            check('update', id);
            if (!table()[key]) {
              return { stats: { updated: 0 } };
            }
            Object.assign(table()[key], clone(data));
            return { stats: { updated: 1 } };
          },
          async remove() {
            check('remove', id);
            const exists = !!table()[key];
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
    command: { gt: (value) => ({ $gt: value }) },
    serverDate: () => '2026-10-20T00:00:00.000Z',
    collection: (name) => collection(name, null, false),
    runTransaction(work) {
      const result = queue.then(async () => {
        const draft = clone(store);
        const value = await work({ collection: (name) => collection(name, draft, true) });
        if (fail({ operation: 'commit', transactional: true })) {
          throw new Error('SIMULATED_COMMIT_FAILURE');
        }
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
    put(collection, row) {
      store[collection + ':' + row._id] = clone(row);
    },
  };
}
module.exports = { databaseFixture };
