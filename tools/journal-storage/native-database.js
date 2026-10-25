// Explicit server-side candidate. No SDK initialization or network work on import.
const COLLECTIONS = new Set([
  'accounts',
  'journals',
  'request_receipts',
  'deletion_markers',
  'month_decorations',
  'task_templates',
]);
async function checked(operation) {
  const result = await operation;
  if (result && result.code) {
    const error = new Error('Database operation failed.');
    error.code = result.code;
    throw error;
  }
  return result;
}
function createNativeJournalDatabase(native, { taskHistoryEnabled = false } = {}) {
  if (
    !native ||
    typeof native.runTransaction !== 'function' ||
    typeof native.collection !== 'function'
  ) {
    throw new TypeError('Inject a public CloudBase native database.');
  }
  const query = (ref) => ({
    get: () => checked(ref.get()),
    limit: (count) => query(ref.limit(count)),
    orderBy: (field, direction) => query(ref.orderBy(field, direction)),
    field: (fields) => query(ref.field(fields)),
  });
  const collection = (source, name) => {
    if (!COLLECTIONS.has(name) && !(taskHistoryEnabled === true && name === 'task_history')) {
      throw new Error('Unsupported journal candidate collection.');
    }
    const ref = source.collection(name);
    return {
      where: (filter) => query(ref.where(filter)),
      add: async ({ data }) => {
        const result = await checked(ref.add(data));
        return { _id: result.id };
      },
      doc: (id) => {
        const document = ref.doc(id);
        return {
          get: async () => {
            const result = await checked(document.get());
            if (Array.isArray(result.data)) {
              if (result.data.length > 1) {
                throw new Error('Invalid document response.');
              }
              return { data: result.data[0] || null };
            }
            return { data: result.data };
          },
          set: ({ data }) => checked(document.set(data)),
          update: async ({ data }) => {
            const result = await checked(document.update(data));
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
    collection: (name) => collection(native, name),
    runTransaction: (work, retries) =>
      native.runTransaction((tx) => work({ collection: (name) => collection(tx, name) }), retries),
  };
}
module.exports = { createNativeJournalDatabase };
