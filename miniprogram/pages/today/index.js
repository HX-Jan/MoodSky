const {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
} = require('../../modules/share/app-share');
const environment = require('../../config/environment.local');
const { clientCapabilities } = require('../../modules/system/capabilities');
const { hasRememberedLogin } = require('../../modules/account/login-memory');
const { cloudSessionState } = require('../../services/session-state');
const {
  navigateOnce,
  resetPageNavigation,
  pausePageNavigation,
} = require('../../modules/system/page-navigation');
const { isBusinessDate } = require('../../shared/date');
const { isExperience } = require('../../config/experience');
const { WEATHER_TYPES, JOURNAL_TAGS } = require('../../shared/constants');
const journal = require('../../modules/journal/service');
const { createJournalController } = require('../../modules/journal/controller');
const {
  getSharedDemoService,
  clearSharedDemoService,
} = require('../../modules/journal/demo-session');
const reviewStore = require('../../modules/review/demo-store').reviewStore;
const design = require('../../modules/presentation/jiaqi-design');
const { weatherLabel, weatherFields } = require('../../shared/weather');

const WEATHER_ICONS = {
  SUNNY: '☀️',
  PARTLY_CLOUDY: '⛅',
  CLOUDY: '☁️',
  RAINY: '🌧️',
  STORMY: '⛈️',
  TYPHOON: '🌀',
  CUSTOM: '🌈',
};
const WEATHER_LABEL_MAP = WEATHER_TYPES.reduce((map, item) => {
  map[item.code] = item.label;
  return map;
}, {});
const TAG_LABEL_MAP = JOURNAL_TAGS.reduce((map, item) => {
  map[item.id] = item.label;
  return map;
}, {});

