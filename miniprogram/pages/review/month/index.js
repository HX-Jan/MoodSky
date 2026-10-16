// 指定月份档案页（W1 Z03）：展示该月卡片列表。卡片默认内容只有日期与天气，
// 不渲染正文或任何记录内容（服务层 monthArchive 也不返回正文）。点击卡片进入本人详情页。
const environment = require('../../../config/environment.local');
const { reviewStore } = require('../../../modules/review/demo-store');
const { reviewDemoService } = require('../../../modules/review/demo-service');

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
    isDemo: false,
    month: '',
    monthLabel: '',
    cards: [],
    recordCount: 0,
    loading: false,
    error: '',
  },
  onLoad(options) {
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this.setData({ isDemo });
    this._month = options && typeof options.month === 'string' ? options.month : '';
    if (isDemo) {
      this._unsubscribe = reviewStore.subscribe(() => this._reload());
      this._reload();
    }
  },
  onShow() {
    if (this.data.isDemo) {
      this._reload();
    }
  },
  onUnload() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },
  async _reload() {
    if (!this._month) {
      this.setData({ error: '缺少月份参数，请从月份档案进入。' });
      return;
    }
    const token = ++this._seq;
    this.setData({ loading: true, error: '' });
    try {
      const result = await reviewDemoService.monthArchive(this._month);
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
          const view = reviewDemoService.weatherView(card.weather);
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
        error: error && error.message ? error.message : '月份档案读取失败。',
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
