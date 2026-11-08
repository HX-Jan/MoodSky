const api = require('../../services/api');
const environment = require('../../config/environment.local');
const { cloudSessionState } = require('../../services/session-state');
const { prepareAvatar } = require('../../modules/account/avatar');
const { syncLeaveGuard } = require('../../modules/system/leave-guard');
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
    hasUnsavedChanges: false,
    leaveWarning: '',
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
    this._hidden = false;
    this._savedProfile = null;
    this._saving = false;
    this._sequence = 0;
    this._reloadConfirmSequence = 0;
    this._reloadConfirming = false;
    this._binding = cloudSessionState.capture();
    this._unsubscribe = cloudSessionState.subscribe(() => {
      const next = cloudSessionState.capture();
      if (!this._binding && next) {
        this._binding = next;
        return;
      }
      this._binding = next;
      this._savedProfile = null;
      this._saving = false;
      this._sequence++;
      this._reloadConfirmSequence++;
      this._reloadConfirming = false;
      this._pending = null;
      if (!this._disposed) {
        this._publishProfile({
          nickname: '',
          avatarData: '',
          avatarPath: '',
          loaded: false,
          busy: false,
          pending: false,
          hasUnsavedChanges: false,
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
    this._hidden = false;
    this._leaveGuardNeedsSync = true;
    syncLeaveGuard(this, wx, this.data.leaveWarning || '');
  },
  _publishProfile(patch) {
    const next = { ...this.data, ...patch };
    const baseline = this._savedProfile;
    const hasUnsavedChanges =
      baseline && next.loaded
        ? next.nickname !== baseline.nickname ||
          next.avatarData !== baseline.avatarData ||
          !!next.avatarPath
        : next.hasUnsavedChanges;
    const leaveWarning = next.pending
      ? '保存结果尚未确认，离开可能丢失重试入口。请先重试原操作。'
      : next.busy && this._saving
        ? '正在处理或保存个人资料，请稍候完成再离开。'
        : hasUnsavedChanges
          ? '头像或昵称尚未保存，离开此页会丢失修改。'
          : '';
    this.setData({ ...patch, hasUnsavedChanges, leaveWarning });
    if (!this._hidden && !this._disposed) {
      syncLeaveGuard(this, wx, leaveWarning);
    }
  },
  onReload() {
    if (this.data.busy || this._disposed) {
      return;
    }
    if (!this.data.pending && !this.data.hasUnsavedChanges) {
      return this._readProfile();
    }
    if (this._reloadConfirming) {
      return;
    }
    if (typeof wx.showModal !== 'function') {
      this._publishProfile({ notice: '请先保存修改或重试原操作，再重新读取资料。' });
      return;
    }
    const token = this._sequence;
    const confirmation = ++this._reloadConfirmSequence;
    this._reloadConfirming = true;
    const release = () => {
      if (confirmation === this._reloadConfirmSequence) {
        this._reloadConfirming = false;
      }
    };
    try {
      wx.showModal({
        title: this.data.pending ? '保存结果尚未确认' : '资料尚未保存',
        content: this.data.pending
          ? '重新读取会放弃本页输入和原操作重试入口，不会撤销已发送的保存。是否读取当前资料？'
          : '重新读取会放弃本页未保存的头像和昵称，是否继续？',
        confirmText: '放弃并读取',
        cancelText: '保留修改',
        success: (result) => {
          if (
            result.confirm &&
            !this._disposed &&
            confirmation === this._reloadConfirmSequence &&
            token === this._sequence &&
            !this.data.busy
          ) {
            release();
            this._readProfile();
          }
        },
        complete: release,
      });
    } catch (_error) {
      release();
      this._publishProfile({ notice: '暂时无法确认重新读取，修改和原操作已保留。' });
    }
  },
  async _readProfile() {
    const token = ++this._sequence;
    this._pending = null;
    this._savedProfile = null;
    this._publishProfile({
      busy: true,
      loaded: false,
      pending: false,
      hasUnsavedChanges: false,
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
        this._savedProfile = { nickname: profile.nickname, avatarData: profile.avatarData };
        this._publishProfile({
          nickname: profile.nickname,
          avatarData: profile.avatarData,
          loaded: true,
        });
      }
    } catch (_error) {
      if (!this._disposed && token === this._sequence) {
        this._publishProfile({ notice: '暂时无法读取个人资料，请稍后重试。' });
      }
    } finally {
      if (!this._disposed && token === this._sequence) {
        this._publishProfile({ busy: false });
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
      this._publishProfile({
        avatarPath: event.detail.avatarUrl,
        notice: '',
        hasUnsavedChanges: true,
      });
    }
  },
  onDefaultAvatar() {
    if (!this.data.busy && !this.data.pending) {
      this._publishProfile({ avatarPath: '', avatarData: '', hasUnsavedChanges: true });
    }
  },
  onNicknameInput(event) {
    if (!this.data.busy && !this.data.pending && this.data.loaded) {
      this._publishProfile({
        ...(typeof event?.detail?.value === 'string' ? { nickname: event.detail.value } : {}),
        hasUnsavedChanges: true,
      });
    }
  },
  async onSave(event) {
    if (this._disposed || this.data.busy || !this.data.loaded || this.data.pending) {
      return;
    }
    const token = ++this._sequence;
    this._saving = true;
    this._publishProfile({ busy: true, notice: '' });
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
      this._publishProfile({ pending: true });
      await this.submitProfile(token);
    } catch (error) {
      if (!this._disposed && token === this._sequence) {
        this._publishProfile({
          notice:
            error.code === 'INVALID_INPUT' ? error.message : '头像处理失败，请重新选择后保存。',
        });
      }
    } finally {
      if (!this._disposed && token === this._sequence) {
        this._saving = false;
        this._publishProfile({ busy: false });
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
      this._savedProfile = { nickname: profile.nickname, avatarData: profile.avatarData };
      this._pending = null;
      this._publishProfile({
        nickname: profile.nickname,
        avatarData: profile.avatarData,
        avatarPath: '',
        pending: false,
        hasUnsavedChanges: false,
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
      this._publishProfile({
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
    this._saving = true;
    this._publishProfile({ busy: true });
    await this.submitProfile(token);
    if (!this._disposed && token === this._sequence) {
      this._saving = false;
      this._publishProfile({ busy: false });
    }
  },
  onUnload() {
    this._disposed = true;
    this._sequence++;
    this._reloadConfirmSequence++;
    this._reloadConfirming = false;
    this._pending = null;
    this._savedProfile = null;
    this._leaveGuardNeedsSync = true;
    syncLeaveGuard(this, wx, '');
    this._unsubscribe?.();
  },
  onHide() {
    this._hidden = true;
    this._reloadConfirmSequence++;
    this._reloadConfirming = false;
  },
});
