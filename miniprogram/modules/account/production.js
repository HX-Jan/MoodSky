const { AppError } = require('../../shared/result');
const PENDING_KEY = 'moodsky-production-closure-v1';
const PREFERENCE_KEYS = ['cardTextPreview', 'decorationsEnabled'];
// A preference write is only confirmed by a receipt that echoes the submitted
// field and value. A transport failure and an unusable receipt read the same way
// to the user: the save result is not confirmed yet, and retry() replays the
// exact request instead of asking them to choose again.
const PREFERENCE_UNCONFIRMED = '偏好保存结果尚未确认，请重试原操作。';

function exportState(job) {
  const labels = {
    ready: '可领取',
    expired: '已过期',
    failed: '失败',
    pending: '处理中',
    processing: '处理中',
  };
  return labels[job?.state] || '';
}

// Only a write whose request is still queued may be described as retryable. A
// server-side rejection clears the queue, so it must read as "not saved" instead
// of inviting a retry that has nothing left to replay.
function preferenceNotice(error, queued) {
  if (!queued) {
    return error.message || '偏好未保存，请重新选择。';
  }
  if (/尚未确认/.test(error.message || '')) {
    return error.message;
  }
  return PREFERENCE_UNCONFIRMED;
}

function exportNotice(job) {
  if (job?.state === 'ready') {
    return '导出已就绪，可领取文件或查看内容。';
  }
  if (job?.state === 'expired') {
    return '导出已过期，请保留所选格式并重新申请。';
  }
  if (job?.state === 'failed') {
    return '导出失败，请保留所选格式并重新申请。';
  }
  return '导出仍在处理中。';
}
function createProductionAccountController({
  service,
  storage,
  session,
  publish,
  onClosed = () => {},
}) {
  let disposed = false;
  let suspended = false;
  let sequence = 0;
  let clearingForClose = false;
  let binding = session.capture();
  let closureScope = null;
  const state = {
    authenticated: false,
    busy: false,
    preferences: {},
    exportJob: null,
    closure: null,
    notice: '',
    pendingKind: '',
    exportFormat: 'json',
    exportStateLabel: '',
  };
  let pending = null;
  const update = (patch) => {
    Object.assign(state, patch);
    if (!disposed && !suspended) {
      publish({ ...state });
    }
  };
  const unsubscribe = session.subscribe(() => {
    const previous = binding;
    binding = session.capture();
    if ((clearingForClose && !binding) || (!previous && !closureScope)) {
      return;
    }
    // Includes null -> a new login while a deliberately signed-out close is pending.
    sequence++;
    pending = null;
    closureScope = null;
    update({
      authenticated: false,
      busy: false,
      preferences: {},
      exportJob: null,
      exportStateLabel: '',
      closure: null,
      pendingKind: '',
      notice: '账号状态已变化，请重新载入。',
    });
  });
  function revokeForClose(scope) {
    const current = session.capture();
    if (current && current.scope !== scope) {
      throw new AppError('UNAUTHENTICATED', '请使用原账号恢复注销操作。');
    }
    if (current) {
      clearingForClose = true;
      try {
        session.clear();
      } finally {
        clearingForClose = false;
      }
    }
  }
  function readClosure(scope) {
    const latest = storage.getStorageSync(PENDING_KEY);
    if (!scope) {
      return latest;
    }
    const scoped = storage.getStorageSync(PENDING_KEY + ':' + scope);
    return scoped?.scope === scope ? scoped : latest?.scope === scope ? latest : null;
  }
  function saveClosure(value) {
    // Preserve the previous v1 entry before another account replaces the last-used pointer.
    const latest = storage.getStorageSync(PENDING_KEY);
    if (latest?.scope && latest.scope !== value.scope) {
      storage.setStorageSync(PENDING_KEY + ':' + latest.scope, latest);
    }
    storage.setStorageSync(PENDING_KEY + ':' + value.scope, value);
    storage.setStorageSync(PENDING_KEY, value);
  }
  async function run(work) {
    if (state.busy || disposed || suspended) {
      return false;
    }
    const token = ++sequence;
    const isCurrent = () => !disposed && !suspended && token === sequence;
    update({ busy: true, notice: '' });
    try {
      await work(isCurrent);
      return true;
    } catch (error) {
      if (isCurrent()) {
        // Capture the kind before the INVALID_INPUT/CONFLICT branch clears pending.
        const preferencePending = pending?.kind === 'preferences';
        const invalidated = ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(
          error.code,
        );
        if (pending?.kind !== 'close' && ['INVALID_INPUT', 'CONFLICT'].includes(error.code)) {
          pending = null;
          update({ pendingKind: '' });
        }
        if (invalidated && session.capture()) {
          session.clear();
        }
        if (isCurrent()) {
          update({
            notice: invalidated
              ? error.message || '操作结果未确认，请重试原操作。'
              : preferencePending
                ? preferenceNotice(error, pending?.kind === 'preferences')
                : error.message || '操作结果未确认，请重试原操作。',
            ...(invalidated ? { authenticated: false, preferences: {}, exportJob: null } : {}),
          });
        }
      }
      return false;
    } finally {
      if (isCurrent()) {
        update({ busy: false });
      }
    }
  }
  function closed(result, operation) {
    const data = result?.data;
    if (
      result?.ok !== true ||
      data?.accountStatus !== 'disabled' ||
      !data.cleanup?.jobId ||
      typeof data.receipt !== 'string' ||
      !data.receipt
    ) {
      throw new AppError('INVALID_RESPONSE', '注销响应尚未确认，请重试原操作。');
    }
    const saved = {
      request: operation.request,
      scope: operation.scope,
      jobId: data.cleanup.jobId,
      receipt: data.receipt,
      state: data.cleanup.state,
    };
    saveClosure(saved);
    clearLocalCheckin(operation.scope);
    pending = null;
    closureScope = operation.scope;
    update({
      authenticated: false,
      preferences: {},
      exportJob: null,
      exportStateLabel: '',
      closure: data.cleanup,
      pendingKind: '',
      notice: '账号已停用。清理进度以服务器返回为准。',
    });
  }
  function clearLocalCheckin(scope) {
    try {
      onClosed(scope);
    } catch {
      throw new AppError('CONFLICT', '账号已停用，本机待确认操作暂未清除，请重试查询。');
    }
  }
  async function dispatch(isCurrent) {
    const operation = pending;
    if (operation.kind === 'close') {
      revokeForClose(operation.scope);
    }
    if (!isCurrent()) {
      return;
    }
    const response =
      operation.kind === 'close'
        ? await service.recoverClose(operation.request, operation.scope)
        : await service.submit(operation.request);
    if (!isCurrent()) {
      return;
    }
    if (operation.kind === 'close') {
      closed(response, operation);
      return;
    }
    if (operation.kind === 'preferences') {
      const preferences = response?.data;
      const requested = operation.request.payload;
      if (
        response?.ok !== true ||
        !PREFERENCE_KEYS.every(
          (key) =>
            typeof preferences?.[key] === 'boolean' &&
            (!Object.hasOwn(requested, key) || preferences[key] === requested[key]),
        )
      ) {
        throw new AppError('INVALID_RESPONSE', PREFERENCE_UNCONFIRMED);
      }
      pending = null;
      update({ preferences, pendingKind: '', notice: '偏好已保存到云端。' });
    } else {
      pending = null;
      update({
        exportJob: response.data,
        exportStateLabel: exportState(response.data),
        pendingKind: '',
        notice: exportNotice(response.data),
      });
    }
  }
  function checkedExportStatus(result, job) {
    const data = result?.data;
    if (
      result?.ok !== true ||
      data?.jobId !== job.jobId ||
      !['pending', 'processing', 'ready', 'expired', 'failed'].includes(data.state) ||
      (data.format !== undefined &&
        (!['json', 'markdown'].includes(data.format) ||
          (job.format !== undefined && data.format !== job.format)))
    ) {
      throw new AppError('INVALID_RESPONSE', '导出状态尚未确认，请重新查询。');
    }
    const format = data.format ?? job.format;
    return { jobId: job.jobId, state: data.state, ...(format ? { format } : {}) };
  }
  const requestExport = (format = state.exportFormat) =>
    run(async (isCurrent) => {
      if (pending || !state.authenticated || !['json', 'markdown'].includes(format)) {
        return;
      }
      update({ exportFormat: format });
      pending = { kind: 'export', request: service.createExport(format) };
      update({ pendingKind: 'export', exportJob: null, exportStateLabel: '' });
      await dispatch(isCurrent);
    });
  return {
    getWorkStatus: () => ({ draft: false, pending: !disposed && (!!pending || state.busy) }),
    load: () =>
      run(async (isCurrent) => {
        let authenticated;
        if (!session.capture()) {
          // A cold start may restore a different remembered login than the last close.
          authenticated = await service.authenticate();
          if (!isCurrent()) {
            return;
          }
        }
        const saved = readClosure(session.capture()?.scope);
        if (saved?.request && typeof saved.scope === 'string') {
          closureScope = saved.scope;
          update({ authenticated: false, preferences: {}, exportJob: null, closure: null });
          if (saved.receipt && saved.jobId) {
            revokeForClose(saved.scope);
            if (!isCurrent()) {
              return;
            }
            pending = null;
            update({
              pendingKind: '',
              closure: { jobId: saved.jobId, state: saved.state || 'pending' },
              notice: '已有注销申请，可继续查询清理状态。',
            });
          } else {
            pending = { kind: 'close', request: saved.request, scope: saved.scope };
            update({ pendingKind: 'close', notice: '上次注销结果未确认，请重试原注销操作。' });
          }
          return;
        }
        if (!(authenticated ?? (await service.authenticate()))) {
          throw new AppError('UNAUTHENTICATED', '无法验证账号，请稍后重新进入。');
        }
        if (!isCurrent()) {
          return;
        }
        const result = await service.preferences();
        if (isCurrent()) {
          update({ authenticated: true, preferences: result.data, notice: '' });
        }
      }),
    savePreference: (key, value) =>
      run(async (isCurrent) => {
        if (
          pending ||
          !state.authenticated ||
          !PREFERENCE_KEYS.includes(key) ||
          typeof value !== 'boolean'
        ) {
          return;
        }
        pending = {
          kind: 'preferences',
          request: service.createPreferences({ operation: 'set', [key]: value }),
        };
        // The confirmed state stays on the server truth: an unconfirmed write must
        // not look saved locally. The unsent request stays in `pending`, so retry()
        // replays the user's exact choice instead of asking them to pick again.
        update({ pendingKind: 'preferences' });
        await dispatch(isCurrent);
      }),
    setExportFormat: (format) => {
      if (['json', 'markdown'].includes(format) && !state.busy && !pending) {
        update({ exportFormat: format });
      }
    },
    requestExport,
    reapplyExport(jobId) {
      const job = state.exportJob;
      if (job?.jobId === jobId && ['expired', 'failed'].includes(job.state)) {
        return requestExport(job.format || state.exportFormat);
      }
    },
    refreshExport: async () => {
      if (pending) {
        return false;
      }
      return run(async (isCurrent) => {
        if (!state.exportJob || !state.authenticated) {
          return;
        }
        const job = state.exportJob;
        const result = await service.exportStatus(job.jobId);
        if (isCurrent()) {
          const exportJob = checkedExportStatus(result, job);
          update({
            exportJob,
            exportStateLabel: exportState(exportJob),
            notice: exportNotice(exportJob),
          });
        }
      });
    },
    download: async (saveFile) => {
      if (pending) {
        return false;
      }
      return run(async (isCurrent) => {
        if (!state.authenticated || state.exportJob?.state !== 'ready') {
          return;
        }
        const job = state.exportJob;
        let result;
        try {
          result = await service.download(job.jobId);
        } catch (error) {
          if (!isCurrent()) {
            return;
          }
          if (error.code !== 'CONFLICT') {
            throw error;
          }
          // A conflict may also mean an unready or corrupt artifact. Ask the
          // server for its current state instead of inventing an expired one.
          const status = await service.exportStatus(job.jobId);
          if (isCurrent()) {
            const exportJob = checkedExportStatus(status, job);
            update({
              exportJob,
              exportStateLabel: exportState(exportJob),
              notice:
                exportJob.state === 'ready'
                  ? '领取未完成，服务状态仍为可领取。可重试保存或重新申请。'
                  : exportNotice(exportJob),
            });
          }
          return;
        }
        if (!isCurrent()) {
          return;
        }
        if (
          typeof result.data?.jobId !== 'string' ||
          result.data.jobId !== state.exportJob.jobId ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(result.data.jobId) ||
          typeof result.data.content !== 'string' ||
          result.data.extension !== (job.format === 'markdown' ? 'md' : 'json')
        ) {
          throw new AppError('INVALID_RESPONSE', '导出文件响应无效。');
        }
        const notice = await saveFile(result.data);
        if (isCurrent()) {
          update({ notice: notice || '已领取导出文件。' });
        }
      });
    },
    close: () =>
      run(async (isCurrent) => {
        if (pending || !state.authenticated) {
          return;
        }
        const scope = session.capture()?.scope;
        if (!scope) {
          throw new AppError('UNAUTHENTICATED', '请重新登录后再注销。');
        }
        pending = { kind: 'close', request: service.createClose(), scope };
        closureScope = scope;
        // Persist only the original operation and account binding before the first send.
        // Replaying after another WeChat identity appears fails at the server scope gate.
        saveClosure({ request: pending.request, scope });
        update({
          pendingKind: 'close',
          authenticated: false,
          preferences: {},
          exportJob: null,
          exportStateLabel: '',
        });
        await dispatch(isCurrent);
      }),
    retry: () =>
      run(async (isCurrent) => {
        if (pending) {
          await dispatch(isCurrent);
        }
      }),
    cleanupStatus: () =>
      run(async (isCurrent) => {
        const saved = closureScope ? readClosure(closureScope) : null;
        if (!saved?.jobId || !saved.receipt) {
          return;
        }
        let result;
        try {
          result = await service.cleanupStatus(saved.jobId, saved.receipt);
        } catch (error) {
          if (!isCurrent()) {
            return;
          }
          if (error.code !== 'FORBIDDEN') {
            throw error;
          }
          // Refresh a short-lived progress receipt under the original identity binding.
          const recovered = await service.recoverClose(saved.request, saved.scope);
          if (!isCurrent()) {
            return;
          }
          closed(recovered, saved);
          const refreshed = readClosure(saved.scope);
          result = await service.cleanupStatus(refreshed.jobId, refreshed.receipt);
        }
        if (isCurrent()) {
          if (
            result.data?.jobId !== saved.jobId ||
            !['pending', 'processing', 'completed'].includes(result.data.state)
          ) {
            throw new AppError('INVALID_RESPONSE', '清理进度响应无效。');
          }
          clearLocalCheckin(saved.scope);
          saveClosure({ ...readClosure(saved.scope), state: result.data.state });
          update({
            closure: result.data,
            notice:
              result.data.state === 'completed'
                ? '服务器已完成私人数据清理。'
                : '服务器正在清理，可继续查询。',
          });
        }
      }),
    suspend() {
      suspended = true;
      sequence++;
      state.busy = false;
    },
    resume() {
      suspended = false;
      update({});
      return { ...state };
    },
    dispose() {
      disposed = true;
      sequence++;
      pending = null;
      unsubscribe();
    },
  };
}
module.exports = { createProductionAccountController, PENDING_KEY, exportNotice, exportState };
