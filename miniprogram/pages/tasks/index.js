const { createCloudTaskController } = require('../../modules/tasks/cloud');
const { createTaskDemoService } = require('../../modules/tasks/demo');
const environment = require('../../config/environment.local');
const { isExperience } = require('../../config/experience');
const { createCloudSession } = require('../../modules/account/cloud-session');
const { createPrivateTaskService } = require('../../modules/tasks/service');

const ERROR_COPY = {
  UNAUTHENTICATED: '游客可以浏览建议；选择、完成、替换、跳过和历史需要登录。',
  INVALID_INPUT: '这项任务操作在当前状态下不可用。',
  CONFLICT: '同一个演示请求不能修改成另一项操作。',
};

Page({
  data: {
    isExperience: isExperience(environment),
    isDemo: false,
    isCloud: false,
    loading: false,
    busy: false,
    retryPending: false,
    writeBlocked: true,
    tasksReadOnly: false,
    quickEntries: [],
    view: 'suggestions',
    isAuthenticated: false,
    modeLabel: '游客浏览',
    toggleLabel: '进入本地登录演示',
    suggestions: [],
    history: [],
    notice: '建议是合成内容；游客只能浏览，登录后才可写入任务状态。',
    noticeType: 'info',
  },

  onLoad(query = {}) {
    this._disposed = false;
    this._hidden = false;
    this._connectSequence = 0;
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this.setData({ isDemo, view: query.view === 'history' ? 'history' : 'suggestions' });
    if (!isDemo) {
      if (environment.cloudEnabled === true) {
        this.setData({ isCloud: true, modeLabel: '云服务模式', notice: '' });
        const pilot =
          environment.cloudFunctionName === 'moodsky-private-pilot' &&
          environment.trustedSessionEnabled === true;
        this._cloudSession = pilot ? createCloudSession() : null;
        this._cloud = createCloudTaskController({
          publish: (patch) => this.setData(patch),
          ...(pilot
            ? {
                session: this._cloudSession,
                api: createPrivateTaskService(),
                refreshAfterWrite: true,
              }
            : {}),
        });
        if (pilot) {
          this.connectCloud(false);
        } else {
          this._cloud.load(this.data.view);
          this._cloud.loadChoices();
        }
      }
      return;
    }
    if (this.data.isExperience) {
      this.setData({ notice: '示例任务仅供体验，不读取真实账号；离开页面后清空。' });
    }
    this._service = createTaskDemoService({ seedHistory: !this.data.isExperience });
    this.render();
  },

  onShow() {
    this._hidden = false;
    if (this._cloud && this._cloudNeedsRefresh) {
      this._cloudNeedsRefresh = false;
      if (this._cloudSession) {
        this.connectCloud(true);
      } else {
        this._cloud.resume(this.data.view);
      }
    }
    if (this._service) {
      this.render();
    }
  },

  onHide() {
    this._hidden = true;
    this._connectSequence++;
    if (this._cloud) {
      this._cloudNeedsRefresh = true;
      this._cloud.suspend();
    }
  },

  onUnload() {
    this._disposed = true;
    this._connectSequence++;
    if (this._cloudSession) {
      this._cloudSession.dispose();
    }
    if (this._cloud) {
      this._cloud.suspend();
      this._cloud.dispose();
    }
    if (this._service) {
      this._service.clear();
    }
  },

  async connectCloud(resume) {
    const sequence = ++this._connectSequence;
    const ready = await this._cloudSession.refresh();
    if (this._disposed || this._hidden || sequence !== this._connectSequence) {
      return;
    }
    this.setData({
      isAuthenticated: ready,
      modeLabel: ready ? '本人受限云测试' : '本人云测试未就绪',
    });
    if (!ready) {
      this.setData({
        writeBlocked: true,
        loading: false,
        notice: '本人测试账号尚未验证，未读取私人任务。',
        noticeType: 'warning',
      });
      return;
    }
    if (resume) {
      await this._cloud.resume(this.data.view);
    } else {
      await Promise.all([this._cloud.load(this.data.view), this._cloud.loadChoices()]);
    }
  },

  render() {
    const authenticated = this._service.isAuthenticated();
    this.setData({
      isAuthenticated: authenticated,
      modeLabel: this.data.isExperience
        ? authenticated
          ? '本次任务体验中'
          : '浏览示例建议'
        : authenticated
          ? '合成账号已登录'
          : '游客浏览',
      toggleLabel: this.data.isExperience
        ? authenticated
          ? '结束本次体验'
          : '开始本次任务体验'
        : authenticated
          ? '退出本地登录演示'
          : '进入本地登录演示',
      suggestions: this._service.suggestions(),
      history: authenticated ? this._service.getHistory() : [],
    });
  },

  onToggleAuth() {
    if (!this._service) {
      return;
    }
    const authenticated = this._service.setAuthenticated(!this._service.isAuthenticated());
    this.setData({
      view: authenticated ? this.data.view : 'suggestions',
      notice: this.data.isExperience
        ? authenticated
          ? '仅操作本页的示例任务，离开后清空；未连接真实账号。'
          : '体验已结束，任务状态不再显示。'
        : authenticated
          ? '当前是合成账号登录态；写入只存在内存，不代表真实云端成功。'
          : '已退出本地登录演示；私人任务状态和历史不再显示。',
      noticeType: 'info',
    });
    this.render();
  },

  onQuickChoice(event) {
    const kind = event.currentTarget.dataset.kind;
    if (!this.data.quickEntries.some((item) => item.kind === kind && item.enabled)) {
      return;
    }
    if (kind === 'places') {
      wx.switchTab({ url: '/pages/campus/index' });
    }
    if (kind === 'tasks') {
      this.setData({ view: 'suggestions' });
      this.onRetry();
    }
  },

  onRetry() {
    if (this._cloud) {
      if (this._cloudSession && !this._cloudSession.capture()) {
        return this.connectCloud(true);
      }
      return this.data.retryPending ? this._cloud.retry() : this._cloud.load(this.data.view);
    }
  },

  onView(event) {
    if (this._cloud) {
      const view = event.currentTarget.dataset.view;
      if (!['suggestions', 'history'].includes(view) || this.data.busy || this.data.retryPending) {
        return;
      }
      this.setData({ view });
      return this._cloud.load(view);
    }
    if (!this._service) {
      return;
    }
    const view = event.currentTarget.dataset.view;
    if (view !== 'suggestions' && view !== 'history') {
      return;
    }
    if (view === 'history' && !this._service.isAuthenticated()) {
      this.setData({
        view,
        notice: ERROR_COPY.UNAUTHENTICATED,
        noticeType: 'warning',
      });
      return;
    }
    this.setData({ view });
  },

  onTaskAction(event) {
    if (this._cloud) {
      const { taskId, action } = event.currentTarget.dataset;
      return this._cloud.transition(taskId, action);
    }
    if (!this._service) {
      return;
    }
    const { taskId, action } = event.currentTarget.dataset;
    try {
      const result = this._service.transition({ taskId, action });
      const copy = {
        select: '已选择这项合成任务。',
        complete: result.idempotent ? '这项任务已经完成。' : '已记录为完成（仅本地演示）。',
        replace: '已替换这项任务，可以选择其他建议。',
        skip: '已跳过这项任务，可以稍后再选。',
      };
      this.setData({ notice: copy[action], noticeType: 'success' });
      this.render();
    } catch (error) {
      const code = error && error.code;
      this.setData({
        notice: ERROR_COPY[code] || '任务操作未完成；演示没有写入云端。',
        noticeType: 'warning',
      });
    }
  },
});
