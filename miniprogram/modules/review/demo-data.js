// 合成演示数据（Zhifeng Dai，W1 Z02—Z05）。全部内容为演示夹具，不来自真实账号或云端，
// 仅在 journalDemo 显式开启且云服务关闭时使用。真实数据仍走 modules/review/service.js。
const { ICONS, weatherLabel } = require('./presentation');

// 演示种子记录：跨月样例（2026-09 末—2026-10 初）、真实的阴天记录（用于区分“阴天”与“空白日期”）、
// 以及 2026-10-16 当天记录，便于在 Today 页演示编辑后触发回顾刷新。2026-08 不放任何记录，作为全空月份样例。
const SEED_ENTRIES = Object.freeze([
  Object.freeze({
    id: 'demo_20260927',
    date: '2026-09-27',
    weather: 'SUNNY',
    tags: Object.freeze(['REST']),
    text: '合成演示：周日睡到自然醒，把秋天的被子晒了。',
    version: 1,
    createdAt: '2026-09-27T12:30:00.000Z',
    updatedAt: '2026-09-27T12:30:00.000Z',
  }),
  Object.freeze({
    id: 'demo_20260930',
    date: '2026-09-30',
    weather: 'RAINY',
    tags: Object.freeze(['STUDY', 'TIREDNESS']),
    text: '合成演示：月末赶报告，外面下了一整天雨。',
    version: 2,
    createdAt: '2026-09-30T09:10:00.000Z',
    updatedAt: '2026-09-30T21:05:00.000Z',
  }),
  Object.freeze({
    id: 'demo_20261001',
    date: '2026-10-01',
    weather: 'PARTLY_CLOUDY',
    tags: Object.freeze(['SOCIAL']),
    text: '合成演示：和家人吃了团圆饭，傍晚云散了一点。',
    version: 1,
    createdAt: '2026-10-01T13:40:00.000Z',
    updatedAt: '2026-10-01T13:40:00.000Z',
  }),
  Object.freeze({
    id: 'demo_20261009',
    date: '2026-10-09',
    weather: 'SUNNY',
    tags: Object.freeze(['EXERCISE']),
    text: '合成演示：傍晚跑了三公里，天很晴。',
    version: 3,
    createdAt: '2026-10-09T11:00:00.000Z',
    updatedAt: '2026-10-09T20:15:00.000Z',
  }),
  Object.freeze({
    id: 'demo_20261012',
    date: '2026-10-12',
    weather: 'CLOUDY',
    tags: Object.freeze(['CALM']),
    text: '合成演示：这是一条真实的阴天记录，用来区分“阴天”与空白日期。',
    version: 1,
    createdAt: '2026-10-12T10:20:00.000Z',
    updatedAt: '2026-10-12T10:20:00.000Z',
  }),
  Object.freeze({
    id: 'demo_20261015',
    date: '2026-10-15',
    weather: 'STORMY',
    tags: Object.freeze(['TIREDNESS']),
    text: '合成演示：暴雨延迟了归途，到家后写下这一天。',
    version: 1,
    createdAt: '2026-10-15T14:50:00.000Z',
    updatedAt: '2026-10-15T14:50:00.000Z',
  }),
  Object.freeze({
    id: 'demo_20261016',
    date: '2026-10-16',
    weather: 'RAINY',
    tags: Object.freeze(['CALM', 'REST']),
    text: '合成演示：今天的雨声很合适记录心情，可在 Today 页编辑本条后回 Universe 查看刷新。',
    version: 1,
    createdAt: '2026-10-16T02:00:00.000Z',
    updatedAt: '2026-10-16T02:00:00.000Z',
  }),
]);

// 全空月份样例：月历、月份档案与卡片列表都展示留白与空态，不渲染任何天气标识。
const EMPTY_DEMO_MONTH = '2026-08';

// 分布与时间线固定夹具时钟：与 docs/week1/xiang-hong/w1-h04.md 的合成样例保持同一业务日。
const INSIGHT_FIXTURE_NOW = '2026-10-15T04:00:00.000Z';

// 统计口径样例数据集：0 条、2 条（含跨月记录）、3 条记录。
const INSIGHT_FIXTURES = Object.freeze({
  empty: Object.freeze({ label: '样例 A · 0 条记录', entries: Object.freeze([]) }),
  two: Object.freeze({
    label: '样例 B · 2 条记录（跨月）',
    entries: Object.freeze([
      Object.freeze({
        id: 'fixture_20260920',
        date: '2026-09-20',
        weather: 'SUNNY',
        tags: Object.freeze([]),
        text: '合成演示：九月的一次散步。',
        version: 1,
        createdAt: '2026-09-20T08:00:00.000Z',
        updatedAt: '2026-09-20T08:00:00.000Z',
      }),
      Object.freeze({
        id: 'fixture_20261012',
        date: '2026-10-12',
        weather: 'RAINY',
        tags: Object.freeze([]),
        text: '合成演示：十月的一场雨。',
        version: 1,
        createdAt: '2026-10-12T08:00:00.000Z',
        updatedAt: '2026-10-12T08:00:00.000Z',
      }),
    ]),
  }),
  three: Object.freeze({
    label: '样例 C · 3 条记录',
    entries: Object.freeze([
      Object.freeze({
        id: 'fixture_20261009',
        date: '2026-10-09',
        weather: 'SUNNY',
        tags: Object.freeze([]),
        text: '合成演示：晴天记录一。',
        version: 1,
        createdAt: '2026-10-09T08:00:00.000Z',
        updatedAt: '2026-10-09T08:00:00.000Z',
      }),
      Object.freeze({
        id: 'fixture_20261012',
        date: '2026-10-12',
        weather: 'RAINY',
        tags: Object.freeze([]),
        text: '合成演示：雨天记录二。',
        version: 1,
        createdAt: '2026-10-12T08:00:00.000Z',
        updatedAt: '2026-10-12T08:00:00.000Z',
      }),
      Object.freeze({
        id: 'fixture_20261015',
        date: '2026-10-15',
        weather: 'PARTLY_CLOUDY',
        tags: Object.freeze([]),
        text: '合成演示：晴间多云记录三。',
        version: 1,
        createdAt: '2026-10-15T08:00:00.000Z',
        updatedAt: '2026-10-15T08:00:00.000Z',
      }),
    ]),
  }),
});

// 合成素材目录：第一周没有正式贴纸与背景资产（完整制作安排在后续周，见 w1-z05.md），
// 此处仅登记 6 种贴纸与 2 种背景的合成 ID，与共享常量 LIMITS.staticStickers/staticBackgrounds 对齐。
const STICKER_CATALOG = Object.freeze([
  'STICKER_STAR',
  'STICKER_MOON',
  'STICKER_LEAF',
  'STICKER_UMBRELLA',
  'STICKER_CAT',
  'STICKER_BALLOON',
]);
const BACKGROUND_CATALOG = Object.freeze(['BACKGROUND_SKY_DAY', 'BACKGROUND_SKY_NIGHT']);

module.exports = {
  ICONS,
  weatherLabel,
  SEED_ENTRIES,
  EMPTY_DEMO_MONTH,
  INSIGHT_FIXTURE_NOW,
  INSIGHT_FIXTURES,
  STICKER_CATALOG,
  BACKGROUND_CATALOG,
};
