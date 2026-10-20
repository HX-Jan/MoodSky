// 月份列表（W1 Z03）：月份档案入口。仅展示月份与记录条数，不含任何记录内容。
// 合成数据：2026-10、2026-09 有记录；2026-08 为全空月份样例（EMPTY_DEMO_MONTH 始终列出以演示空态）。
const environment = require('../../../config/environment.local');
const { reviewStore } = require('../../../modules/review/demo-store');
const { EMPTY_DEMO_MONTH } = require('../../../modules/review/demo-data');
const { businessDate, isBusinessDate } = require('../../../shared/date');

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return year + '年' + monthNumber + '月';
}

Page({
  data: { isDemo: false, cloudEnabled: false, months: [], selectedMonth: '', error: '' },
  onLoad(options) {
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    const candidate = options && options.month;
    const selectedMonth =
      typeof candidate === 'string' &&
      /^\d{4}-\d{2}$/.test(candidate) &&
      isBusinessDate(candidate + '-01')
        ? candidate
        : businessDate().slice(0, 7);
    this.setData({ isDemo, cloudEnabled: environment.cloudEnabled === true, selectedMonth });
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
  _reload() {
    try {
      const counts = new Map();
      for (const entry of reviewStore.listAll()) {
        const month = entry.date.slice(0, 7);
        counts.set(month, (counts.get(month) || 0) + 1);
      }
      const months = [...counts.entries()]
        .map(([month, count]) => ({
          month,
          label: monthLabel(month),
          recordCount: count,
          empty: false,
        }))
        .sort((a, b) => (a.month > b.month ? -1 : 1));
      // 演示空月入口：真实接口的月份目录分页仍是缺口（见 w1-h04 第 3.4 节），此处仅为演示补充。
      if (!counts.has(EMPTY_DEMO_MONTH)) {
        months.push({
          month: EMPTY_DEMO_MONTH,
          label: monthLabel(EMPTY_DEMO_MONTH),
          recordCount: 0,
          empty: true,
        });
        months.sort((a, b) => (a.month > b.month ? -1 : 1));
      }
      this.setData({ months, error: '' });
    } catch (error) {
      this.setData({ error: error && error.message ? error.message : '月份列表读取失败。' });
    }
  },
  onMonthTap(event) {
    const month = event.currentTarget.dataset.month;
    if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && isBusinessDate(month + '-01')) {
      wx.navigateTo({ url: '/pages/review/month/index?month=' + month });
    }
  },
  onMonthPick(event) {
    const month = event.detail.value;
    if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && isBusinessDate(month + '-01')) {
      this.setData({ selectedMonth: month });
    }
  },
  onOpenSelectedMonth() {
    if (this.data.cloudEnabled && this.data.selectedMonth) {
      this.onMonthTap({ currentTarget: { dataset: { month: this.data.selectedMonth } } });
    }
  },
});
