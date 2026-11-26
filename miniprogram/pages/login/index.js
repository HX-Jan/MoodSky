const { withButtonPress } = require('../../modules/presentation/button-press');
const environment = require('../../config/environment.local');
const api = require('../../services/api');
const { createCloudSession } = require('../../modules/account/cloud-session');
const { cloudSessionState } = require('../../services/session-state');
const { rememberLogin, readPhoneSession } = require('../../modules/account/login-memory');
const { phoneAuthorizationNotice } = require('../../modules/account/phone-authorization');
const { createPhoneSignIn } = require('../../modules/account/phone-signin');
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
const pageDefinition = {
  ...createAppShare({ route: 'pages/login/index' }),
  data: {
    agreed: false,
    phoneLoginEnabled:
      environment.releaseProfile === 'production' && environment.phoneLoginEnabled === true,
    wechatAuthenticated: false,
    wechatLoginBusy: false,
    wechatLoginNotice: '',
    registrationAvailable: false,
    registrationPending: false,
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
    this._registrationScope = null;
    this._registrationRequest = null;
    this._registrationAttempt = null;
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
    if (this.data.registrationAvailable) {
      return this.onRegister();
    }
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
    if (this.data.phoneLoginEnabled && cloudSessionState.capture()) {
      this._enterAfterLogin();
      return;
    }
    if (
      this._loginNavigationBinding &&
      !this._loginNavigationBinding.phoneSession &&
      cloudSessionState.isCurrent(this._loginNavigationBinding)
    ) {
      this._enterAfterLogin();
      return;
    }
    const login = createCloudSession(
      environment.phoneLoginEnabled === true || readPhoneSession?.(wx)
        ? {
            authenticate: () =>
              api
                .createApiClient(wx, environment, { ignorePhoneSession: true })
                .call(api.createRequest('account.session')),
          }
        : {},
    );
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
    let registrationAvailable = false;
    if (!authenticated && code === 'ACCOUNT_DISABLED') {
      const generation = cloudSessionState.getGeneration();
      let status;
      try {
        status = await api.call(api.createRequest('account.registration'));
      } catch {
        // Older deployed servers may not expose registration yet. Do not bypass
        // the disabled-account gate or infer a writable state from this failure.
      }
      if (
        this._disposed ||
        this._hidden ||
        this._loginSession !== login ||
        generation !== cloudSessionState.getGeneration()
      ) {
        if (!this._disposed && !this._hidden && this._loginSession === login) {
          this._clearRegistration();
          this.setData({
            wechatLoginBusy: false,
            wechatLoginNotice: '登录状态已变化，请重新使用微信登录。',
          });
        }
        return;
      }
      registrationAvailable =
        status?.ok === true &&
        status.data?.canRegister === true &&
        typeof status.data.previousScope === 'string' &&
        /^scope_[a-f0-9]{64}$/.test(status.data.previousScope);
      this._registrationScope = registrationAvailable ? status.data.previousScope : null;
      this._registrationGeneration = generation;
    }
    this.setData({
      wechatAuthenticated: authenticated,
      wechatLoginBusy: false,
      registrationAvailable,
      registrationPending: false,
      wechatLoginNotice: authenticated
        ? '登录成功'
        : code === 'ACCOUNT_DISABLED'
          ? registrationAvailable
            ? '原账号已注销。你可以重新注册，旧数据不会恢复。'
            : '此微信对应的账号已注销，重新注册暂不可用，请稍后重试。'
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
  onPhoneLoginTap() {
    if (!this.data.agreed && !this.data.wechatLoginBusy) {
      this.setData({ wechatLoginNotice: '请先阅读并同意隐私保护指引。' });
    }
  },
  async onPhoneLogin(event) {
    if (
      !this.data.phoneLoginEnabled ||
      !this.data.agreed ||
      this.data.wechatLoginBusy ||
      this._hidden ||
      this._disposed ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      isPageNavigationBlocked(this)
    ) {
      return;
    }
    if (typeof event.detail?.code !== 'string' || !event.detail.code) {
      this.setData({ wechatLoginNotice: phoneAuthorizationNotice(event.detail || {}) });
      return;
    }
    this._clearRegistration();
    const generation = cloudSessionState.getGeneration();
    const client = api.createApiClient(wx, environment, { ignorePhoneSession: true });
    const login = createCloudSession({
      authenticate: () =>
        createPhoneSignIn({
          call: client.call,
          platform: wx,
          isCurrent: () =>
            !this._disposed &&
            !this._hidden &&
            this._loginSession === login &&
            generation === cloudSessionState.getGeneration(),
          isAgreed: () => this.data.agreed,
        })(event.detail.code),
    });
    this._loginSession = login;
    this.setData({ wechatLoginBusy: true, wechatLoginNotice: '' });
    const authenticated = await login.refresh();
    if (this._disposed || this._hidden || this._loginSession !== login) {
      return;
    }
    this.setData({
      wechatLoginBusy: false,
      wechatAuthenticated: authenticated,
      wechatLoginNotice: authenticated
        ? '登录成功'
        : login.getErrorCode() === 'NOT_IMPLEMENTED'
          ? '手机号登录暂不可用，请使用微信登录。'
          : login.getErrorMessage() || '手机号登录未完成，请重新授权后再试。',
    });
    if (authenticated) {
      rememberLogin(wx);
      this._loginNavigationBinding = cloudSessionState.capture();
      this._enterAfterLogin();
    }
  },
  async onRegister() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      this.data.wechatLoginBusy ||
      !this.data.registrationAvailable ||
      !this._registrationScope ||
      isPageNavigationBlocked(this)
    ) {
      return;
    }
    if (!this.data.agreed) {
      this.setData({ wechatLoginNotice: '请先阅读并同意隐私保护指引。' });
      return;
    }
    if (this._registrationGeneration !== cloudSessionState.getGeneration()) {
      this._clearRegistration();
      this.setData({ wechatLoginNotice: '登录状态已变化，请重新使用微信登录。' });
      return;
    }
    const attempt = {};
    this._registrationAttempt = attempt;
    const generation = cloudSessionState.getGeneration();
    const isCurrent = () =>
      !this._disposed &&
      !this._hidden &&
      this._registrationAttempt === attempt &&
      generation === cloudSessionState.getGeneration();
    this.setData({ wechatLoginBusy: true, wechatLoginNotice: '' });
    try {
      if (!this._registrationRequest) {
        const confirmed = await new Promise((resolve) => {
          if (typeof wx.showModal !== 'function') {
            resolve(false);
            return;
          }
          wx.showModal({
            title: '重新注册',
            content: '将创建一个全新的空账号。原账号的记录、资料和导出不会恢复。',
            confirmText: '重新注册',
            cancelText: '取消',
            success: (result) => resolve(result.confirm === true),
            fail: () => resolve(false),
          });
        }).catch(() => false);
        if (!isCurrent()) {
          return;
        }
        if (!confirmed) {
          this.setData({ wechatLoginNotice: '已取消重新注册。' });
          return;
        }
      }
      if (typeof wx.requirePrivacyAuthorize === 'function') {
        const authorized = await new Promise((resolve) =>
          wx.requirePrivacyAuthorize({ success: () => resolve(true), fail: () => resolve(false) }),
        ).catch(() => false);
        if (!isCurrent()) {
          return;
        }
        if (!authorized) {
          this.setData({ wechatLoginNotice: '你可以稍后再注册。' });
          return;
        }
      }
      if (!isCurrent()) {
        return;
      }
      if (!this.data.agreed) {
        this.setData({ wechatLoginNotice: '请先阅读并同意隐私保护指引。' });
        return;
      }
      if (!this._registrationRequest) {
        this._registrationRequest = api.createRequest('account.register', {
          confirm: 'REGISTER',
          previousScope: this._registrationScope,
        });
      }
      const request = this._registrationRequest;
      let receivedScope;
      const login = createCloudSession({
        authenticate: async () => {
          const result = await api.call(request);
          receivedScope = result.data?.scope;
          return result;
        },
      });
      this._loginSession = login;
      const registered = await login.refresh();
      if (this._disposed || this._hidden || this._loginSession !== login) {
        return;
      }
      if (registered && cloudSessionState.capture()?.scope === receivedScope) {
        this._clearRegistration();
        this.setData({ wechatAuthenticated: true, wechatLoginNotice: '注册成功，欢迎重新开始。' });
        this._loginNavigationBinding = cloudSessionState.capture();
        rememberLogin(wx);
        this._enterAfterLogin();
      } else if (
        !cloudSessionState.capture() &&
        (login.getErrorCode() === 'NETWORK_ERROR' || login.getErrorCode() === 'INTERNAL_ERROR')
      ) {
        // Keep the same confirmation scope and request for an unknown result.
        this._registrationGeneration = cloudSessionState.getGeneration();
        this.setData({
          registrationPending: true,
          wechatLoginNotice: '注册结果尚未确认，请重试。',
        });
      } else {
        this._clearRegistration();
        this.setData({ wechatLoginNotice: '账号状态已变化，请重新使用微信登录。' });
      }
    } finally {
      if (!this._disposed && !this._hidden && this._registrationAttempt === attempt) {
        this.setData({ wechatLoginBusy: false });
      }
    }
  },
  _clearRegistration() {
    this._registrationScope = null;
    this._registrationRequest = null;
    this.setData({ registrationAvailable: false, registrationPending: false });
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
    this._registrationAttempt = null;
    this._clearRegistration();
    this._loginNavigationBinding = null;
    pausePageNavigation(this);
    this._loginSession?.dispose();
    this._loginSession = null;
    if (this.data.wechatLoginBusy) {
      this.setData({
        wechatLoginBusy: false,
        wechatLoginNotice: '登录未完成，请重新选择登录方式。',
      });
    }
  },
  onUnload() {
    clearPrivacyNotice(this);
    this._disposed = true;
    this._hidden = true;
    this._registrationAttempt = null;
    this._registrationScope = null;
    this._registrationRequest = null;
    pausePageNavigation(this);
    this._loginSession?.dispose();
  },
};

Page(withButtonPress(pageDefinition));
