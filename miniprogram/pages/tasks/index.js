const { createTaskDemoService } = require('../../modules/tasks/demo');
const environment = require('../../config/environment.local');

const ERROR_COPY = {
  UNAUTHENTICATED: '游客可以浏览建议；选择、完成、替换、跳过和历史需要登录。',
  INVALID_INPUT: '这项任务操作在当前状态下不可用。',
  CONFLICT: '同一个演示请求不能修改成另一项操作。',
};

Page({
  data: {
    isDemo: false,
    view: 'suggestions',
    isAuthenticated: false,
    modeLabel: '游客浏览',
    toggleLabel: '进入本地登录演示',
    suggestions: [],
    history: [],
    notice: '建议是合成内容；游客只能浏览，登录后才可写入任务状态。',
    noticeType: 'info',
  },

  onLoad() {
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this.setData({ isDemo });
    if (!isDemo) {
      return;
    }
    this._service = createTaskDemoService();
    this.render();
  },

  onShow() {
    if (this._service) {
      this.render();
    }
  },

  onUnload() {
    if (this._service) {
      this._service.clear();
    }
  },

  render() {
    const authenticated = this._service.isAuthenticated();
    this.setData({
      isAuthenticated: authenticated,
      modeLabel: authenticated ? '合成账号已登录' : '游客浏览',
      toggleLabel: authenticated ? '退出本地登录演示' : '进入本地登录演示',
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
      view: 'suggestions',
      notice: authenticated
        ? '当前是合成账号登录态；写入只存在内存，不代表真实云端成功。'
        : '已退出本地登录演示；私人任务状态和历史不再显示。',
      noticeType: 'info',
    });
    this.render();
  },

  onView(event) {
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
