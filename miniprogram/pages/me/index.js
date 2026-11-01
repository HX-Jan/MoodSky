const { createAppShare, enableAppShare } = require('../../modules/share/app-share');
const { APP_VERSION } = require('../../shared/constants');
const environment = require('../../config/environment.local');
const { isExperience, EXPERIENCE_VERSION } = require('../../config/experience');
const { createLocalAccount, FORMATS } = require('../../modules/account/week-one');
const { checkHealth } = require('../../modules/system/health');
const { syncTab } = require('../../modules/presentation/jiaqi-design');
const { cloudSessionState } = require('../../services/session-state');
const { createCloudSession } = require('../../modules/account/cloud-session');
Page({
  ...createAppShare(),
  data: {
    isExperience: isExperience(environment),
    isProduction: environment.releaseProfile === 'production',
    wechatAuthenticated: false,
    wechatLoginBusy: false,
    wechatLoginNotice: '使用当前微信登录，保存和查看自己的天气记录。',
    activeSection: '',
    version: APP_VERSION,
    experienceVersion: EXPERIENCE_VERSION,
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
    healthMode: 'demo',
    healthButtonText: '本地健康检查',
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
    healthVersion: '',
    healthCode: '',
  },
  onSection(event) {
    const section = event.currentTarget.dataset.section;
    if (!['preferences', 'favorites', 'privacy', 'help'].includes(section)) {
      return;
    }
    this.setData({ activeSection: this.data.activeSection === section ? '' : section });
  },
  onProductionAccount() {
    wx.navigateTo({ url: '/pages/account/index' });
  },
  syncWechatLogin() {
    if (this._disposed || !this.data.isProduction) {
      return;
    }
    const authenticated = Boolean(cloudSessionState.capture());
    this.setData({
      wechatAuthenticated: authenticated,
      wechatLoginNotice: authenticated
        ? '已使用当前微信登录，天气记录仅自己可见。'
        : this.data.wechatAuthenticated
          ? '登录状态已失效，请重新使用微信登录。'
          : this.data.wechatLoginNotice,
    });
  },
  async onWechatLogin() {
    if (this._disposed || !this.data.isProduction || this.data.wechatLoginBusy) {
      return;
    }
    const login = createCloudSession();
    this._loginSession = login;
    this.setData({ wechatLoginBusy: true, wechatLoginNotice: '正在验证微信身份…' });
    await login.refresh();
    if (this._disposed || this._loginSession !== login) {
      return;
    }
    const authenticated = Boolean(cloudSessionState.capture());
    const code = login.getErrorCode();
    this.setData({
      wechatAuthenticated: authenticated,
      wechatLoginBusy: false,
      wechatLoginNotice: authenticated
        ? '已使用当前微信登录，天气记录仅自己可见。'
        : code === 'ACCOUNT_DISABLED'
          ? '此微信对应的账号已注销，无法重新登录。'
          : code === 'NOT_IMPLEMENTED' || code === 'CLOUD_NOT_CONFIGURED'
            ? '微信登录暂时不可用，请稍后重试。'
            : '微信登录未完成，请检查网络后重试。',
    });
  },
  onHide() {
    this._loginSession?.dispose();
    this._loginSession = null;
    if (this.data.wechatLoginBusy) {
      this.setData({
        wechatLoginBusy: false,
        wechatLoginNotice: '登录未完成，可重新使用微信登录。',
      });
    }
  },
  onCampus() {
    wx.switchTab({ url: '/pages/campus/index' });
  },
  onTasks() {
    wx.navigateTo({ url: '/pages/tasks/index?view=history' });
  },
  onLoad() {
    this._disposed = false;
    this._healthSeq = 0;
    if (this.data.isProduction) {
      this.timers = [];
      this._unsubscribeLogin = cloudSessionState.subscribe(() => this.syncWechatLogin());
      this.syncWechatLogin();
      return;
    }
    const pilot =
      environment.cloudFunctionName === 'moodsky-private-pilot' &&
      environment.trustedSessionEnabled === true;
    this.setData({ isPilot: pilot });
    if (pilot || this.data.isExperience) {
      this.timers = [];
      this.setData({ healthMode: 'formal', healthButtonText: '检查受限测试入口' });
      return;
    }
    this.account = createLocalAccount(wx);
    this.timers = [];
    const formalHealth = environment.cloudEnabled === true && !!environment.cloudEnvId;
    this.setData({
      healthMode: formalHealth ? 'formal' : 'demo',
      healthButtonText: formalHealth ? '正式健康检查' : '本地健康检查',
    });
    this.refresh();
  },
  onShow() {
    enableAppShare(wx);
    syncTab(this, 3);
    this.syncWechatLogin();
    if (this.account) {
      this.refresh();
    }
  },
  onUnload() {
    this._disposed = true;
    this._loginSession?.dispose();
    this._unsubscribeLogin?.();
    this._healthSeq += 1;
    (this.timers || []).forEach(clearTimeout);
    if (this.account) {
      this.account.interrupt();
    }
  },
  later(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
  },
  refresh() {
    if (this._healthScope && !this.account.isCurrent(this._healthScope)) {
      this._healthSeq += 1;
      this.setData({
        healthText: '尚未检查',
        healthRequestId: '',
        healthVersion: '',
        healthCode: '',
        feedbackState: 'empty',
      });
    }
    this._healthScope = this.account.token();
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
    if (this._disposed) {
      return;
    }
    if (this.data.isPilot) {
      const sequence = ++this._healthSeq;
      this.setData({ healthText: '正在连接受限测试入口…' });
      const result = await checkHealth('formal');
      if (this._disposed || sequence !== this._healthSeq) {
        return;
      }
      this.setData({
        healthText: result.ok
          ? '测试入口可连接；实际保存需单独验证'
          : '测试入口未确认可用：' + result.message,
        healthRequestId: result.requestId,
        healthVersion: result.version || '',
        healthCode: result.code || '',
      });
      return;
    }
    const sequence = ++this._healthSeq;
    const token = this.account.token();
    const mode = environment.cloudEnabled === true && !!environment.cloudEnvId ? 'formal' : 'demo';
    this.setData({
      healthMode: mode,
      healthText: mode === 'formal' ? '正在检查正式接口…' : '正在检查本地合成响应…',
      healthRequestId: '',
      healthVersion: '',
      healthCode: '',
      feedbackState: 'loading',
    });
    const result = await checkHealth(mode);
    if (this._disposed || sequence !== this._healthSeq || !this.account.isCurrent(token)) {
      return;
    }
    const feedbackState = result.ok
      ? 'empty'
      : result.code === 'UNAUTHENTICATED'
        ? 'unauthenticated'
        : result.code === 'ACCOUNT_DISABLED'
          ? 'disabled'
          : result.code === 'NOT_IMPLEMENTED' || result.code === 'CLOUD_NOT_CONFIGURED'
            ? 'notImplemented'
            : 'network';
    this.setData({
      feedbackState,
      healthMode: mode,
      healthText: result.ok
        ? (mode === 'formal'
            ? result.deployment
              ? '云连接正常；备案前准备，真实保存未开放'
              : '正式接口校验通过'
            : '本地合成校验通过') +
          ' · apiVersion=' +
          result.apiVersion
        : '校验失败：' + result.message,
      healthRequestId: result.requestId,
      healthVersion: result.ok ? result.version || '' : '',
      healthCode: result.code || '',
    });
  },
});
