const { AppError } = require('../../shared/result');
const PENDING_KEY = 'moodsky-production-closure-v1';
function createProductionAccountController({ service, storage, session, publish }) {
  let disposed = false;
  let sequence = 0;
  const state = {
    authenticated: false,
    busy: false,
    preferences: {},
    exportJob: null,
    closure: null,
    notice: '',
    pendingKind: '',
  };
  let pending = null;
  const update = (patch) => {
    Object.assign(state, patch);
    if (!disposed) {
      publish({ ...state });
    }
  };
  function saveClosure(value) {
    storage.setStorageSync(PENDING_KEY, value);
  }
  async function run(work) {
    if (state.busy || disposed) {
      return false;
    }
    const token = ++sequence;
    update({ busy: true, notice: '' });
    try {
      await work(() => !disposed && token === sequence);
      return true;
    } catch (error) {
      if (!disposed && token === sequence) {
        const invalidated = ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN'].includes(
          error.code,
        );
        if (pending?.kind !== 'close' && ['INVALID_INPUT', 'CONFLICT'].includes(error.code)) {
          pending = null;
          update({ pendingKind: '' });
        }
        if (invalidated) {
          session.clear();
        }
        update({
          notice: error.message || '操作结果未确认，请重试原操作。',
          ...(invalidated ? { authenticated: false, preferences: {}, exportJob: null } : {}),
        });
      }
      return false;
    } finally {
      if (!disposed && token === sequence) {
        update({ busy: false });
      }
    }
  }
  function closed(result) {
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
      ...storage.getStorageSync(PENDING_KEY),
      jobId: data.cleanup.jobId,
      receipt: data.receipt,
      state: data.cleanup.state,
    };
    saveClosure(saved);
    pending = null;
    session.clear();
    update({
      authenticated: false,
      preferences: {},
      exportJob: null,
      closure: data.cleanup,
      pendingKind: '',
      notice: '账号已停用。清理进度以服务器返回为准。',
    });
  }
  async function dispatch(isCurrent) {
    const operation = pending;
    const response =
      operation.kind === 'close'
        ? await service.recoverClose(operation.request, operation.scope)
        : await service.submit(operation.request);
    if (!isCurrent()) {
      return;
    }
    if (operation.kind === 'close') {
      closed(response);
      return;
    }
    pending = null;
    if (operation.kind === 'preferences') {
      update({ preferences: response.data, pendingKind: '', notice: '偏好已保存到云端。' });
    } else {
      update({
        exportJob: response.data,
        pendingKind: '',
        notice: response.data.state === 'ready' ? '导出已就绪，可保存到本机。' : '导出仍在处理中。',
      });
    }
  }
  return {
    load: () =>
      run(async (isCurrent) => {
        const saved = storage.getStorageSync(PENDING_KEY);
        if (saved?.request && typeof saved.scope === 'string') {
          if (saved.receipt && saved.jobId) {
            update({
              closure: { jobId: saved.jobId, state: saved.state || 'pending' },
              notice: '已有注销申请，可继续查询清理状态。',
            });
          } else {
            pending = { kind: 'close', request: saved.request, scope: saved.scope };
            update({ pendingKind: 'close', notice: '上次注销结果未确认，请重试原注销操作。' });
          }
          return;
        }
        if (!(await service.authenticate())) {
          throw new AppError('UNAUTHENTICATED', '无法验证账号，请稍后重新进入。');
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
    requestExport: (format) =>
      run(async (isCurrent) => {
        if (pending || !state.authenticated) {
          return;
        }
        pending = { kind: 'export', request: service.createExport(format) };
        update({ pendingKind: 'export', exportJob: null });
        await dispatch(isCurrent);
      }),
    refreshExport: () =>
      run(async (isCurrent) => {
        if (!state.exportJob || !state.authenticated) {
          return;
        }
        const result = await service.exportStatus(state.exportJob.jobId);
        if (isCurrent()) {
          update({ exportJob: result.data });
        }
      }),
    download: (saveFile) =>
      run(async (isCurrent) => {
        if (!state.authenticated || state.exportJob?.state !== 'ready') {
          return;
        }
        const result = await service.download(state.exportJob.jobId);
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
        // Persist only the original operation and account binding before the first send.
        // Replaying after another WeChat identity appears fails at the server scope gate.
        saveClosure({ request: pending.request, scope });
        session.clear();
        update({ pendingKind: 'close', authenticated: false, preferences: {}, exportJob: null });
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
        const saved = storage.getStorageSync(PENDING_KEY);
        if (!saved?.jobId || !saved.receipt) {
          return;
        }
        let result;
        try {
          result = await service.cleanupStatus(saved.jobId, saved.receipt);
        } catch (error) {
          if (error.code !== 'FORBIDDEN') {
            throw error;
          }
          // Refresh a short-lived progress receipt under the original identity binding.
          const recovered = await service.recoverClose(saved.request, saved.scope);
          if (!isCurrent()) {
            return;
          }
          closed(recovered);
          const refreshed = storage.getStorageSync(PENDING_KEY);
          result = await service.cleanupStatus(refreshed.jobId, refreshed.receipt);
        }
        if (isCurrent()) {
          if (
            result.data?.jobId !== saved.jobId ||
            !['pending', 'processing', 'completed'].includes(result.data.state)
          ) {
            throw new AppError('INVALID_RESPONSE', '清理进度响应无效。');
          }
          saveClosure({ ...storage.getStorageSync(PENDING_KEY), state: result.data.state });
          update({
            closure: result.data,
            notice:
              result.data.state === 'completed'
                ? '服务器已完成私人数据清理。'
                : '服务器正在清理，可继续查询。',
          });
        }
      }),
    dispose() {
      disposed = true;
      sequence++;
      pending = null;
    },
  };
}
module.exports = { createProductionAccountController, PENDING_KEY };
