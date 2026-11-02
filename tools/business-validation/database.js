// Isolated mapping for one fixed synthetic batch. No business collection access.
const config = require('./config');
const MAP = Object.freeze({
  accounts: config.collections.accounts,
  journals: config.collections.journals,
  request_receipts: config.collections.receipts,
  deletion_markers: config.collections.deletions,
  task_history: config.collections.deletions,
  task_templates: config.collections.accounts,
});
function createValidationDatabase(native, scope = config) {
  const checked = async (operation) => {
    const result = await operation;
    if (result?.code) {
      const error = new Error('Isolated storage failed');
      error.code = result.code;
      throw error;
    }
    return result;
  };
  // Scope comes from a server-owned fixed config, never from a request payload.
  const stamp = { probeTag: scope.tag, runId: scope.runId };
  const row = (value) => {
    if (!value) {
      return null;
    }
    if (value.probeTag !== scope.tag || value.runId !== scope.runId) {
      throw new Error('Foreign validation row');
    }
    return value;
  };
  const query = (ref) => ({
    async get() {
      const result = await checked(ref.get());
      if (!Array.isArray(result.data)) {
        throw new Error('Invalid scan');
      }
      return { ...result, data: result.data.map(row) };
    },
    limit: (count) => query(ref.limit(count)),
    orderBy: (field, direction) => query(ref.orderBy(field, direction)),
    field: (fields) => query(ref.field({ ...fields, probeTag: true, runId: true })),
  });
  const collection = (source, name, transactional) => {
    if (
      !Object.hasOwn(MAP, name) ||
      (scope.allowedCollections && !scope.allowedCollections.includes(name))
    ) {
      throw new Error('Business collections are prohibited');
    }
    const ref = source.collection(MAP[name]);
    return {
      where(filter) {
        if (transactional) {
          throw new Error('Only deterministic document operations in transactions');
        }
        return query(ref.where(native.command.and([stamp, filter])));
      },
      doc(id) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
          throw new Error('Invalid validation document');
        }
        const doc = ref.doc(id);
        const get = async () => {
          const result = await checked(doc.get());
          if (Array.isArray(result.data) && result.data.length > 1) {
            throw new Error('Invalid document response');
          }
          return { data: row(Array.isArray(result.data) ? result.data[0] : result.data) };
        };
        return {
          get,
          async set({ data }) {
            if (!transactional) {
              throw new Error('Writes must be transactional');
            }
            await get();
            return checked(doc.set({ ...data, ...stamp }));
          },
          async update({ data }) {
            if (!transactional) {
              throw new Error('Writes must be transactional');
            }
            if (!(await get()).data) {
              throw new Error('Missing validation row');
            }
            const result = await checked(doc.update({ ...data, ...stamp }));
            return { stats: { updated: result.updated } };
          },
        };
      },
    };
  };
  return {
    config: { throwOnNotFound: false },
    command: native.command,
    serverDate: (options) => native.serverDate(options),
    collection: (name) => collection(native, name, false),
    runTransaction: (work, retries) =>
      native.runTransaction(
        (tx) => work({ collection: (name) => collection(tx, name, true) }),
        retries,
      ),
  };
}
module.exports = { createValidationDatabase };
