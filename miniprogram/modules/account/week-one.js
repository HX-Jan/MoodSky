const { DEFAULT_PREFERENCES } = require('../../shared/constants');
const { createAccountCache } = require('../../services/account-cache');
const FORMATS = ['JSON', 'Markdown'];
function createLocalAccount(storage, now = () => Date.now()) {
  const cache = createAccountCache(storage);
  const status = { 'demo-a': 'active', 'demo-b': 'active' };
  cache.switchAccount('demo-a');
  function ensureActive() {
    if (status[cache.accountId()] !== 'active') {
      throw new Error('ACCOUNT_DISABLED');
    }
  }
  function preferences() {
    return { ...DEFAULT_PREFERENCES, ...(cache.read('preferences') || {}) };
  }
  function snapshot() {
    let task = cache.read('exportTask');
    if (task && task.status === 'completed' && now() >= task.expiresAt) {
      task = { ...task, status: 'expired', content: '' };
      cache.write('exportTask', task);
    }
    return {
      accountId: cache.accountId(),
      status: status[cache.accountId()],
      preferences: preferences(),
      exportTask: task,
      closureTask: cache.read('closureTask'),
    };
  }
  return {
    snapshot,
    token: cache.token,
    isCurrent: cache.isCurrent,
    switchAccount(id) {
      cache.switchAccount(id);
      return snapshot();
    },
    savePreference(key, value) {
      ensureActive();
      if (
        !Object.prototype.hasOwnProperty.call(DEFAULT_PREFERENCES, key) ||
        typeof value !== 'boolean'
      ) {
        throw new Error('INVALID_INPUT');
      }
      const next = { ...preferences(), [key]: value };
      cache.write('preferences', next);
      return next;
    },
    startExport(format) {
      ensureActive();
      if (!FORMATS.includes(format)) {
        throw new Error('INVALID_INPUT');
      }
      const task = {
        id: 'local_' + now(),
        format,
        status: 'processing',
        createdAt: now(),
        content: '',
      };
      cache.write('exportTask', task);
      return cache.token();
    },
    completeExport(token, fail = false) {
      if (!cache.isCurrent(token)) {
        return false;
      }
      ensureActive();
      const task = cache.read('exportTask');
      if (!task || task.status !== 'processing') {
        return false;
      }
      const data = {
        source: 'MoodSky synthetic local demo',
        accountId: cache.accountId(),
        preferences: preferences(),
        records: [],
        note: '合成演示账号，不含真实用户日记或云端数据。',
      };
      const content =
        task.format === 'JSON'
          ? JSON.stringify(data, null, 2)
          : '# MoodSky 本地演示导出\n\n账号：' +
            data.accountId +
            '\n\n- 卡片文字预览：' +
            data.preferences.cardTextPreview +
            '\n- 天气装饰：' +
            data.preferences.decorationsEnabled +
            '\n\n合成演示账号；日记记录为空，未读取云端数据。\n';
      cache.write('exportTask', {
        ...task,
        status: fail ? 'failed' : 'completed',
        content: fail ? '' : content,
        expiresAt: now() + 24 * 60 * 60 * 1000,
      });
      return true;
    },
    expireExport() {
      const task = cache.read('exportTask');
      if (task && task.status === 'completed') {
        cache.write('exportTask', { ...task, expiresAt: now() - 1 });
      }
      return snapshot();
    },
    disable() {
      status[cache.accountId()] = 'disabled';
      cache.invalidate();
      return snapshot();
    },
    startClosure() {
      ensureActive();
      cache.invalidate();
      status[cache.accountId()] = 'closing';
      cache.write('closureTask', { status: 'processing', progress: 0 });
      return cache.token();
    },
    advanceClosure(token, progress) {
      if (!cache.isCurrent(token) || status[cache.accountId()] !== 'closing') {
        return false;
      }
      if (![35, 70, 100].includes(progress)) {
        throw new Error('INVALID_INPUT');
      }
      if (progress === 100) {
        cache.invalidate();
        status[cache.accountId()] = 'closed';
      } else {
        cache.write('closureTask', { status: 'processing', progress });
      }
      return true;
    },
    reset() {
      cache.invalidate();
      status[cache.accountId()] = 'active';
      return snapshot();
    },
  };
}
module.exports = { FORMATS, createLocalAccount };
