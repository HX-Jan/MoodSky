const { createAppShare, enableAppShare } = require('../../modules/share/app-share');
const api = require('../../services/api');
const environment = require('../../config/environment.local');
const { cloudSessionState } = require('../../services/session-state');
const { ensureCloudSession } = require('../../modules/account/cloud-session');
const { createProductionAccountController } = require('../../modules/account/production');
Page({
  ...createAppShare(),
  data: {
    authenticated: false,
    busy: false,
    preferences: {},
    exportJob: null,
    closure: null,
    pendingKind: '',
    notice: '',
  },
  onLoad() {
    this._disposed = false;
    if (environment.releaseProfile !== 'production') {
      this.setData({ notice: '此页面只在正式云配置版本中开放。' });
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
    enableAppShare(wx);
  },
  onUnload() {
    this._disposed = true;
    this._controller?.dispose();
  },
  onReload() {
    this._controller?.load();
  },
  onPreference(event) {
    this._controller?.savePreference(event.currentTarget.dataset.key, event.detail.value);
  },
  onExport(event) {
    this._controller?.requestExport(event.currentTarget.dataset.format);
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
    this._controller?.download(
      (file) =>
        new Promise((resolve, reject) => {
          const filePath = wx.env.USER_DATA_PATH + '/MoodSky-' + file.jobId + '.' + file.extension;
          wx.getFileSystemManager().writeFile({
            filePath,
            data: file.content,
            encoding: 'utf8',
            success: () => {
              if (this._disposed) {
                resolve();
                return;
              }
              // Export stays in the user's local files unless the user chooses to share it.
              if (typeof wx.shareFileMessage === 'function') {
                wx.shareFileMessage({
                  filePath,
                  fileName: 'MoodSky.' + file.extension,
                  success: resolve,
                  fail: () => resolve(),
                });
              } else {
                resolve();
              }
            },
            fail: reject,
          });
        }),
    );
  },
  onClose() {
    if (this.data.busy || this.data.pendingKind || !this.data.authenticated) {
      return;
    }
    wx.showModal({
      title: '注销 MoodSky 账号？',
      content:
        '将立即停止私人账号访问，并清理天气记录、偏好、任务和导出数据。此操作无法撤销，请先导出需要保留的记录。',
      confirmText: '确认注销',
      confirmColor: '#9b3e3e',
      success: (answer) => {
        if (answer.confirm) {
          this._controller?.close();
        }
      },
    });
  },
});
