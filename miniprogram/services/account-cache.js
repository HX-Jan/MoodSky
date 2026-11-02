const PREFIX = 'moodsky:week1:demo:';
const OWNED = ['preferences', 'exportTask', 'closureTask', 'health', 'accountStatus'];
function createAccountCache(storage) {
  let accountId = null;
  let epoch = 0;
  function key(name) {
    if (!accountId || !OWNED.includes(name)) {
      throw new Error('INVALID_CACHE_SCOPE');
    }
    return PREFIX + accountId + ':' + name;
  }
  function invalidate() {
    if (accountId) {
      OWNED.forEach((name) => storage.removeStorageSync(key(name)));
    }
    epoch += 1;
  }
  return {
    switchAccount(id) {
      if (!['demo-a', 'demo-b'].includes(id)) {
        throw new Error('INVALID_DEMO_ACCOUNT');
      }
      if (accountId !== id) {
        epoch += 1;
        accountId = id;
      }
    },
    read(name) {
      return storage.getStorageSync(key(name)) || null;
    },
    write(name, value) {
      storage.setStorageSync(key(name), value);
    },
    invalidate,
    token() {
      return { accountId, epoch };
    },
    isCurrent(token) {
      return token.accountId === accountId && token.epoch === epoch;
    },
    accountId() {
      return accountId;
    },
  };
}
module.exports = { PREFIX, OWNED, createAccountCache };
