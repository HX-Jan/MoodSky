// 回顾演示服务（W1 Z02—Z05）。按 docs/week1/xiang-hong/w1-h04.md 的接口约定返回合成视图：
// calendar/distribution/timeline/monthArchive 严格复用同一来源，卡片与统计不携带正文，
// 统计分母为实际记录数，缺失日期留白，不足 3 条不输出趋势结论。
// 未开启本地演示时页面应使用 modules/review/service.js 走真实云函数（当前返回 NOT_IMPLEMENTED）。
const api = require('../../services/api');
const { AppError } = require('../../shared/result');
const { API_VERSION, LIMITS, WEATHER_TYPES } = require('../../shared/constants');
const { businessDate, isBusinessDate } = require('../../shared/date');
const { reviewStore } = require('./demo-store');
const { ICONS, weatherLabel, STICKER_CATALOG, BACKGROUND_CATALOG } = require('./demo-data');

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const REVIEW_WINDOW_DAYS = [7, 30, 90];
const DAY_MS = 24 * 60 * 60 * 1000;

const toMark = (entry) => ({ id: entry.id, date: entry.date, weather: entry.weather });

function requireMonth(month) {
  if (typeof month !== 'string' || !MONTH_PATTERN.test(month) || !isBusinessDate(month + '-01')) {
    throw new AppError('INVALID_INPUT', '月份必须为真实的YYYY-MM。');
  }
  return month;
}

function requireWindow(windowDays) {
  if (!REVIEW_WINDOW_DAYS.includes(windowDays)) {
    throw new AppError('INVALID_INPUT', '统计窗口仅支持7、30、90天。');
  }
  return windowDays;
}

function shiftDate(date, days) {
  return new Date(Date.parse(date + 'T00:00:00.000Z') + days * DAY_MS).toISOString().slice(0, 10);
}

