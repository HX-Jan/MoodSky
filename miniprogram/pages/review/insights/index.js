// 分布与时间线（W1 Z04）。三项统计展示规则：
// 1) 分母始终为实际记录数 recordCount（不是窗口天数）；2) 缺失日期留白，不补天气；
// 3) 记录不足 3 条不输出趋势结论。支持固定合成样例（0/2/3 条）与当前演示数据两种来源，
// 以及 7/30/90 天窗口切换，便于 Yuen、Xiang Hong 核对统计口径。
const environment = require('../../../config/environment.local');
const { REVIEW_WINDOWS } = require('../../../shared/constants');
const { reviewStore, createLocalStore } = require('../../../modules/review/demo-store');
const {
  reviewDemoService,
  createReviewDemoService,
} = require('../../../modules/review/demo-service');
const { INSIGHT_FIXTURES, INSIGHT_FIXTURE_NOW } = require('../../../modules/review/demo-data');

const SAMPLES = [
  { id: 'live', label: '当前演示数据' },
  ...Object.entries(INSIGHT_FIXTURES).map(([id, fixture]) => ({
    id,
    label: fixture.label,
  })),
];

function fixtureService(sampleId) {
  const fixture = INSIGHT_FIXTURES[sampleId];
  const store = createLocalStore(
    fixture.entries.map((entry) => JSON.parse(JSON.stringify(entry))),
    7,
  );
  const fixedNow = () => new Date(INSIGHT_FIXTURE_NOW);
  return createReviewDemoService({ now: fixedNow, store });
}

Page({
  data: {
    isDemo: false,
    samples: SAMPLES,
    sampleId: 'live',
    windows: REVIEW_WINDOWS.map((days) => ({ days, label: days + ' 天' })),
    windowDays: 7,
    metaText: '',
    blankText: '',
    distRows: [],
    distributionEmpty: false,
    timelineItems: [],
    trendText: '',
    loading: false,
    error: '',
  },
  onLoad() {
    this._seq = 0;
    this._disposed = false;
    const isDemo = environment.journalDemo === true && environment.cloudEnabled === false;
    this.setData({ isDemo });
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
    this._disposed = true;
    this._seq += 1;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  },
  onSampleTap(event) {
    const id = event.currentTarget.dataset.id;
    if (SAMPLES.some((sample) => sample.id === id) && id !== this.data.sampleId) {
      this.setData({ sampleId: id });
      this._reload();
    }
  },
  onWindowTap(event) {
    const days = Number(event.currentTarget.dataset.days);
    if (REVIEW_WINDOWS.includes(days) && days !== this.data.windowDays) {
      this.setData({ windowDays: days });
      this._reload();
    }
  },
  _service() {
    // 固定样例使用独立数据源与固定时钟；live 使用页面共享演示服务（真实业务日）。
    return this.data.sampleId === 'live' ? reviewDemoService : fixtureService(this.data.sampleId);
  },
  async _reload() {
    if (!this.data.isDemo || this._disposed) {
      return;
    }
    const token = ++this._seq;
    const service = this._service();
    const windowDays = this.data.windowDays;
    this.setData({ loading: true, error: '' });
    try {
      const [distribution, timeline] = await Promise.all([
        service.distribution(windowDays),
        service.timeline(windowDays),
      ]);
      if (token !== this._seq) {
        return;
      }
      const dist = distribution.data;
      const line = timeline.data;
      this.setData({
        loading: false,
        metaText:
          dist.startDate +
          ' 至 ' +
          dist.endDate +
          ' · 窗口 ' +
          dist.windowDays +
          ' 天 · 实际记录 ' +
          dist.recordCount +
          ' 条',
        blankText:
          dist.recordCount < dist.windowDays
            ? '窗口内其余 ' + (dist.windowDays - dist.recordCount) + ' 天保持留白，不补任何天气。'
            : '窗口内每一天都有记录。',
        distRows: dist.bins.map((bin) => {
          const view = service.weatherView(bin.weather);
          return {
            key: bin.weather,
            icon: view.icon,
            label: view.label,
            count: bin.count,
            percent: dist.recordCount > 0 ? Math.round((bin.count * 100) / dist.recordCount) : 0,
            ratioText: dist.recordCount > 0 ? bin.count + '/' + dist.recordCount + ' 条' : '—',
          };
        }),
        distributionEmpty: dist.recordCount === 0,
        timelineItems: line.items.map((item) => {
          const view = service.weatherView(item.weather);
          return { key: item.id, date: item.date, icon: view.icon, label: view.label };
        }),
        trendText: line.trendEligible
          ? '已达到趋势展示的记录数量门槛（至少 3 条）；按第一周约定，本页不输出上升或下降结论。'
          : '实际记录不足 3 条，按第一周约定不输出趋势结论。',
      });
    } catch (error) {
      if (token !== this._seq) {
        return;
      }
      this.setData({
        loading: false,
        error: error && error.message ? error.message : '统计读取失败。',
      });
    }
  },
});
