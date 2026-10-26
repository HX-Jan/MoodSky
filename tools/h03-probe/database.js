const { collections } = require('./config');

// Use the public CloudBase database API, not WX's numeric-error conversion.
// Native document methods may return {code}; throw it before SDK commit/retry.
async function checked(operation) {
  const result = await operation;
  if (result && result.code) {
    const error = new Error('Isolated database operation failed.');
    error.code = result.code;
    throw error;
  }
  return result;
}

function createProbeDatabase(native) {
  if (!native || typeof native.runTransaction !== 'function') {
    throw new TypeError('A public CloudBase database is required.');
  }
  const query = (ref) => ({
    get: () => checked(ref.get()),
    count: () => checked(ref.count()),
    limit: (count) => query(ref.limit(count)),
    remove: async () => {
      const result = await checked(ref.remove());
      return { stats: { removed: result.deleted } };
    },
  });
  const collection = (source, name) => {
    if (!Object.values(collections).includes(name)) {
      throw new Error('Only isolated probe collections are allowed.');
    }
    const ref = source.collection(name);
    return {
      add: ({ data }) => checked(ref.add(data)),
      where: (filter) => query(ref.where(filter)),
      doc: (id) => {
        const document = ref.doc(id);
        return {
          get: () => checked(document.get()),
          set: ({ data }) => checked(document.set(data)),
          update: ({ data }) => checked(document.update(data)),
        };
      },
    };
  };
  return {
    command: native.command,
    collection: (name) => collection(native, name),
    // No outer retry, no message parsing, no numeric-code reclassification.
    runTransaction: (work, retries) =>
      native.runTransaction((tx) => work({ collection: (name) => collection(tx, name) }), retries),
  };
}
module.exports = { createProbeDatabase };