function createReviewDemoService({ now = () => new Date(), store = reviewStore } = {}) {
  const decorations = new Map(); // month -> { version, stickers, backgroundId }
  let decorationsEnabled = true; // 装饰开关属于偏好：关闭不清空配置、不改日记。

  const envelope = (request, data) => ({
    apiVersion: API_VERSION,
    requestId: request.requestId,
    ok: true,
    data,
  });

  function validDecorations(doc, month) {
    if (!doc || !Array.isArray(doc.stickers)) {
      return [];
    }
    // 关联旧 entryId 的装饰立即过滤；独立月份装饰不受单日删除影响。
    const monthIds = new Set(store.listMonth(month).map((entry) => entry.id));
    return doc.stickers.filter(
      (sticker) => !sticker.targetEntryId || monthIds.has(sticker.targetEntryId),
    );
  }

  function decorationView(month) {
    requireMonth(month);
    const doc = decorations.get(month);
    const stickers = validDecorations(doc, month);
    return {
      month,
      version: doc ? doc.version : 0,
      stickers: stickers.map((sticker) => ({ ...sticker })),
      backgroundId: doc ? doc.backgroundId : null,
    };
  }

  function currentVersion(month) {
    const doc = decorations.get(month);
    return doc ? doc.version : 0;
  }

  function replaceDecorations(input) {
    const month = requireMonth(input.month);
    const allowed = ['operation', 'month', 'expectedVersion', 'stickers', 'backgroundId'];
    if (Object.keys(input).some((key) => !allowed.includes(key))) {
      throw new AppError('INVALID_INPUT', '装饰替换包含未约定字段。');
    }
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new AppError('INVALID_INPUT', '装饰替换必须提供当前版本。');
    }
    const stickers = input.stickers;
    if (
      !Array.isArray(stickers) ||
      stickers.length > LIMITS.staticStickers ||
      stickers.some(
        (sticker) =>
          !sticker ||
          typeof sticker !== 'object' ||
          Object.keys(sticker).some((key) => !['stickerId', 'targetEntryId'].includes(key)) ||
          !STICKER_CATALOG.includes(sticker.stickerId) ||
          (sticker.targetEntryId !== undefined && typeof sticker.targetEntryId !== 'string'),
      )
    ) {
      throw new AppError('INVALID_INPUT', '贴纸必须来自经核验的素材目录。');
    }
    const seen = new Set();
    for (const sticker of stickers) {
      const key = sticker.stickerId + '|' + (sticker.targetEntryId || '');
      if (seen.has(key)) {
        throw new AppError('INVALID_INPUT', '同一贴纸与目标的组合不能重复。');
      }
      seen.add(key);
    }
    const monthIds = new Set(store.listMonth(month).map((entry) => entry.id));
    if (stickers.some((sticker) => sticker.targetEntryId && !monthIds.has(sticker.targetEntryId))) {
      throw new AppError('INVALID_INPUT', '贴纸目标必须为本人当月有效记录。');
    }
    if (input.backgroundId !== null && !BACKGROUND_CATALOG.includes(input.backgroundId)) {
      throw new AppError('INVALID_INPUT', '背景必须来自经核验的素材目录。');
    }
    if (currentVersion(month) !== input.expectedVersion) {
      throw new AppError('CONFLICT', '装饰配置已更新，请刷新后重试。');
    }
    const doc = {
      month,
      version: input.expectedVersion + 1,
      stickers: stickers.map((sticker) => ({ ...sticker })),
      backgroundId: input.backgroundId,
    };
    decorations.set(month, doc);
    return decorationView(month);
  }

  function resetDecorations(input) {
    const month = requireMonth(input.month);
    const allowed = ['month', 'expectedVersion', 'operation'];
    if (Object.keys(input).some((key) => !allowed.includes(key))) {
      throw new AppError('INVALID_INPUT', '装饰重置包含未约定字段。');
    }
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new AppError('INVALID_INPUT', '装饰重置必须提供当前版本。');
    }
    if (currentVersion(month) !== input.expectedVersion) {
      throw new AppError('CONFLICT', '装饰配置已更新，请刷新后重试。');
    }
    const doc = decorations.get(month);
    if (!doc) {
      // 无配置的月重置不创建文档、不推进版本。
      return { month, version: 0, stickers: [], backgroundId: null };
    }
    doc.version += 1;
    doc.stickers = [];
    doc.backgroundId = null;
    return decorationView(month);
  }

  return {
    weatherView: (code) => ({ icon: ICONS[code] || '', label: weatherLabel(code) }),
    getDecorationsPreference: () => decorationsEnabled,
    setDecorationsPreference(enabled) {
      decorationsEnabled = enabled === true;
      return decorationsEnabled;
    },
    async calendar(monthInput) {
      const month = requireMonth(monthInput);
      const request = api.createRequest('review.calendar', { month });
      const entries = store.listMonth(month).map(toMark);
      return envelope(request, {
        month,
        entries,
        recordCount: entries.length,
        sourceRevision: store.revision(),
      });
    },
    async monthArchive(monthInput) {
      const month = requireMonth(monthInput);
      const request = api.createRequest('review.monthArchive', { month });
      const cards = store
        .listMonth(month)
        .map(toMark)
        .sort((a, b) => (a.date > b.date ? -1 : 1));
      // 默认响应不返回正文或 textPreview：正文只允许出现在本人详情页。
      return envelope(request, {
        month,
        cards,
        recordCount: cards.length,
        sourceRevision: store.revision(),
        cardTextPreview: false,
      });
    },
    async distribution(windowDaysInput) {
      const windowDays = requireWindow(windowDaysInput);
      const request = api.createRequest('review.distribution', { windowDays });
      const endDate = businessDate(now());
      const startDate = shiftDate(endDate, -(windowDays - 1));
      const items = store
        .listAll()
        .filter((entry) => entry.date >= startDate && entry.date <= endDate);
      // 五类天气顺序复用共享常量，计数为 0 也保留；空窗口显示中性空态，不计算 0/0。
      const bins = WEATHER_TYPES.map((item) => ({ weather: item.code, count: 0 }));
      for (const entry of items) {
        const bin = bins.find((item) => item.weather === entry.weather);
        if (bin) {
          bin.count += 1;
        }
      }
      return envelope(request, {
        startDate,
        endDate,
        windowDays,
        recordCount: items.length,
        sourceRevision: store.revision(),
        bins,
      });
    },
    async timeline(windowDaysInput) {
      const windowDays = requireWindow(windowDaysInput);
      const request = api.createRequest('review.timeline', { windowDays });
      const endDate = businessDate(now());
      const startDate = shiftDate(endDate, -(windowDays - 1));
      const items = store
        .listAll()
        .filter((entry) => entry.date >= startDate && entry.date <= endDate)
        .map(toMark)
        .sort((a, b) => (a.date > b.date ? -1 : 1));
      return envelope(request, {
        startDate,
        endDate,
        windowDays,
        recordCount: items.length,
        sourceRevision: store.revision(),
        items,
        trendEligible: items.length >= LIMITS.minimumTrendEntries,
      });
    },
    // 本人详情的演示替身（真实架构走 journal.get）；调用方仍需核对 entryId 防止打开旧卡。
    async getEntry(dateInput) {
      if (!isBusinessDate(dateInput)) {
        throw new AppError('INVALID_INPUT', '日期必须为真实的YYYY-MM-DD。');
      }
      const request = api.createRequest('journal.get', { date: dateInput });
      return envelope(request, { entry: store.getEntry(dateInput) });
    },
    async decorations(input) {
      if (!input || typeof input !== 'object' || typeof input.month !== 'string') {
        throw new AppError('INVALID_INPUT', '装饰输入必须包含月份。');
      }
      if (input.operation === 'get') {
        if (Object.keys(input).some((key) => !['operation', 'month'].includes(key))) {
          throw new AppError('INVALID_INPUT', '装饰读取包含未约定字段。');
        }
        const request = api.createRequest('review.decorations', { operation: 'get' });
        return envelope(request, decorationView(input.month));
      }
      if (input.operation === 'replace') {
        const view = replaceDecorations(input);
        const request = api.createRequest('review.decorations', { operation: 'replace' });
        return envelope(request, view);
      }
      if (input.operation === 'reset') {
        const view = resetDecorations(input);
        const request = api.createRequest('review.decorations', { operation: 'reset' });
        return envelope(request, view);
      }
      throw new AppError('INVALID_INPUT', '装饰操作仅支持 get、replace、reset。');
    },
  };
}

// 页面共用的演示服务单例：装饰偏好与装饰配置在页面间保持一致。
const reviewDemoService = createReviewDemoService();

module.exports = { createReviewDemoService, reviewDemoService };
