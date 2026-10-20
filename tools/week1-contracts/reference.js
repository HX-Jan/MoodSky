// H02/H04 review candidate. Offline synthetic examples only; no cloud entry
// imports this file and no platform identity or database adapter is provided.
const {
  validateRequest,
  validateJournalInput,
  isObject,
} = require('../../miniprogram/shared/validation');
const { isBusinessDate } = require('../../miniprogram/shared/date');
const { WEATHER_TYPES, REVIEW_WINDOWS, LIMITS } = require('../../miniprogram/shared/constants');
const { AppError } = require('../../miniprogram/shared/result');
const fail = () => {
  throw new AppError('INVALID_INPUT', '候选样例输入不符合约定。');
};
const keys = (value, allowed) =>
  isObject(value) && Object.keys(value).every((key) => allowed.includes(key));
const monthValid = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isBusinessDate(value + '-01');
const versionValid = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const assetIdValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function validateCandidateRequest(request) {
  validateRequest(request);
  const { action, payload } = request;
  if (action === 'journal.upsert') {
    const input = validateJournalInput(payload);
    if (!versionValid(input.expectedVersion)) {
      fail();
    }
    return input;
  }
  if (['journal.get', 'journal.delete'].includes(action)) {
    const deleting = action === 'journal.delete';
    if (
      !keys(payload, deleting ? ['date', 'expectedVersion'] : ['date']) ||
      !isBusinessDate(payload.date) ||
      (deleting && !versionValid(payload.expectedVersion, 1))
    ) {
      fail();
    }
    return { ...payload };
  }
  if (['review.calendar', 'review.monthArchive'].includes(action)) {
    if (!keys(payload, ['month']) || !monthValid(payload.month)) {
      fail();
    }
    return { ...payload };
  }
  if (['review.distribution', 'review.timeline'].includes(action)) {
    if (!keys(payload, ['windowDays']) || !REVIEW_WINDOWS.includes(payload.windowDays)) {
      fail();
    }
    return { ...payload };
  }
  if (action !== 'review.decorations' || !monthValid(payload.month)) {
    fail();
  }
  const fields = {
    get: ['operation', 'month'],
    reset: ['operation', 'month', 'expectedVersion'],
    replace: ['operation', 'month', 'expectedVersion', 'stickers', 'backgroundId'],
  };
  if (
    !Object.prototype.hasOwnProperty.call(fields, payload.operation) ||
    !keys(payload, fields[payload.operation])
  ) {
    fail();
  }
  if (payload.operation !== 'get' && !versionValid(payload.expectedVersion)) {
    fail();
  }
  if (payload.operation === 'replace') {
    if (
      !Array.isArray(payload.stickers) ||
      payload.stickers.length > LIMITS.staticStickers ||
      !(payload.backgroundId === null || assetIdValid(payload.backgroundId))
    ) {
      fail();
    }
    const identities = new Set();
    for (const item of payload.stickers) {
      if (
        !keys(item, ['stickerId', 'targetEntryId']) ||
        !assetIdValid(item.stickerId) ||
        (Object.prototype.hasOwnProperty.call(item, 'targetEntryId') &&
          !assetIdValid(item.targetEntryId))
      ) {
        fail();
      }
      const id = JSON.stringify([item.stickerId, item.targetEntryId || null]);
      if (identities.has(id)) {
        fail();
      }
      identities.add(id);
    }
  }
  // This is shape validation, not authorization, catalogue membership or a write.
  return JSON.parse(JSON.stringify(payload));
}

function buildReviewPreview(request, fixture) {
  const input = validateCandidateRequest(request);
  if (
    !fixture ||
    fixture.synthetic !== true ||
    typeof fixture.actorId !== 'string' ||
    !fixture.actorId.startsWith('synthetic_') ||
    !isBusinessDate(fixture.today) ||
    !versionValid(fixture.sourceRevision) ||
    !Array.isArray(fixture.records)
  ) {
    throw new TypeError('An explicit synthetic fixture and fixed business day are required.');
  }
  if (!request.action.startsWith('review.')) {
    fail();
  }
  if (request.action === 'review.decorations') {
    if (input.operation !== 'get') {
      throw new AppError('NOT_IMPLEMENTED', '候选包不执行装饰写入。');
    }
    // Only the documented absent-configuration read is modelled here.
    return { month: input.month, version: 0, stickers: [], backgroundId: null };
  }
  let records = fixture.records.filter(
    (row) => row.ownerId === fixture.actorId && row.state === 'active',
  );
  const dates = new Set();
  const ids = new Set();
  for (const row of records) {
    if (
      !isBusinessDate(row.date) ||
      typeof row.id !== 'string' ||
      !row.id.startsWith('synthetic_') ||
      !WEATHER_TYPES.some((type) => type.code === row.weather) ||
      dates.has(row.date) ||
      ids.has(row.id)
    ) {
      throw new TypeError('Synthetic source has invalid or duplicate active records.');
    }
    dates.add(row.date);
    ids.add(row.id);
  }
  records = records.filter((row) => row.date <= fixture.today);
  let meta = { sourceRevision: fixture.sourceRevision };
  if (input.month) {
    records = records.filter((row) => row.date.slice(0, 7) === input.month);
    meta.month = input.month;
  } else {
    const startDate = new Date(
      Date.parse(fixture.today + 'T00:00:00.000Z') - (input.windowDays - 1) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    records = records.filter((row) => row.date >= startDate);
    meta = { ...meta, startDate, endDate: fixture.today, windowDays: input.windowDays };
  }
  meta.recordCount = records.length;
  const marks = records
    .map(({ id, date, weather }) => ({ id, date, weather }))
    .sort((a, b) => a.date.localeCompare(b.date));
  switch (request.action) {
    case 'review.calendar':
      return { ...meta, entries: marks };
    case 'review.monthArchive':
      return { ...meta, cards: marks.reverse(), cardTextPreview: false };
    case 'review.distribution':
      return {
        ...meta,
        bins: WEATHER_TYPES.map(({ code }) => ({
          weather: code,
          count: records.filter((row) => row.weather === code).length,
        })),
      };
    case 'review.timeline':
      return {
        ...meta,
        items: marks.reverse(),
        trendEligible: records.length >= LIMITS.minimumTrendEntries,
      };
    default:
      return fail();
  }
}
module.exports = { validateCandidateRequest, buildReviewPreview };
