const environment = require('../../config/environment.local');
const { createCloudSession } = require('../../modules/account/cloud-session');
const { cloudSessionState } = require('../../services/session-state');
const { rememberLogin } = require('../../modules/account/login-memory');
const { openPrivacyContract, clearPrivacyNotice } = require('../../modules/system/privacy');
const {
  navigateOnce,
  resetPageNavigation,
  pausePageNavigation,
  isPageNavigationBlocked,
} = require('../../modules/system/page-navigation');
const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
  parseShareReturn,
} = require('../../modules/share/app-share');
Page({
  ...createAppShare({ route: 'pages/login/index' }),
  data: {
    agreed: false,
    wechatAuthenticated: false,
    wechatLoginBusy: false,
    wechatLoginNotice: '',
  },
  onLoad(options = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/login/index',
        options,
      )
    ) {
      return;
    }
    this._disposed = false;
    this._hidden = false;
    this._loginNavigationBinding = null;
    resetPageNavigation(this);
    this._returnTo = parseShareReturn(options.returnTo);
  },
  onShow() {
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    this._hidden = false;
    resetPageNavigation(this);
    this.setData({
      wechatAuthenticated:
        environment.releaseProfile === 'production' && Boolean(cloudSessionState.capture()),
    });
    enableAppShare(wx);
  },
  onAgreement(event) {
    this.setData({ agreed: event.detail.value.includes('agree') });
  },
  onPrivacy() {
    openPrivacyContract(wx, this);
  },
  async onWechatLogin() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      this.data.wechatLoginBusy ||
      isPageNavigationBlocked(this)
    ) {
      return;
    }
    if (!this.data.agreed) {
      this.setData({ wechatLoginNotice: '请先阅读并同意隐私保护指引。' });
      return;
    }
    if (environment.releaseProfile !== 'production') {
      this.setData({ wechatLoginNotice: '当前为本地演示，微信登录暂不可用。' });
      return;
    }
    if (this._loginNavigationBinding && cloudSessionState.isCurrent(this._loginNavigationBinding)) {
      this._enterAfterLogin();
      return;
    }
    const login = createCloudSession();
    this._loginSession = login;
    this.setData({ wechatLoginBusy: true, wechatLoginNotice: '' });
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      const agreed = await new Promise((resolve) =>
        wx.requirePrivacyAuthorize({ success: () => resolve(true), fail: () => resolve(false) }),
      ).catch(() => false);
      if (this._disposed || this._loginSession !== login) {
        return;
      }
      if (!agreed) {
        this.setData({ wechatLoginBusy: false, wechatLoginNotice: '你可以稍后再登录。' });
        return;
      }
    }
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
        ? '登录成功'
        : code === 'ACCOUNT_DISABLED'
          ? '此微信对应的账号已注销，无法重新登录。'
          : code === 'NOT_IMPLEMENTED' || code === 'CLOUD_NOT_CONFIGURED'
            ? '微信登录暂时不可用，请稍后重试。'
            : '微信登录未完成，请检查网络后重试。',
    });
    if (authenticated) {
      this._loginNavigationBinding = cloudSessionState.capture();
      rememberLogin(wx);
      this._enterAfterLogin();
    }
  },
  _enterAfterLogin() {
    if (
      this._returnTo === '/pages/campus/index' &&
      typeof getCurrentPages === 'function' &&
      getCurrentPages().at(-2)?.route === 'pages/campus/index'
    ) {
      navigateOnce(this, wx, undefined, 'navigateBack');
      return;
    }
    navigateOnce(
      this,
      wx,
      this._returnTo || '/pages/me/index',
      this._returnTo ? 'reLaunch' : 'switchTab',
    );
  },
  onBrowse() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      this.data.wechatLoginBusy
    ) {
      return;
    }
    navigateOnce(this, wx, '/pages/today/index', 'switchTab');
  },
  onHide() {
    clearPrivacyNotice(this);
    this._hidden = true;
    this._loginNavigationBinding = null;
    pausePageNavigation(this);
    this._loginSession?.dispose();
    this._loginSession = null;
    if (this.data.wechatLoginBusy) {
      this.setData({
        wechatLoginBusy: false,
        wechatLoginNotice: '登录未完成，可重新使用微信登录。',
      });
    }
  },
  onUnload() {
    clearPrivacyNotice(this);
    this._disposed = true;
    this._hidden = true;
    pausePageNavigation(this);
    this._loginSession?.dispose();
  },
});
