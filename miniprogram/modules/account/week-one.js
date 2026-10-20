const { DEFAULT_PREFERENCES } = require('../../shared/constants');
const { createAccountCache } = require('../../services/account-cache');
const FORMATS = ['JSON', 'Markdown'];
let exportSequence = 0;
function createLocalAccount(storage, now = () => Date.now()) {
  const cache = createAccountCache(storage);
  cache.switchAccount('demo-a');
  function currentStatus() {
    return cache.read('accountStatus') || 'active';
  }
  function setStatus(value) {
    cache.write('accountStatus', value);
  }
  function interrupt() {
    const task = cache.read('exportTask');
    if (task && task.status === 'processing') {
      cache.write('exportTask', { ...task, status: 'failed', content: '', reason: 'interrupted' });
    }
    const closure = cache.read('closureTask');
    if (closure && ['processing', 'failed'].includes(closure.status)) {
      setStatus('disabled');
      cache.write('closureTask', { ...closure, status: 'failed', reason: 'interrupted' });
    }
  }
  // Local timers do not survive page disposal or app restart.
  interrupt();
  function ensureActive() {
    if (currentStatus() !== 'active') {
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
      status: currentStatus(),
      preferences: preferences(),
      exportTask: task,
      closureTask: cache.read('closureTask'),
    };
  }
  return {
    snapshot,
    token: cache.token,
    isCurrent: cache.isCurrent,
    interrupt,
    switchAccount(id) {
      if (!['demo-a', 'demo-b'].includes(id)) {
        throw new Error('INVALID_INPUT');
      }
      if (id !== cache.accountId()) {
        interrupt();
        cache.switchAccount(id);
        interrupt();
      }
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
        id: 'local_' + now() + '_' + ++exportSequence,
        format,
        status: 'processing',
        createdAt: now(),
        content: '',
      };
      cache.write('exportTask', task);
      return { ...cache.token(), exportId: task.id };
    },
    completeExport(token, fail = false) {
      if (!cache.isCurrent(token)) {
        return false;
      }
      ensureActive();
      const task = cache.read('exportTask');
      if (!task || task.status !== 'processing' || token.exportId !== task.id) {
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
      cache.invalidate();
      setStatus('disabled');
      return snapshot();
    },
    startClosure() {
      ensureActive();
      cache.invalidate();
      setStatus('closing');
      cache.write('closureTask', { status: 'processing', progress: 0 });
      return cache.token();
    },
    advanceClosure(token, progress) {
      if (!cache.isCurrent(token) || currentStatus() !== 'closing') {
        return false;
      }
      if (![35, 70, 100].includes(progress)) {
        throw new Error('INVALID_INPUT');
      }
      const previous = cache.read('closureTask');
      if (!previous || previous.status !== 'processing' || progress <= previous.progress) {
        return false;
      }
      if (progress === 100) {
        cache.invalidate();
        setStatus('closed');
      } else {
        cache.write('closureTask', { status: 'processing', progress });
      }
      return true;
    },
    reset() {
      cache.invalidate();
      setStatus('active');
      return snapshot();
    },
  };
}
module.exports = { FORMATS, createLocalAccount };
