const { AppError } = require('../shared/result');
const { WEATHER_TYPES, LIMITS } = require('../shared/constants');
const { businessDate, isBusinessDate } = require('../shared/date');
const { requireActor } = require('./journal');
const DAY_MS = 86400000;

function bounds(action, payload, now) {
  const monthly = ['review.calendar', 'review.monthArchive'].includes(action);
  const allowed = monthly ? 'month' : 'windowDays';
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => key !== allowed)
  ) {
    throw new AppError('INVALID_INPUT', '回顾输入包含未约定字段。');
  }
  if (monthly) {
    const month = payload.month;
    if (
      typeof month !== 'string' ||
      !/^\d{4}-\d{2}$/.test(month) ||
      !isBusinessDate(month + '-01')
    ) {
      throw new AppError('INVALID_INPUT', '月份必须为真实的YYYY-MM。');
    }
    const lastDay = new Date(month + '-01T00:00:00.000Z');
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
    lastDay.setUTCDate(0);
    return { month, startDate: month + '-01', endDate: lastDay.toISOString().slice(0, 10) };
  }
  if (![7, 30, 90].includes(payload.windowDays)) {
    throw new AppError('INVALID_INPUT', '统计窗口仅支持7、30、90天。');
  }
  const endDate = businessDate(now());
  const startDate = new Date(
    Date.parse(endDate + 'T00:00:00.000Z') - (payload.windowDays - 1) * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  return { windowDays: payload.windowDays, startDate, endDate };
}

function snapshotMarks(snapshot, range) {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Array.isArray(snapshot.entries)
  ) {
    throw new Error('Invalid journal snapshot');
  }
  const dates = new Set();
  const ids = new Set();
  return snapshot.entries
    .map((entry) => {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id) ||
        !isBusinessDate(entry.date) ||
        entry.date < range.startDate ||
        entry.date > range.endDate ||
        !WEATHER_TYPES.some((weather) => weather.code === entry.weather) ||
        dates.has(entry.date) ||
        ids.has(entry.id)
      ) {
        throw new Error('Invalid journal snapshot');
      }
      dates.add(entry.date);
      ids.add(entry.id);
      // Explicit whitelist even if a future adapter accidentally returns full documents.
      return { id: entry.id, date: entry.date, weather: entry.weather };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function createReviewService({ repository, now = () => new Date() }) {
  return async ({ action, payload, actor }) => {
    const ownerId = requireActor(actor);
    if (
      ![
        'review.calendar',
        'review.distribution',
        'review.timeline',
        'review.monthArchive',
      ].includes(action)
    ) {
      throw new AppError('NOT_IMPLEMENTED', '此回顾操作尚未实现。');
    }
    const range = bounds(action, payload, now);
    // Entries and revision must come from ONE consistent, owner-filtered snapshot.
    const snapshot = await repository.readSnapshot(ownerId, {
      startDate: range.startDate,
      endDate: range.endDate,
    });
    const entries = snapshotMarks(snapshot, range);
    const meta = { recordCount: entries.length, sourceRevision: snapshot.revision };
    if (action === 'review.calendar') {
      return { month: range.month, entries, ...meta };
    }
    if (action === 'review.monthArchive') {
      return { month: range.month, cards: entries.reverse(), ...meta, cardTextPreview: false };
    }
    if (action === 'review.timeline') {
      return {
        ...range,
        ...meta,
        items: entries.reverse(),
        trendEligible: entries.length >= LIMITS.minimumTrendEntries,
      };
    }
    const bins = WEATHER_TYPES.map(({ code }) => ({
      weather: code,
      count: entries.filter((entry) => entry.weather === code).length,
    }));
    return { ...range, ...meta, bins };
  };
}
module.exports = { createReviewService };
