const environment = require('../../config/environment.local');
const journal = require('../../modules/journal/service');
const { createJournalController } = require('../../modules/journal/controller');
const { createMemoryJournalService } = require('../../modules/journal/demo-service');
const ICONS = { SUNNY: '☀', PARTLY_CLOUDY: '⛅', CLOUDY: '☁', RAINY: '☂', STORMY: '⛈' };

Page({
  data: { weatherOptions: [], tagOptions: [], phase: 'loading', recordStatus: '正在读取' },
  onLoad() {
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._demo = isDemo ? createMemoryJournalService() : null;
    this._journal = createJournalController({
      service: this._demo || journal,
      isDemo,
      onChange: (state) =>
        this.setData({
          ...state,
          weatherOptions: state.weatherOptions.map((item) => ({ ...item, icon: ICONS[item.code] })),
        }),
    });
    this._journal.loadDate();
  },
  onShow() {
    if (this._journal) {
      this._journal.refreshToday();
    }
  },
  onUnload() {
    if (this._journal) {
      this._journal.dispose();
    }
    if (this._demo) {
      this._demo.clear();
    }
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
  onSave() {
    return this._journal.save();
  },
  onRetry() {
    return this._journal.retry();
  },
  onReload() {
    return this._journal.loadDate();
  },
  onDelete() {
    this._journal.requestDelete();
  },
  onConfirmDelete() {
    return this._journal.confirmDelete();
  },
  onConfirmReload() {
    return this._journal.confirmReload();
  },
  onCancel() {
    this._journal.cancelConfirm();
  },
  onDemoFailure() {
    if (this._demo && this._journal.getState().canSave) {
      this._demo.failNext('after-save');
      return this._journal.save();
    }
  },
});
