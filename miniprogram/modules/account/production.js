const { AppError } = require('../../shared/result');
const PENDING_KEY = 'moodsky-production-closure-v1';

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

function exportNotice(job) {
  if (job?.state === 'ready') {
    return '导出已就绪，可保存到本机。';
  }
  if (job?.state === 'expired') {
    return '导出已过期，请保留所选格式并重新申请。';
  }
  if (job?.state === 'failed') {
    return '导出失败，请保留所选格式并重新申请。';
  }
  return '导出仍在处理中。';
}
function createProductionAccountController({ service, storage, session, publish }) {
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
            notice: error.message || '操作结果未确认，请重试原操作。',
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
    pending = null;
    if (operation.kind === 'preferences') {
      update({ preferences: response.data, pendingKind: '', notice: '偏好已保存到云端。' });
    } else {
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
          update({ authenticated: true, preferences: result.data, notice: '已连接私人云端账号。' });
        }
      }),
    savePreference: (key, value) =>
      run(async (isCurrent) => {
        if (
          pending ||
          !state.authenticated ||
          !['cardTextPreview', 'decorationsEnabled'].includes(key) ||
          typeof value !== 'boolean'
        ) {
          return;
        }
        pending = {
          kind: 'preferences',
          request: service.createPreferences({ operation: 'set', [key]: value }),
        };
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
    refreshExport: () =>
      run(async (isCurrent) => {
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
      }),
    download: (saveFile) =>
      run(async (isCurrent) => {
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
          result.data?.jobId !== state.exportJob.jobId ||
          typeof result.data.content !== 'string' ||
          !['json', 'md'].includes(result.data.extension)
        ) {
          throw new AppError('INVALID_RESPONSE', '导出文件响应无效。');
        }
        // Content is never placed in page data or persisted as a reusable cloud URL.
        await saveFile(result.data);
        if (isCurrent()) {
          update({ notice: '导出文件已保存到本机，请妥善保管。' });
        }
      }),
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
