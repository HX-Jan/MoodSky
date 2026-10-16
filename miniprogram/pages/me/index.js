const { APP_VERSION } = require('../../shared/constants');
const { createLocalAccount, FORMATS } = require('../../modules/account/week-one');
const { checkHealth } = require('../../modules/system/health');
Page({
  data: {
    version: APP_VERSION,
    preferences: {},
    accountId: 'demo-a',
    accountStatus: 'active',
    exportExpanded: false,
    closureExpanded: false,
    exportFormat: 'JSON',
    exportOptions: FORMATS,
    exportTask: null,
    exportLabel: '',
    closureProgress: 0,
    syncState: '本地合成演示 · 未连接云端',
    feedbackState: 'empty',
    feedbackOptions: [
      'loading',
      'empty',
      'network',
      'unauthenticated',
      'disabled',
      'notImplemented',
    ],
    healthText: '尚未检查',
    healthRequestId: '',
  },
  onTasks() {
    wx.navigateTo({ url: '/pages/tasks/index' });
  },
  onLoad() {
    this.account = createLocalAccount(wx);
    this.timers = [];
    this.refresh();
  },
  onShow() {
    if (this.account) {
      this.refresh();
    }
  },
  onUnload() {
    (this.timers || []).forEach(clearTimeout);
    if (this.account) {
      this.account.interrupt();
    }
  },
  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  },
  refresh() {
    const state = this.account.snapshot();
    const labels = {
      processing: '处理中（合成）',
      completed: '已完成（合成文件）',
      failed: '失败（可重试）',
      expired: '已过期（请重新申请）',
    };
    this.setData({
      accountId: state.accountId,
      accountStatus: state.status,
      preferences: state.preferences,
      exportTask: state.exportTask || null,
      exportLabel: state.exportTask ? labels[state.exportTask.status] : '尚未申请',
      closureProgress:
        state.status === 'closed' ? 100 : state.closureTask ? state.closureTask.progress : 0,
      closureNotice:
        state.closureTask && state.closureTask.status === 'failed'
          ? '本地模拟已中断，账号保持停用；可重置演示。未完成云端注销。'
          : '',
    });
  },
  switchAccount(event) {
    this.account.switchAccount(event.currentTarget.dataset.id);
    this.refresh();
    this.setData({ syncState: '已切换合成账号 · 偏好按账号隔离' });
  },
  onPreviewChange(event) {
    try {
      this.account.savePreference(event.currentTarget.dataset.key, event.detail.value);
      this.setData({ syncState: '已保存到此合成账号的本机缓存' });
    } catch (_error) {
      wx.showToast({ title: '演示账号已停用，请先重置', icon: 'none' });
    }
    this.refresh();
  },
  toggleExport() {
    this.setData({ exportExpanded: !this.data.exportExpanded, closureExpanded: false });
  },
  toggleClosure() {
    this.setData({ closureExpanded: !this.data.closureExpanded, exportExpanded: false });
  },
  chooseFormat(event) {
    if (FORMATS.includes(event.currentTarget.dataset.format)) {
      this.setData({ exportFormat: event.currentTarget.dataset.format });
    }
  },
  startExport(event) {
    if (this.data.exportTask && this.data.exportTask.status === 'processing') {
      return;
    }
    try {
      const token = this.account.startExport(this.data.exportFormat);
      const fail = event.currentTarget.dataset.fail === 'yes';
      this.refresh();
      this.later(() => {
        if (this.account.isCurrent(token)) {
          this.account.completeExport(token, fail);
          this.refresh();
        }
      }, 900);
    } catch (_error) {
      wx.showToast({ title: '账号不可用，请重置演示', icon: 'none' });
    }
  },
  expireExport() {
    this.account.expireExport();
    this.refresh();
  },
  saveExport() {
    this.refresh();
    const task = this.data.exportTask;
    if (!task || task.status !== 'completed') {
      return;
    }
    const path =
      wx.env.USER_DATA_PATH +
      '/MoodSky-synthetic-' +
      this.data.accountId +
      '-' +
      task.id +
      (task.format === 'JSON' ? '.json' : '.md');
    const token = this.account.token();
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: task.content,
      encoding: 'utf8',
      success: () => {
        if (this.account.isCurrent(token)) {
          wx.showModal({
            title: '合成文件已保存',
            content: '仅含演示账号偏好，日记为空。小程序本地路径：' + path,
            showCancel: false,
          });
        }
      },
      fail: () => {
        if (this.account.isCurrent(token)) {
          wx.showToast({ title: '本地文件保存失败', icon: 'none' });
        }
      },
    });
  },
  confirmAccount(event) {
    const action = event.currentTarget.dataset.action;
    const token = this.account.token();
    wx.showModal({
      title: action === 'disable' ? '停用合成账号？' : '注销合成账号？',
      content: '仅操作本地演示账号和本模块缓存，不会操作微信身份或云端数据。可用“重置演示”恢复。',
      success: (answer) => {
        if (!answer.confirm || !this.account.isCurrent(token)) {
          return;
        }
        if (action === 'disable') {
          this.account.disable();
          this.refresh();
          return;
        }
        try {
          const closureToken = this.account.startClosure();
          this.refresh();
          [35, 70, 100].forEach((progress, index) =>
            this.later(
              () => {
                if (this.account.advanceClosure(closureToken, progress)) {
                  this.refresh();
                }
              },
              (index + 1) * 600,
            ),
          );
        } catch (_error) {
          wx.showToast({ title: '请先重置演示账号', icon: 'none' });
        }
      },
    });
  },
  resetDemo() {
    this.account.reset();
    this.refresh();
    this.setData({ syncState: '当前合成账号已重置' });
  },
  chooseFeedback(event) {
    this.setData({ feedbackState: event.currentTarget.dataset.state });
  },
  onFeedbackAction() {
    wx.showToast({ title: '公共反馈交互演示', icon: 'none' });
  },
  async runHealth() {
    this.setData({ healthText: '正在检查本地合成响应…' });
    const result = await checkHealth('demo');
    this.setData({
      healthText: result.ok
        ? '本地合成校验通过 · apiVersion=' + result.apiVersion
        : '校验失败：' + result.message,
      healthRequestId: result.requestId,
    });
  },
});
