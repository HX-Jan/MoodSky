const environment = require('../../config/environment.local');
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
  data: { phase: 'loading', recordStatus: '正在读取', loaded: false, showDemoTools: false },
  onToggleDemoTools() {
    this.setData({ showDemoTools: !this.data.showDemoTools });
  },

  onLoad() {
    this._disposed = false;
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._demo = isDemo ? getSharedDemoService() : null;
    this._journal = createJournalController({
      service: this._demo || journal,
      isDemo,
      onChange: (state) => this.setData(this._mapState(state)),
      // W1 Z05：本页保存/删除成功后同步回顾演示数据源并发布失效事件。
      onChanged: (change) => this._onJournalChanged(change),
    });
    this._journal.loadDate();
  },

  onShow() {
    design.syncTab(this, 0);
    if (!this._journal) {
      return;
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
    this._disposed = true;
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
    return {
      ...state,
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
      saveButtonText: !selected
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
    wx.navigateTo({ url });
  },
  // Jiaqi N01: navigation only; choosing a need never saves a journal or task.
  onNeeds() {
    if (this._disposed || !this._journal || this._journal.getState().inputLocked) {
      return;
    }
    wx.showActionSheet({
      itemList: [
        '记录一下',
        '找个安静的地方',
        '想说几句',
        '做件很小的事',
        '回顾一下',
        '暂时不想做任何事',
      ],
      success: ({ tapIndex }) => {
        if (this._disposed || this._journal.getState().inputLocked) {
          return;
        }
        if (tapIndex === 0 || tapIndex === 2) {
          this.onWrite();
        } else if (tapIndex === 1) {
          wx.switchTab({ url: '/pages/campus/index' });
        } else if (tapIndex === 3) {
          wx.navigateTo({ url: '/pages/tasks/index' });
        } else if (tapIndex === 4) {
          wx.switchTab({ url: '/pages/universe/index' });
        }
        // Rest and cancellation leave the current draft untouched.
      },
    });
  },
  // 修改今天这条记录 → 私人记录页
  onEditEntry() {
    const state = this._journal.getState();
    if (state.entry && !state.inputLocked) {
      wx.navigateTo({ url: '/pages/record/index?date=' + state.date });
    }
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
