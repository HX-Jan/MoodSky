const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
} = require('../../modules/share/app-share');
const api = require('../../services/api');
const environment = require('../../config/environment.local');
const { cloudSessionState } = require('../../services/session-state');
const { ensureCloudSession } = require('../../modules/account/cloud-session');
const { createProductionAccountController } = require('../../modules/account/production');
const { clientCapabilities } = require('../../modules/system/capabilities');
const { AppError } = require('../../shared/result');
Page({
  ...createAppShare({ route: 'pages/account/index' }),
  data: {
    authenticated: false,
    busy: false,
    preferences: {},
    exportJob: null,
    exportFormat: 'json',
    exportStateLabel: '',
    closure: null,
    pendingKind: '',
    notice: '',
  },
  onLoad(options = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/account/index',
        options,
      )
    ) {
      return;
    }
    this._disposed = false;
    this._exportSaveToken = null;
    this._capabilities = clientCapabilities(environment);
    if (this._capabilities.accountData.state !== 'available') {
      this.setData({ notice: this._capabilities.accountData.description });
      return;
    }
    const call = (action, payload) => api.call(api.createRequest(action, payload));
    this._controller = createProductionAccountController({
      storage: wx,
      session: cloudSessionState,
      publish: (patch) => this.setData(patch),
      service: {
        authenticate: ensureCloudSession,
        preferences: () => call('account.preferences', { operation: 'get' }),
        createPreferences: (input) => api.createRequest('account.preferences', input),
        createExport: (format) => api.createRequest('account.requestExport', { format }),
        createClose: () => api.createRequest('account.close', { confirm: 'CLOSE' }),
        submit: api.call,
        exportStatus: (jobId) => call('account.exportStatus', { jobId }),
        download: (jobId) => call('account.downloadExport', { jobId }),
        cleanupStatus: (jobId, receipt) => call('account.cleanupStatus', { jobId, receipt }),
        recoverClose: (request, scope) =>
          api
            .createApiClient(wx, environment, {
              sessionState: { capture: () => ({ scope }), getGeneration: () => 0 },
            })
            .call(request),
      },
    });
    this._controller.load();
  },
  onShow() {
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    enableAppShare(wx);
    this._hidden = false;
    const state = this._controller?.resume();
    if (state && !state.busy && !state.authenticated && !state.pendingKind && !state.closure) {
      this._controller.load();
    }
  },
  onHide() {
    this._hidden = true;
    this._exportSaveToken = null;
    this._closeConfirmation = null;
    this._controller?.suspend();
  },
  onUnload() {
    this._disposed = true;
    this._exportSaveToken = null;
    this._closeConfirmation = null;
    this._controller?.dispose();
  },
  onReload() {
    this._controller?.load();
  },
  onPreference(event) {
    this._controller?.savePreference(event.currentTarget.dataset.key, event.detail.value);
  },
  onExport(event) {
    this._controller?.requestExport(event.currentTarget?.dataset?.format);
  },
  onExportFormat(event) {
    this._controller?.setExportFormat(event.currentTarget.dataset.format);
  },
  onReapplyExport(event) {
    this._controller?.reapplyExport(event.currentTarget.dataset.jobId);
  },
  onExportStatus() {
    this._controller?.refreshExport();
  },
  onRetry() {
    this._controller?.retry();
  },
  onCleanupStatus() {
    this._controller?.cleanupStatus();
  },
  onSaveExport() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.busy ||
      this.data.pendingKind ||
      !this.data.authenticated ||
      !this._controller
    ) {
      return;
    }
    const binding = cloudSessionState.capture();
    const token = {};
    this._exportSaveToken = token;
    const current = () =>
      this._exportSaveToken === token &&
      !this._disposed &&
      !this._hidden &&
      cloudSessionState.isCurrent(binding);
    const saved = this._controller.download(
      (file) =>
        new Promise((resolve, reject) => {
          if (!current()) {
            resolve();
            return;
          }
          if (!wx.env?.USER_DATA_PATH || typeof wx.getFileSystemManager !== 'function') {
            reject(
              new AppError('LOCAL_FILE_UNAVAILABLE', '当前微信暂不支持保存文件，请升级后重试。'),
            );
            return;
          }
          try {
            const filePath =
              wx.env.USER_DATA_PATH + '/天气记录-' + file.jobId + '.' + file.extension;
            wx.getFileSystemManager().writeFile({
              filePath,
              data: file.content,
              encoding: 'utf8',
              success: () => {
                if (!current()) {
                  resolve();
                  return;
                }
                // A completed write may open the chooser once, only in the same visible session.
                this._exportSaveToken = null;
                if (typeof wx.shareFileMessage === 'function') {
                  try {
                    wx.shareFileMessage({
                      filePath,
                      fileName: '天气记录.' + file.extension,
                      success: resolve,
                      fail: () => resolve(),
                    });
                  } catch (_error) {
                    resolve();
                  }
                } else {
                  resolve();
                }
              },
              fail: () =>
                reject(new AppError('LOCAL_FILE_ERROR', '文件保存失败，请检查存储空间后重试。')),
            });
          } catch (_error) {
            reject(new AppError('LOCAL_FILE_ERROR', '文件保存失败，请检查存储空间后重试。'));
          }
        }),
    );
    return saved.finally(() => {
      if (this._exportSaveToken === token) {
        this._exportSaveToken = null;
      }
    });
  },
  onClose() {
    if (this.data.busy || this.data.pendingKind || !this.data.authenticated) {
      return;
    }
    const binding = cloudSessionState.capture();
    const confirmation = {};
    this._closeConfirmation = confirmation;
    wx.showModal({
      title: '注销账号？',
      content:
        '将立即停止私人账号访问，并清理天气记录、偏好、任务和导出数据。此操作无法撤销，请先导出需要保留的记录。',
      confirmText: '确认注销',
      confirmColor: '#9b3e3e',
      success: (answer) => {
        if (
          answer.confirm &&
          !this._disposed &&
          !this._hidden &&
          this._closeConfirmation === confirmation &&
          cloudSessionState.isCurrent(binding)
        ) {
          this._closeConfirmation = null;
          this._controller?.close();
        }
      },
    });
  },
});