Page({
  ...createAppShare({ route: 'pages/today/index' }),
  data: {
    isGuest: false,
    tasksVisible: clientCapabilities(environment).tasks.state !== 'unavailable',
    isExperience: isExperience(environment),
    phase: 'loading',
    recordStatus: '正在读取',
    loaded: false,
    showDemoTools: false,
  },
  onToggleDemoTools() {
    this.setData({ showDemoTools: !this.data.showDemoTools });
  },
  onWechatLogin() {
    const returnTo =
      this._shareOptions?.fromShare === 'page'
        ? '?returnTo=' + encodeURIComponent(this.onShareAppMessage().path)
        : '';
    navigateOnce(this, wx, '/pages/login/index' + returnTo);
  },

  onLoad(options = {}) {
    if (
      prepareSharedPage(
        this,
        typeof wx === 'undefined' ? null : wx,
        environment,
        'pages/today/index',
        options,
      )
    ) {
      return;
    }
    this._disposed = false;
    this._hidden = false;
    this._pullRefresh = null;
    this._sharedDate = isBusinessDate(options.date) ? options.date : undefined;
    this.setData({
      isPilot:
        environment.cloudFunctionName === 'moodsky-private-pilot' &&
        environment.trustedSessionEnabled === true,
    });
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._demo = isDemo ? getSharedDemoService() : null;
    this._journal = createJournalController({
      service: this._demo || journal,
      isDemo,
      sessionState: cloudSessionState,
      onChange: (state) => this.setData(this._mapState(state)),
      // W1 Z05：本页保存/删除成功后同步回顾演示数据源并发布失效事件。
      onChanged: (change) => this._onJournalChanged(change),
    });
    const guest =
      environment.explicitWechatLogin === true &&
      !cloudSessionState.capture() &&
      !hasRememberedLogin(wx);
    this.setData({ isGuest: guest });
    if (!guest) {
      this._journal.loadDate(this._sharedDate);
    }
  },

  onShow() {
    this._hidden = false;
    resetPageNavigation(this);
    if (this.data.shareSinglePage || this._shareLoginRedirected) {
      return;
    }
    enableAppShare(wx);
    design.syncTab(this, 0);
    if (!this._journal) {
      return;
    }
    const guest =
      environment.explicitWechatLogin === true &&
      !cloudSessionState.capture() &&
      !hasRememberedLogin(wx);
    const wasGuest = this.data.isGuest;
    this.setData({ isGuest: guest });
    if (guest) {
      if (!wasGuest) {
        this._journal.reset();
      }
      return;
    }
    if (wasGuest) {
      return this._journal.loadDate(this._sharedDate);
    }
    // Confirmed child changes require a new read. Ordinary lifecycle refresh
    // only proceeds for a clean form, preserving drafts and original requests.
    if (this._recordChangedDate) {
      const date = this._recordChangedDate;
      this._recordChangedDate = '';
      this._journal.reset();
      return this._journal.loadDate(date);
    }
    return this._journal.refreshIfClean();
  },
  onRecordChanged(change) {
    if (change && ['saved', 'deleted'].includes(change.kind) && change.date === this.data.date) {
      this._recordChangedDate = change.date;
    }
  },

  onUnload() {
    pausePageNavigation(this);
    this._needsMenuSequence = (this._needsMenuSequence || 0) + 1;
    this._disposed = true;
    this._finishPullRefresh();
    if (this._journal) {
      this._journal.dispose();
    }
  },

  _mapState(state) {
    const weatherOptions = design.weatherChoices(
      state.weatherOptions.map((item) => ({
        ...item,
        icon: WEATHER_ICONS[item.code] || '🌈',
      })),
    );
    const selected = weatherOptions.find((item) => item.selected);
    const tagText = state.entry
      ? state.entry.tags.map((id) => TAG_LABEL_MAP[id] || id).join(' · ')
      : '';
    const [year, month, day] = (state.date || '').split('-');
    return {
      ...state,
      dateYear: day ? year + '年' : '',
      dateMonthDay: day ? Number(month) + '月' + Number(day) + '日' : '',
      // The controller retains writing for safe edits; the summary render layer never receives it.
      text: '',
      textCount: 0,
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
      weatherOptions,
      selectedWeatherLabel: selected ? selected.label : '',
      saveButtonText:
        state.phase === 'saving'
          ? '正在保存…'
          : !selected
            ? '先选一种天气'
            : state.isOlderNewDate
              ? '超出可新建范围'
              : state.date === state.today
                ? '保存今天的天气'
                : '保存这一天的天气',
      entryWeatherIcon: state.entry ? WEATHER_ICONS[state.entry.weather] || '🌈' : '',
      entryWeatherLabel: state.entry
        ? weatherLabel(state.entry.weather, state.entry.weatherName) ||
          WEATHER_LABEL_MAP[state.entry.weather] ||
          ''
        : '',
      entryTagText: tagText,
      isToday: state.date === state.today,
    };
  },

  onWeather(event) {
    if (!WEATHER_TYPES.some((item) => item.code === event.currentTarget.dataset.code)) {
      return;
    }
    this._journal.chooseWeather(event.currentTarget.dataset.code);
  },
  onSave() {
    return this._journal.save();
  },
  onWeatherName(event) {
    this._journal.setWeatherName(event.detail.value);
  },
  onRetry() {
    return this._journal.retry();
  },
  onReload() {
    return this._journal.loadDate();
  },
  onPullDownRefresh() {
    if (this._disposed || this._hidden || this.data.shareSinglePage || this._shareLoginRedirected) {
      return Promise.resolve(false);
    }
    if (this._pullRefresh) {
      return this._pullRefresh.promise;
    }
    const operation = {};
    this._pullRefresh = operation;
    operation.promise = (async () => {
      try {
        if (this.data.isGuest || !this._journal) {
          return false;
        }
        // A gesture only refreshes a clean form; explicit discard/retry remains separate.
        const refreshed = await this._journal.refreshIfClean();
        if (!refreshed && this._pullRefresh === operation) {
          const state = this._journal.getState();
          const message = ['loading', 'saving', 'deleting'].includes(state.phase)
            ? '请等待当前操作完成'
            : state.pendingRetry
              ? '请先重试原操作'
              : state.confirm
                ? '请先处理页面上的确认'
                : state.hasUnsavedChanges
                  ? '未保存的内容已保留'
                  : state.requiresReload
                    ? '请先处理记录变化提示'
                    : '';
          if (message) {
            wx.showToast?.({ title: message, icon: 'none' });
          }
        }
        return refreshed;
      } catch (_error) {
        if (this._pullRefresh === operation) {
          wx.showToast?.({ title: '暂时无法刷新，请稍后重试', icon: 'none' });
        }
        return false;
      } finally {
        this._finishPullRefresh(operation);
      }
    })();
    return operation.promise;
  },
  _finishPullRefresh(operation = this._pullRefresh) {
    if (!operation || this._pullRefresh !== operation) {
      return;
    }
    this._pullRefresh = null;
    try {
      wx.stopPullDownRefresh?.();
    } catch (_error) {
      // Older native implementations must not prevent later page interactions.
    }
  },
  onConfirmReload() {
    return this._journal.confirmReload();
  },
  onCancel() {
    this._journal.cancelConfirm();
  },
  onDate(event) {
    return this._journal.loadDate(event.detail.value);
  },
  onPreviousDate() {
    return this._journal.moveDate(-1);
  },
  onNextDate() {
    return this._journal.moveDate(1);
  },
  onToday() {
    return this._journal.moveDate('today');
  },
  // 想写几句？→ 私人记录页（带当前选中天气）
  onWrite() {
    const state = this._journal.getState();
    if (state.inputLocked || !state.loaded) {
      return;
    }
    const weather = state.entry ? '' : state.weather;
    const url = '/pages/record/index?date=' + state.date + (weather ? '&weather=' + weather : '');
    navigateOnce(this, wx, url);
  },
  // Jiaqi N01 entry: public shortcuts; writing and review keep their dedicated entries.
  onNeeds() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.isGuest ||
      this.data.shareSinglePage ||
      this._shareLoginRedirected ||
      this._needsMenuOpen ||
      !this._journal ||
      this._journal.getState().inputLocked
    ) {
      return;
    }
    const sequence = (this._needsMenuSequence || 0) + 1;
    this._needsMenuSequence = sequence;
    this._needsMenuOpen = true;
    const binding = cloudSessionState.capture();
    const date = this._journal.getState().date;
    const release = () => {
      if (sequence !== this._needsMenuSequence) {
        return false;
      }
      this._needsMenuOpen = false;
      return true;
    };
    const failed = (error) => {
      if (!release() || this._disposed || this._hidden || binding !== cloudSessionState.capture()) {
        return;
      }
      if (!/cancel/i.test(error?.errMsg || '')) {
        wx.showToast?.({ title: '暂时无法打开，请重试', icon: 'none' });
      }
    };
    try {
      wx.showActionSheet({
        itemList: this.data.tasksVisible ? ['校园地点', '小任务'] : ['校园地点'],
        success: ({ tapIndex }) => {
          if (
            this._disposed ||
            this._hidden ||
            !this._needsMenuOpen ||
            sequence !== this._needsMenuSequence ||
            binding !== cloudSessionState.capture() ||
            date !== this._journal.getState().date ||
            this._journal.getState().inputLocked
          ) {
            return;
          }
          if (tapIndex === 0) {
            navigateOnce(this, wx, '/pages/campus/index', 'switchTab');
          } else if (tapIndex === 1 && this.data.tasksVisible) {
            navigateOnce(this, wx, '/pages/tasks/index');
          }
        },
        fail: failed,
        complete: release,
      });
    } catch (_error) {
      failed();
    }
  },
  // 修改今天这条记录 → 私人记录页
  onEditEntry() {
    const state = this._journal.getState();
    if (state.entry && !state.inputLocked) {
      navigateOnce(this, wx, '/pages/record/index?date=' + state.date);
    }
  },
  onHide() {
    this._hidden = true;
    this._finishPullRefresh();
    pausePageNavigation(this);
    this._needsMenuSequence = (this._needsMenuSequence || 0) + 1;
    this._needsMenuOpen = false;
  },
  onDemoFailure() {
    if (this._demo && this._journal.getState().canSave) {
      this._demo.failNext('after-save');
      return this._journal.save();
    }
  },
  onDemoClear() {
    if (!this._demo) {
      return;
    }
    clearSharedDemoService();
    // W1 Z05：演示清空同时作用于回顾数据源，保持 Today 与 Universe 月历一致。
    reviewStore.clearAll();
    this._journal.reset();
    this._journal.loadDate();
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
