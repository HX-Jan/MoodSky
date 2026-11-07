// Synchronous JSON-copy storage with the same absent value as wx.getStorageSync.
function createLocalStorage() {
  const values = new Map();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    values,
    getStorageSync: (key) => (values.has(key) ? copy(values.get(key)) : ''),
    setStorageSync: (key, value) => values.set(key, copy(value)),
    removeStorageSync: (key) => values.delete(key),
  };
}
module.exports = { createLocalStorage };
