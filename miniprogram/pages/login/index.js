const environment = require('../../config/environment.local');
const { createCloudSession } = require('../../modules/account/cloud-session');
const { cloudSessionState } = require('../../services/session-state');
const { rememberLogin } = require('../../modules/account/login-memory');
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
    this._returnTo = parseShareReturn(options.returnTo);
  },
  onShow() {
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    enableAppShare(wx);
  },
  onAgreement(event) {
    this.setData({ agreed: event.detail.value.includes('agree') });
  },
  onPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => wx.showToast({ title: '暂时无法打开隐私指引，请稍后重试', icon: 'none' }),
      });
    }
  },
  async onWechatLogin() {
    if (this._disposed || this.data.wechatLoginBusy) {
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
      rememberLogin(wx);
      if (this._returnTo) {
        wx.reLaunch({ url: this._returnTo });
      } else {
        wx.switchTab({ url: '/pages/me/index' });
      }
    }
  },
  onBrowse() {
    wx.switchTab({ url: '/pages/today/index' });
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
  onUnload() {
    this._disposed = true;
    this._loginSession?.dispose();
  },
});
