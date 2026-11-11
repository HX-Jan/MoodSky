const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
} = require('../../modules/share/app-share');
const environment = require('../../config/environment.local');
const { cloudSessionState } = require('../../services/session-state');
const { backOrHome } = require('../../modules/system/navigation');
const {
  resetPageNavigation,
  pausePageNavigation,
} = require('../../modules/system/page-navigation');
const { syncLeaveGuard } = require('../../modules/system/leave-guard');
const { isExperience } = require('../../config/experience');
const journal = require('../../modules/journal/service');
const { createJournalController } = require('../../modules/journal/controller');
const { getSharedDemoService } = require('../../modules/journal/demo-session');
const reviewStore = require('../../modules/review/demo-store').reviewStore;
const { weatherChoices } = require('../../modules/presentation/jiaqi-design');
const { weatherFields } = require('../../shared/weather');

const ICONS = {
  SUNNY: '☀️',
  PARTLY_CLOUDY: '⛅',
  CLOUDY: '☁️',
  RAINY: '🌧️',
  STORMY: '⛈️',
  TYPHOON: '🌀',
  CUSTOM: '🌈',
};

Page({
  ...createAppShare({ route: 'pages/record/index' }),
  data: {
    isExperience: isExperience(environment),
    phase: 'loading',
    recordStatus: '正在读取',
    loaded: false,
  },

  onLoad(query = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/record/index',
        query,
      )
    ) {
      return;
    }
    this._suspended = false;
    this._disposed = false;
    resetPageNavigation(this);
    this.setData({
      isPilot:
        environment.cloudFunctionName === 'moodsky-private-pilot' &&
        environment.trustedSessionEnabled === true,
    });
    const pages = getCurrentPages();
    this._parentPage = pages[pages.length - 2] || null;
    this.setData({
      fromTask: query.fromTask === '1' && this._parentPage?.route === 'pages/tasks/index',
    });
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._demo = isDemo ? getSharedDemoService() : null;
    this._journal = createJournalController({
      service: this._demo || journal,
      isDemo,
      sessionState: cloudSessionState,
      onChanged: (change) => {
        // W1 Z05：本页保存/删除成功后同步回顾演示数据源并发布失效事件。
        this._onJournalChanged(change);
        const parent = this._parentPage;
        if (parent && typeof parent.onRecordChanged === 'function') {
          parent.onRecordChanged(change);
        }
      },
      onChange: (state) => {
        if (this._suspended || this._disposed) {
          return;
        }
        const leaveWarning = state.pendingRetry
          ? '操作结果尚未确认，离开可能丢失重试入口。请先重试原操作。'
          : state.hasUnsavedChanges
            ? '离开此页会丢失未保存的输入，请先保存。'
            : '';
        this.setData({
          ...state,
          // The editor uses state.text; its saved entry metadata needs no second body copy.
          entry: state.entry
            ? {
                id: state.entry.id,
                date: state.entry.date,
                ...weatherFields(state.entry),
                tags: [...state.entry.tags],
                version: state.entry.version,
                createdAt: state.entry.createdAt,
                updatedAt: state.entry.updatedAt,
              }
            : null,
          leaveWarning,
          weatherOptions: weatherChoices(
            state.weatherOptions.map((item) => ({
              ...item,
              icon: ICONS[item.code] || '🌈',
            })),
          ),
          isToday: state.date === state.today,
        });
        this._syncLeaveGuard(leaveWarning);
      },
    });
    this._pendingWeather = query && query.weather ? query.weather : '';
    const date = query && query.date ? query.date : undefined;
    const parentState =
      this._parentPage && this._parentPage._journal ? this._parentPage._journal.getState() : null;
    // Private free text stays in memory instead of entering a navigation URL.
    const pendingWeatherName =
      parentState &&
      parentState.date === date &&
      parentState.weather === 'CUSTOM' &&
      !parentState.entry
        ? parentState.weatherName
        : '';
    this._journal.loadDate(date).then((ok) => {
      if (ok && this._pendingWeather && !this._journal.getState().entry) {
        this._journal.chooseWeather(this._pendingWeather);
        if (this._pendingWeather === 'CUSTOM') {
          this._journal.setWeatherName(pendingWeatherName);
        }
      }
    });
  },

  onShow() {
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    enableAppShare(wx);
    this._suspended = false;
    this._leaveGuardNeedsSync = true;
    resetPageNavigation(this);
    if (this._journal) {
      return this._journal.refreshIfClean();
    }
  },

  onHide() {
    this._suspended = true;
    pausePageNavigation(this);
    // Clear only the render layer; the controller keeps drafts and unknown write requests.
    this.setData({
      entry: null,
      text: '',
      textCount: 0,
      tags: [],
      tagCount: 0,
      weather: '',
      weatherName: '',
      weatherNameCount: 0,
      weatherOptions: [],
      tagOptions: [],
      date: '',
      today: '',
      isToday: false,
      loaded: false,
      phase: 'loading',
      recordStatus: '正在读取',
      notice: '',
      confirm: '',
      confirmationDate: '',
      confirmationAction: '',
      inputLocked: true,
      canSave: false,
      canDelete: false,
      canRetry: false,
      canReload: false,
      pendingRetry: false,
      leaveWarning: '',
    });
  },

  onUnload() {
    this._disposed = true;
    pausePageNavigation(this);
    this._parentPage = null;
    this._leaveGuardNeedsSync = true;
    this._syncLeaveGuard('');
    if (this._journal) {
      this._journal.dispose();
    }
  },

  _syncLeaveGuard(message) {
    syncLeaveGuard(this, wx, message);
  },

  onWeather(event) {
    this._journal.chooseWeather(event.currentTarget.dataset.code);
  },
  onTag(event) {
    this._journal.toggleTag(event.currentTarget.dataset.id);
  },
  onText(event) {
    this._journal.setText(event.detail.value);
  },
  onWeatherName(event) {
    this._journal.setWeatherName(event.detail.value);
  },
  async onSave() {
    const saved = await this._journal.save();
    if (saved && this.data.fromTask) {
      backOrHome(wx, this);
    }
    return saved;
  },
  onDelete() {
    this._journal.requestDelete();
  },
  async onConfirmDelete() {
    const ok = await this._journal.confirmDelete();
    const state = this._journal.getState();
    if (ok && !this._suspended && !this._disposed && state.loaded && !state.entry) {
      backOrHome(wx, this);
    }
  },
  onCancel() {
    this._journal.cancelConfirm();
  },
  onRetry() {
    return this._journal.retry();
  },
  onReload() {
    return this._journal.loadDate();
  },
  onConfirmReload() {
    return this._journal.confirmReload();
  },
  // W1 Z05：kind 为 'saved' / 'deleted'。读取该日最新记录同步到回顾演示数据源，
  // 由 reviewStore 发布失效事件，月历、月份档案与卡片页面订阅后重新渲染。
  _onJournalChanged(info) {
    if (!this._demo || !info || typeof info.date !== 'string') {
      return;
    }
    reviewStore.syncFromJournal(this._demo, info).catch(() => {});
  },
});
