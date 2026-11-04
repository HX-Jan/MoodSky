const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
} = require('../../modules/share/app-share');
const { APP_VERSION } = require('../../shared/constants');
const environment = require('../../config/environment.local');
const { isExperience, EXPERIENCE_VERSION } = require('../../config/experience');
const { createLocalAccount, FORMATS } = require('../../modules/account/week-one');
const { checkHealth } = require('../../modules/system/health');
const { syncTab } = require('../../modules/presentation/jiaqi-design');
const { cloudSessionState } = require('../../services/session-state');
const api = require('../../services/api');
const { hasRememberedLogin, forgetLogin } = require('../../modules/account/login-memory');
const { profileView } = require('../../shared/profile');
const { appRuntime } = require('../../modules/system/runtime');
const { openPrivacyContract } = require('../../modules/system/privacy');
const { clientCapabilities, UNAVAILABLE_MESSAGE } = require('../../modules/system/capabilities');
const {
  navigateOnce,
  resetPageNavigation,
  pausePageNavigation,
} = require('../../modules/system/page-navigation');

function capabilityRows(envVersion) {
  const capabilities = clientCapabilities(environment, envVersion);
  return {
    capabilityRows: [
      { name: '账号与数据', ...capabilities.accountData },
      { name: '校园资料', ...capabilities.campus },
      { name: '轻任务', ...capabilities.tasks },
    ],
    accountDataAvailable: capabilities.accountData.state === 'available',
    tasksAvailable: capabilities.tasks.state === 'available',
  };
}
Page({
  ...createAppShare({ route: 'pages/me/index' }),
  data: {
    isExperience: isExperience(environment),
    isProduction: environment.releaseProfile === 'production',
    wechatAuthenticated: false,
    profileNickname: '微信用户',
    profileAvatar: '/assets/jiaqi/user.png',
    profileNotice: '',
    activeSection: '',
    version: APP_VERSION,
    clientVersion: APP_VERSION,
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
    ...capabilityRows(''),
  },
  onSection(event) {
    const section = event.currentTarget.dataset.section;
    if (!['preferences', 'favorites', 'privacy', 'help'].includes(section)) {
      return;
    }
    this.setData({ activeSection: this.data.activeSection === section ? '' : section });
  },
  onProductionAccount() {
    if (this.data.isProduction && !this.data.accountDataAvailable) {
      wx.showToast({ title: '账号与数据暂未开放', icon: 'none' });
      this.setData({ profileNotice: UNAVAILABLE_MESSAGE });
      return;
    }
    navigateOnce(
      this,
      wx,
      this.data.wechatAuthenticated
        ? '/pages/account/index'
        : '/pages/login/index?returnTo=' + encodeURIComponent('/pages/account/index'),
    );
  },
  onProfileTap() {
    if (this.data.wechatAuthenticated) {
      this.onEditProfile();
    } else {
      this.onWechatLogin();
    }
  },
  onMyRecords() {
    if (this.data.wechatAuthenticated) {
      navigateOnce(this, wx, '/pages/universe/index', 'switchTab');
    } else {
      navigateOnce(
        this,
        wx,
        '/pages/login/index?returnTo=' + encodeURIComponent('/pages/universe/index'),
      );
    }
  },
  onPrivacyContract() {
    openPrivacyContract(wx);
  },
  onCheckUpdate() {
    appRuntime.showUpdateStatus();
  },
  syncWechatLogin() {
    if (this._disposed || !this.data.isProduction) {
      return;
    }
    const binding = cloudSessionState.capture();
    const changed = this._profileBinding && !cloudSessionState.isCurrent(this._profileBinding);
    if (changed) {
      this._profileSeq++;
    }
    this._profileBinding = binding;
    this.setData({
      wechatAuthenticated: Boolean(binding),
      ...(!binding || changed
        ? {
            profileNickname: '微信用户',
            profileAvatar: '/assets/jiaqi/user.png',
            profileNotice: '',
          }
        : {}),
    });
  },
  onWechatLogin() {
    navigateOnce(this, wx, '/pages/login/index');
  },
  onEditProfile() {
    navigateOnce(this, wx, '/pages/profile/index');
  },
  onLogout() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      this._logoutConfirmation
    ) {
      return;
    }
    const binding = cloudSessionState.capture();
    if (!binding) {
      return;
    }
    const active = () => !this._disposed && !this._hidden && cloudSessionState.isCurrent(binding);
    const pending = () => {
      if (appRuntime.getWorkStatus().pending) {
        wx.showToast({ title: '请先完成或重试当前操作，再退出登录', icon: 'none' });
        return true;
      }
      return false;
    };
    const logout = () => {
      if (active() && !pending()) {
        forgetLogin(wx);
        cloudSessionState.clear();
      }
    };
    if (pending()) {
      return;
    }
    if (!appRuntime.getWorkStatus().draft) {
      logout();
      return;
    }
    const confirmation = {};
    this._logoutConfirmation = confirmation;
    const fail = () => {
      if (this._logoutConfirmation === confirmation) {
        this._logoutConfirmation = null;
        if (active()) {
          wx.showToast({ title: '暂时无法确认退出，请再试一次', icon: 'none' });
        }
      }
    };
    try {
      wx.showModal({
        title: '内容尚未保存',
        content: '仍有内容尚未保存，退出登录将放弃这些修改。',
        confirmText: '退出登录',
        cancelText: '取消',
        success: (result) => {
          if (this._logoutConfirmation === confirmation) {
            this._logoutConfirmation = null;
            if (result.confirm) {
              logout();
            }
          }
        },
        fail,
        complete: () => {
          if (this._logoutConfirmation === confirmation) {
            this._logoutConfirmation = null;
          }
        },
      });
    } catch (_error) {
      fail();
    }
  },
  async loadWechatProfile() {
    const token = ++this._profileSeq;
    try {
      const result = await api.call(api.createRequest('account.profile', { operation: 'get' }));
      if (this._disposed || token !== this._profileSeq) {
        return;
      }
      const profile = profileView(result.data);
      this.setData({
        profileNickname: profile.nickname || '微信用户',
        profileAvatar: profile.avatarData || '/assets/jiaqi/user.png',
        profileNotice: '',
      });
    } catch (_error) {
      if (!this._disposed && token === this._profileSeq) {
        this.setData({ profileNotice: '个人资料暂时无法读取，可稍后重新进入。' });
      }
    }
  },
  onHide() {
    this._hidden = true;
    this._logoutConfirmation = null;
    pausePageNavigation(this);
    this._profileSeq++;
  },
  onCampus() {
    navigateOnce(this, wx, '/pages/campus/index', 'switchTab');
  },
  onTasks() {
    if (!this.data.tasksAvailable) {
      wx.showToast({ title: '任务历史暂未开放', icon: 'none' });
      this.setData({ profileNotice: UNAVAILABLE_MESSAGE });
      return;
    }
    navigateOnce(this, wx, '/pages/tasks/index?view=history');
  },
  onLoad(options = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/me/index',
        options,
      )
    ) {
      return;
    }
    this._disposed = false;
    this._hidden = false;
    this._healthSeq = 0;
    this._profileSeq = 0;
    this.setData(capabilityRows(''));
    try {
      const info = wx.getAccountInfoSync?.().miniProgram;
      const label = { release: '正式版', trial: '体验版', develop: '开发版' }[info?.envVersion];
      this.setData({
        clientVersion: (info?.version || APP_VERSION) + (label ? ' · ' + label : ''),
        ...capabilityRows(info?.envVersion),
      });
    } catch (_error) {
      // The bundled version remains available on older WeChat clients.
    }
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
    resetPageNavigation(this);
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    this._hidden = false;
    enableAppShare(wx);
    syncTab(this, 3);
    this.syncWechatLogin();
    if (this.data.isProduction && (cloudSessionState.capture() || hasRememberedLogin(wx))) {
      this.loadWechatProfile();
    }
    if (this.account) {
      this.refresh();
    }
  },
  onUnload() {
    pausePageNavigation(this);
    this._disposed = true;
    this._hidden = true;
    this._logoutConfirmation = null;
    this._profileSeq++;
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
