// Public native SDK -> existing WX-shaped repositories. No SDK initialization here.
const COLLECTIONS = new Set([
  'accounts',
  'journals',
  'preferences',
  'month_decorations',
  'places',
  'favorites',
  'place_checkins',
  'campus_checkin_states',
  'place_corrections',
  'support_resources',
  'task_templates',
  'task_history',
  'export_jobs',
  'cleanup_jobs',
  'request_receipts',
  'deletion_markers',
  'operator_roles',
]);
async function checked(operation) {
  const result = await operation;
  if (result?.code) {
    const error = new Error('Database operation failed.');
    error.code = result.code;
    throw error;
  }
  return result;
}
function createProductionDatabase(native) {
  if (
    !native ||
    typeof native.runTransaction !== 'function' ||
    typeof native.collection !== 'function'
  ) {
    throw new TypeError('An initialized native CloudBase database is required.');
  }
  const query = (ref) => ({
    get: () => checked(ref.get()),
    where: (filter) => query(ref.where(filter)),
    limit: (count) => query(ref.limit(count)),
    skip: (count) => query(ref.skip(count)),
    orderBy: (field, direction) => query(ref.orderBy(field, direction)),
    field: (fields) => query(ref.field(fields)),
  });
  function collection(source, name, transactional) {
    if (!COLLECTIONS.has(name)) {
      throw new TypeError('Unknown production collection.');
    }
    const ref = source.collection(name);
    return {
      ...(transactional ? {} : query(ref)),
      doc(id) {
        const document = ref.doc(id);
        return {
          async get() {
            const result = await checked(document.get());
            if (Array.isArray(result.data)) {
              if (result.data.length > 1) {
                throw new Error('Invalid document response.');
              }
              return { data: result.data[0] || null };
            }
            return { data: result.data || null };
          },
          set: ({ data }) => checked(document.set(data)),
          async update({ data }) {
            const result = await checked(document.update(data));
            return { stats: { updated: result.updated } };
          },
          async remove() {
            const result = await checked(transactional ? document.delete() : document.remove());
            return { stats: { removed: result.deleted } };
          },
        };
      },
    };
  }
  return {
    config: { throwOnNotFound: false },
    command: native.command,
    serverDate: (options) => native.serverDate(options),
    collection: (name) => collection(native, name, false),
    runTransaction: (work) =>
      native.runTransaction((tx) => work({ collection: (name) => collection(tx, name, true) })),
  };
}
module.exports = { createProductionDatabase };
