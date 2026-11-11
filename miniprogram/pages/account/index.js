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
const { createTaskOutbox } = require('../../modules/tasks/outbox');
const { createCheckinOutbox } = require('../../modules/campus/checkin-outbox');
const { clientCapabilities } = require('../../modules/system/capabilities');
const { deliverExportFile } = require('../../modules/account/export-file');
const { syncLeaveGuard } = require('../../modules/system/leave-guard');
Page({
  ...createAppShare({ route: 'pages/account/index' }),
  data: {
    authenticated: false,
    accountEnabled: false,
    preferencesExpanded: false,
    busy: false,
    preferences: {},
    exportJob: null,
    exportFormat: 'json',
    exportStateLabel: '',
    exportPreview: '',
    exportPreviewIndex: 0,
    exportPreviewTotal: 0,
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
    this._hidden = false;
    this._exportSaveToken = null;
    this._capabilities = clientCapabilities(environment);
    if (this._capabilities.accountData.state !== 'available') {
      this.setData({ notice: this._capabilities.accountData.description });
      return;
    }
    this.setData({ accountEnabled: true });
    const call = (action, payload) => api.call(api.createRequest(action, payload));
    this._controller = createProductionAccountController({
      storage: wx,
      onClosed: (scope) => {
        createCheckinOutbox(wx, environment).purge(scope);
        createTaskOutbox(wx, environment).purge(scope);
      },
      session: cloudSessionState,
      publish: (patch) => {
        if (
          this._exportPreview &&
          (!patch.authenticated ||
            patch.exportJob?.state !== 'ready' ||
            patch.exportJob?.jobId !== this._exportPreview.jobId)
        ) {
          this.onCloseExportPreview();
        }
        this.setData({ ...patch, ...(!patch.authenticated ? { preferencesExpanded: false } : {}) });
        this._syncLeaveGuard();
      },
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
    this._leaveGuardNeedsSync = true;
    const state = this._controller?.resume();
    if (state && !state.busy && !state.authenticated && !state.pendingKind && !state.closure) {
      this._controller.load();
    }
    this._syncLeaveGuard();
  },
  _syncLeaveGuard() {
    if (
      !this._hidden &&
      !this._disposed &&
      !this.data.shareSinglePage &&
      !this._shareLoginRedirected
    ) {
      syncLeaveGuard(this, wx, this.data.pendingKind ? '操作尚未确认，请完成或重试后再离开。' : '');
    }
  },
  getWorkStatus() {
    return this._controller?.getWorkStatus?.();
  },
  onHide() {
    this._hidden = true;
    this._exportSaveToken = null;
    this._closeConfirmation = null;
    this.onCloseExportPreview();
    this._controller?.suspend();
  },
  onUnload() {
    this._disposed = true;
    this._leaveGuardNeedsSync = true;
    syncLeaveGuard(this, wx, '');
    this._exportSaveToken = null;
    this._closeConfirmation = null;
    this.onCloseExportPreview();
    this._controller?.dispose();
  },
  onReload() {
    this._controller?.load();
  },
  onPreference(event) {
    this._controller?.savePreference(event.currentTarget.dataset.key, event.detail.value);
  },
  onTogglePreferences() {
    if (!this.data.authenticated || this.data.busy || this.data.pendingKind || this.data.closure) {
      return;
    }
    this.setData({ preferencesExpanded: !this.data.preferencesExpanded });
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
    return this._receiveExport((file, current) => deliverExportFile(wx, file, current));
  },
  onPreviewExport() {
    return this._receiveExport((file, current, binding) => {
      if (!current()) {
        return '';
      }
      // Render one page at a time. Keep the entire file only in this visible account page.
      const characters = Array.from(file.content);
      this._exportPreview = { characters, binding, jobId: file.jobId };
      this._showExportPreview(0);
      return '正在查看本人的导出内容。';
    });
  },
  _showExportPreview(index) {
    const preview = this._exportPreview;
    const pageSize = 8000;
    if (
      !preview ||
      this._hidden ||
      this._disposed ||
      !cloudSessionState.isCurrent(preview.binding)
    ) {
      return;
    }
    const total = Math.max(1, Math.ceil(preview.characters.length / pageSize));
    if (index >= 0 && index < total) {
      const start = index * pageSize;
      this.setData({
        exportPreview: preview.characters.slice(start, start + pageSize).join(''),
        exportPreviewIndex: index,
        exportPreviewTotal: total,
      });
    }
  },
  onMoveExportPreview(event) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (delta === -1 || delta === 1) {
      this._showExportPreview(this.data.exportPreviewIndex + delta);
    }
  },
  onCloseExportPreview() {
    this._exportPreview = null;
    if (this.data.exportPreviewTotal) {
      this.setData({ exportPreview: '', exportPreviewIndex: 0, exportPreviewTotal: 0 });
    }
  },
  _receiveExport(deliver) {
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
    const saved = this._controller.download((file) => deliver(file, current, binding));
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
