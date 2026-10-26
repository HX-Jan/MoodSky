const reviewService = require('./service');
const journalService = require('../journal/service');
const { readEntry } = require('../journal/controller');
const { WEATHER_TYPES, REVIEW_WINDOWS, LIMITS } = require('../../shared/constants');
const { isBusinessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const { weatherView } = require('./presentation');
const { validateWeather } = require('../../shared/weather');
const { readInReviewSession } = require('./session-boundary');
const DAY_MS = 86400000;
const invalid = () => {
  throw new AppError('INVALID_RESPONSE', '回顾结果不完整，请重新读取。');
};
const monthValid = (month) =>
  typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && isBusinessDate(month + '-01');
const idValid = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
function marks(rows, count, range, descending) {
  if (!Array.isArray(rows) || rows.length !== count) {
    return invalid();
  }
  const ids = new Set();
  let previous = '';
  return rows.map((row) => {
    if (
      !row ||
      !idValid(row.id) ||
      !isBusinessDate(row.date) ||
      row.date < range.startDate ||
      row.date > range.endDate ||
      !WEATHER_TYPES.some(({ code }) => code === row.weather) ||
      ids.has(row.id) ||
      (previous && (descending ? row.date >= previous : row.date <= previous))
    ) {
      return invalid();
    }
    ids.add(row.id);
    previous = row.date;
    let weather;
    try {
      weather = validateWeather(row);
    } catch (_error) {
      return invalid();
    }
    return { id: row.id, date: row.date, ...weather };
  });
}
function validateReviewData(action, input, data) {
  if (
    !data ||
    !Number.isSafeInteger(data.sourceRevision) ||
    data.sourceRevision < 0 ||
    !Number.isSafeInteger(data.recordCount) ||
    data.recordCount < 0
  ) {
    return invalid();
  }
  const meta = { sourceRevision: data.sourceRevision, recordCount: data.recordCount };
  if (['calendar', 'monthArchive'].includes(action)) {
    if (!monthValid(input) || data.month !== input) {
      return invalid();
    }
    const first = new Date(input + '-01T00:00:00.000Z');
    first.setUTCMonth(first.getUTCMonth() + 1);
    first.setUTCDate(0);
    const range = { startDate: input + '-01', endDate: first.toISOString().slice(0, 10) };
    if (data.recordCount > first.getUTCDate()) {
      return invalid();
    }
    if (action === 'calendar') {
      return {
        month: input,
        ...meta,
        entries: marks(data.entries, data.recordCount, range, false),
      };
    }
    if (data.cardTextPreview !== false) {
      return invalid();
    }
    return {
      month: input,
      ...meta,
      cards: marks(data.cards, data.recordCount, range, true),
      cardTextPreview: false,
    };
  }
  if (
    !REVIEW_WINDOWS.includes(input) ||
    data.windowDays !== input ||
    data.recordCount > input ||
    !isBusinessDate(data.startDate) ||
    !isBusinessDate(data.endDate) ||
    (Date.parse(data.endDate) - Date.parse(data.startDate)) / DAY_MS !== input - 1
  ) {
    return invalid();
  }
  const range = { startDate: data.startDate, endDate: data.endDate, windowDays: input };
  if (action === 'timeline') {
    if (data.trendEligible !== data.recordCount >= LIMITS.minimumTrendEntries) {
      return invalid();
    }
    return {
      ...range,
      ...meta,
      items: marks(data.items, data.recordCount, range, true),
      trendEligible: data.trendEligible,
    };
  }
  if (
    action !== 'distribution' ||
    !Array.isArray(data.bins) ||
    data.bins.length !== WEATHER_TYPES.length
  ) {
    return invalid();
  }
  const bins = WEATHER_TYPES.map(({ code }) => {
    const matches = data.bins.filter((bin) => bin && bin.weather === code);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].count) || matches[0].count < 0) {
      return invalid();
    }
    return { weather: code, count: matches[0].count };
  });
  if (bins.reduce((sum, bin) => sum + bin.count, 0) !== data.recordCount) {
    return invalid();
  }
  return { ...range, ...meta, bins };
}
function createReviewReader({
  review = reviewService,
  journal = journalService,
  sessionState,
} = {}) {
  const read = (action) => (input) =>
    readInReviewSession(async () => {
      const result = await review[action](input);
      if (!result || result.ok !== true) {
        return invalid();
      }
      return { ...result, data: validateReviewData(action, input, result.data) };
    }, sessionState);
  const reader = {
    calendar: read('calendar'),
    monthArchive: read('monthArchive'),
    distribution: read('distribution'),
    timeline: read('timeline'),
    weatherView,
    async getEntry(date) {
      return readInReviewSession(async () => {
        const result = await journal.get(date);
        return { ...result, data: { entry: readEntry(result, date) } };
      }, sessionState);
    },
    async insights(windowDays) {
      // The complete validated timeline already contains every weather mark in this window.
      // Derive both views from it, avoiding a second cloud snapshot and cross-read races.
      const timeline = await reader.timeline(windowDays);
      const line = timeline.data;
      const distribution = {
        ...timeline,
        data: {
          windowDays: line.windowDays,
          startDate: line.startDate,
          endDate: line.endDate,
          sourceRevision: line.sourceRevision,
          recordCount: line.recordCount,
          bins: WEATHER_TYPES.map(({ code }) => ({
            weather: code,
            count: line.items.filter((item) => item.weather === code).length,
          })),
        },
      };
      return { distribution, timeline };
    },
  };
  return reader;
}
const MESSAGES = {
  UNAUTHENTICATED: '登录状态需要重新确认，请重新进入。',
  ACCOUNT_DISABLED: '账号已停用，当前不展示私人记录。',
  NOT_IMPLEMENTED: '回顾服务尚未开放，请稍后再试。',
  CLOUD_NOT_CONFIGURED: '回顾服务尚未连接，请稍后再试。',
  NETWORK_ERROR: '连接失败，请重新读取。',
  INVALID_RESPONSE: '回顾结果不完整，请重新读取。',
  CONFLICT: '记录在读取期间发生变化，请重新读取统计。',
  INVALID_INPUT: '回顾参数无效，请返回选择有效日期或月份。',
};
const reviewErrorMessage = (error) =>
  (error && Object.prototype.hasOwnProperty.call(MESSAGES, error.code) && MESSAGES[error.code]) ||
  '暂时无法读取，请稍后再试。';
module.exports = {
  createReviewReader,
  reviewReader: createReviewReader(),
  validateReviewData,
  reviewErrorMessage,
};
