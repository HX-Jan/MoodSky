// 指定月份档案页（W1 Z03）：展示该月卡片列表。卡片默认内容只有日期与天气，
// 不渲染正文或任何记录内容（服务层 monthArchive 也不返回正文）。点击卡片进入本人详情页。
const environment = require('../../../config/environment.local');
const { isExperience } = require('../../../config/experience');
const { reviewStore } = require('../../../modules/review/demo-store');
const { reviewDemoService } = require('../../../modules/review/demo-service');
const { reviewReader, reviewErrorMessage } = require('../../../modules/review/reader');

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return year + '年' + monthNumber + '月';
}

function dateLabel(date) {
  const day = Number(date.slice(8, 10));
  const weekday = WEEKDAY_NAMES[new Date(Date.parse(date + 'T00:00:00.000Z')).getUTCDay()];
  return monthLabel(date.slice(0, 7)) + day + '日 · 周' + weekday;
}

Page({
  data: {
    isExperience: isExperience(environment),
    isDemo: false,
    reviewEnabled: false,
    month: '',
    monthLabel: '',
    cards: [],
    recordCount: 0,
    loading: false,
    error: '',
  },
  onLoad(options) {
    this._seq = 0;
    this._disposed = false;
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._enabled = isDemo || environment.cloudEnabled === true;
    this._service = isDemo ? reviewDemoService : reviewReader;
    this.setData({ isDemo, reviewEnabled: this._enabled });
    this._month = options && typeof options.month === 'string' ? options.month : '';
    if (isDemo) {
      this._unsubscribe = reviewStore.subscribe(() => this._reload());
    }
    if (this._enabled) {
      this._reload();
    }
  },
  onShow() {
    this._suspended = false;
    if (this._enabled && !this.data.loading) {
      this._reload();
    }
  },
  onHide() {
    if (!this.data.isDemo) {
      this._suspended = true;
      this._seq += 1;
      this.setData({ cards: [], recordCount: 0, loading: false });
    }
  },
  onRetry() {
    return this._reload();
  },
  onUnload() {
    this._disposed = true;
    this._seq += 1;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },
  async _reload() {
    if (!this._enabled || this._disposed || this._suspended) {
      return;
    }
    if (!this._month) {
      this.setData({ error: '缺少月份参数，请从月份档案进入。' });
      return;
    }
    const token = ++this._seq;
    this.setData({ loading: true, error: '', cards: [], recordCount: 0 });
    try {
      const result = await this._service.monthArchive(this._month);
      if (token !== this._seq) {
        return;
      }
      const data = result.data;
      this.setData({
        month: data.month,
        monthLabel: monthLabel(data.month),
        recordCount: data.recordCount,
        cardTextPreview: data.cardTextPreview,
        cards: data.cards.map((card) => {
          const view = this._service.weatherView(card.weather, card.weatherName);
          return { ...card, dateLabel: dateLabel(card.date), icon: view.icon, label: view.label };
        }),
        loading: false,
      });
    } catch (error) {
      if (token !== this._seq) {
        return;
      }
      this.setData({
        loading: false,
        cards: [],
        recordCount: 0,
        error: reviewErrorMessage(error),
      });
    }
  },
  // 从月份入口直接定位到指定记录：携带 month/date/entryId 进入详情，详情页会核对 id 防止旧卡。
  onCardTap(event) {
    const { date, id } = event.currentTarget.dataset;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: '/pages/review/detail/index?month=' + this._month + '&date=' + date + '&id=' + id,
    });
  },
});
