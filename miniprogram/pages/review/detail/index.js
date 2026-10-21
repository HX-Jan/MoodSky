// 记录详情页（本人详情，W1 Z01/Z03）。本页读取全文；卡片与统计只读取标记。
// 进入时按日期重新读取并核对 entryId（H04 §3.1）：记录已删除或已重建时明确提示，不打开旧卡（R06/R07）。
const environment = require('../../../config/environment.local');
const { isBusinessDate } = require('../../../shared/date');
const { JOURNAL_TAGS } = require('../../../shared/constants');
const { reviewDemoService } = require('../../../modules/review/demo-service');
const { reviewStore } = require('../../../modules/review/demo-store');
const { reviewReader, reviewErrorMessage } = require('../../../modules/review/reader');

function formatDateTime(iso) {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) {
    return '';
  }
  // 业务时区 Asia/Shanghai：演示中以 +8 展示时间。
  const shifted = new Date(Date.parse(iso) + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}

Page({
  data: {
    isDemo: false,
    phase: 'loading', // loading | ready | missing | stale | error
    dateLabel: '',
    icon: '',
    weatherLabel: '',
    tags: [],
    text: '',
    versionText: '',
    updatedAtText: '',
    errorMessage: '',
  },
  onLoad(options) {
    this._seq = 0;
    this._disposed = false;
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this._enabled = isDemo || environment.cloudEnabled === true;
    this._service = isDemo ? reviewDemoService : reviewReader;
    this.setData({ isDemo });
    this._query = options || {};
    if (isDemo) {
      this._unsubscribe = reviewStore.subscribe(() => this._reload());
    }
    if (this._enabled) {
      this._reload();
    } else {
      this.setData({ phase: 'error', errorMessage: '记录服务尚未连接，当前不展示模拟内容。' });
    }
  },
  onShow() {
    const wasHidden = this._suspended;
    this._suspended = false;
    if (this._enabled && !this._disposed && (wasHidden || this.data.phase !== 'loading')) {
      this._reload();
    }
  },
  onHide() {
    this._suspended = true;
    this._seq += 1;
    this.setData({
      phase: 'loading',
      text: '',
      tags: [],
      dateLabel: '',
      icon: '',
      weatherLabel: '',
      versionText: '',
      updatedAtText: '',
    });
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
    const date = this._query.date;
    if (!isBusinessDate(date)) {
      this.setData({ phase: 'error', errorMessage: '缺少有效的记录日期参数。' });
      return;
    }
    const token = ++this._seq;
    this.setData({
      phase: 'loading',
      errorMessage: '',
      text: '',
      tags: [],
      dateLabel: '',
      icon: '',
      weatherLabel: '',
      versionText: '',
      updatedAtText: '',
    });
    try {
      const result = await this._service.getEntry(date);
      if (token !== this._seq) {
        return; // 迟到响应不覆盖当前详情。
      }
      const entry = result.data.entry;
      if (!entry) {
        this.setData({
          phase: 'missing',
        });
        return;
      }
      if (this._query.id && entry.id !== this._query.id) {
        // 记录删除后重建会更换 entryId：旧链接不展示内容，避免误开旧卡。
        this.setData({ phase: 'stale' });
        return;
      }
      const view = this._service.weatherView(entry.weather);
      this.setData({
        phase: 'ready',
        dateLabel: date,
        icon: view.icon,
        weatherLabel: view.label,
        tags: entry.tags.map((id) => {
          const found = JOURNAL_TAGS.find((item) => item.id === id);
          return { id, label: found ? found.label : id };
        }),
        text: entry.text,
        versionText: 'v' + entry.version,
        updatedAtText: '最近更新 ' + formatDateTime(entry.updatedAt),
      });
    } catch (error) {
      if (token !== this._seq) {
        return;
      }
      this.setData({
        phase: 'error',
        errorMessage: reviewErrorMessage(error),
      });
    }
  },
  onBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/universe/index' }),
    });
  },
});
