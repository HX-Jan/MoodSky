const api = require('../../services/api');
const environment = require('../../config/environment.local');
const { cloudSessionState } = require('../../services/session-state');
const { prepareAvatar } = require('../../modules/account/avatar');
const { profileFields, profileView } = require('../../shared/profile');
const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
} = require('../../modules/share/app-share');
Page({
  ...createAppShare({ route: 'pages/profile/index' }),
  data: {
    nickname: '',
    avatarData: '',
    avatarPath: '',
    busy: false,
    loaded: false,
    pending: false,
    notice: '',
  },
  onLoad(options = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/profile/index',
        options,
      )
    ) {
      return;
    }
    this._disposed = false;
    this._sequence = 0;
    this._binding = cloudSessionState.capture();
    this._unsubscribe = cloudSessionState.subscribe(() => {
      const next = cloudSessionState.capture();
      if (!this._binding && next) {
        this._binding = next;
        return;
      }
      this._binding = next;
      this._sequence++;
      this._pending = null;
      if (!this._disposed) {
        this.setData({
          nickname: '',
          avatarData: '',
          avatarPath: '',
          loaded: false,
          busy: false,
          pending: false,
          notice: '登录状态已变化，请重新登录。',
        });
      }
    });
    return this.onReload();
  },
  onShow() {
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    enableAppShare(wx);
  },
  async onReload() {
    if (this.data.busy || this._disposed) {
      return;
    }
    const token = ++this._sequence;
    this._pending = null;
    this.setData({
      busy: true,
      loaded: false,
      pending: false,
      nickname: '',
      avatarData: '',
      avatarPath: '',
      notice: '',
    });
    try {
      const result = await api.call(api.createRequest('account.profile', { operation: 'get' }));
      if (!this._disposed && token === this._sequence) {
        const profile = profileView(result.data);
        this._version = profile.version;
        this.setData({ nickname: profile.nickname, avatarData: profile.avatarData, loaded: true });
      }
    } catch (_error) {
      if (!this._disposed && token === this._sequence) {
        this.setData({ notice: '暂时无法读取个人资料，请稍后重试。' });
      }
    } finally {
      if (!this._disposed && token === this._sequence) {
        this.setData({ busy: false });
      }
    }
  },
  onChooseAvatar(event) {
    if (
      !this.data.busy &&
      this.data.loaded &&
      !this.data.pending &&
      typeof event.detail.avatarUrl === 'string'
    ) {
      this.setData({ avatarPath: event.detail.avatarUrl, notice: '' });
    }
  },
  onDefaultAvatar() {
    if (!this.data.busy && !this.data.pending) {
      this.setData({ avatarPath: '', avatarData: '' });
    }
  },
  async onSave(event) {
    if (this._disposed || this.data.busy || !this.data.loaded || this.data.pending) {
      return;
    }
    const token = ++this._sequence;
    this.setData({ busy: true, notice: '' });
    try {
      const avatarData = this.data.avatarPath
        ? await prepareAvatar(wx, this.data.avatarPath)
        : this.data.avatarData;
      if (this._disposed || token !== this._sequence) {
        return;
      }
      const fields = profileFields({ nickname: event.detail.value.nickname, avatarData });
      this._pending = api.createRequest('account.profile', {
        operation: 'set',
        ...fields,
        expectedVersion: this._version,
      });
      this.setData({ pending: true });
      await this.submitProfile(token);
    } catch (error) {
      if (!this._disposed && token === this._sequence) {
        this.setData({
          notice:
            error.code === 'INVALID_INPUT' ? error.message : '头像处理失败，请重新选择后保存。',
        });
      }
    } finally {
      if (!this._disposed && token === this._sequence) {
        this.setData({ busy: false });
      }
    }
  },
  async submitProfile(token) {
    try {
      const result = await api.call(this._pending);
      if (this._disposed || token !== this._sequence) {
        return;
      }
      const profile = profileView(result.data);
      this._version = profile.version;
      this._pending = null;
      this.setData({
        nickname: profile.nickname,
        avatarData: profile.avatarData,
        avatarPath: '',
        pending: false,
        notice: '个人资料已保存。',
      });
    } catch (error) {
      if (this._disposed || token !== this._sequence) {
        return;
      }
      const reload = [
        'CONFLICT',
        'INVALID_INPUT',
        'UNAUTHENTICATED',
        'ACCOUNT_DISABLED',
        'FORBIDDEN',
      ].includes(error.code);
      if (reload) {
        this._pending = null;
      }
      this.setData({
        pending: !reload,
        notice: reload
          ? '资料或登录状态已变化，请重新读取后修改。'
          : '保存结果尚未确认，请重试原操作。',
      });
    }
  },
  async onRetry() {
    if (!this._pending || this.data.busy || this._disposed) {
      return;
    }
    const token = ++this._sequence;
    this.setData({ busy: true });
    await this.submitProfile(token);
    if (!this._disposed && token === this._sequence) {
      this.setData({ busy: false });
    }
  },
  onUnload() {
    this._disposed = true;
    this._sequence++;
    this._pending = null;
    this._unsubscribe?.();
  },
});
