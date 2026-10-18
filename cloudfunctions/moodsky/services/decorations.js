const { AppError } = require('../shared/result');
const { LIMITS } = require('../shared/constants');
const { isBusinessDate } = require('../shared/date');
const { REQUEST_ID_PATTERN } = require('../shared/validation');
const { requireActor } = require('./journal');
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code = 'INVALID_INPUT') => {
  throw new AppError(
    code,
    code === 'CONFLICT' ? '装饰状态已变化，请刷新后重试。' : '装饰输入无效。',
  );
};
function catalogueIds(items, max) {
  if (
    !Array.isArray(items) ||
    items.length > max ||
    items.some((id) => !validId(id)) ||
    new Set(items).size !== items.length
  ) {
    throw new TypeError('Decoration catalogue must contain distinct approved asset IDs.');
  }
  return new Set(items);
}
function validateInput(payload, catalogue) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail();
  }
  const { operation, month } = payload;
  const allowed = {
    get: ['operation', 'month'],
    reset: ['operation', 'month', 'expectedVersion'],
    replace: ['operation', 'month', 'expectedVersion', 'stickers', 'backgroundId'],
  };
  if (
    !Object.prototype.hasOwnProperty.call(allowed, operation) ||
    Object.keys(payload).some((key) => !allowed[operation].includes(key)) ||
    typeof month !== 'string' ||
    !/^\d{4}-\d{2}$/.test(month) ||
    !isBusinessDate(month + '-01')
  ) {
    return fail();
  }
  const input = { operation, month };
  if (operation !== 'get') {
    if (!validVersion(payload.expectedVersion)) {
      return fail();
    }
    input.expectedVersion = payload.expectedVersion;
  }
  if (operation !== 'replace') {
    return input;
  }
  if (
    !Array.isArray(payload.stickers) ||
    payload.stickers.length > LIMITS.staticStickers ||
    (payload.backgroundId !== null && !catalogue.backgrounds.has(payload.backgroundId))
  ) {
    return fail();
  }
  const seen = new Set();
  input.stickers = payload.stickers.map((sticker) => {
    if (
      !sticker ||
      typeof sticker !== 'object' ||
      Array.isArray(sticker) ||
      Object.keys(sticker).some((key) => !['stickerId', 'targetEntryId'].includes(key)) ||
      !catalogue.stickers.has(sticker.stickerId) ||
      (sticker.targetEntryId !== undefined && !validId(sticker.targetEntryId))
    ) {
      return fail();
    }
    const key = JSON.stringify([sticker.stickerId, sticker.targetEntryId || null]);
    if (seen.has(key)) {
      return fail();
    }
    seen.add(key);
    return sticker.targetEntryId === undefined
      ? { stickerId: sticker.stickerId }
      : { stickerId: sticker.stickerId, targetEntryId: sticker.targetEntryId };
  });
  input.backgroundId = payload.backgroundId;
  return input;
}
function checkedDocument(doc, month) {
  if (doc === undefined) {
    return { month, version: 0, stickers: [], backgroundId: null };
  }
  if (!doc || !validVersion(doc.version) || doc.version === 0 || !Array.isArray(doc.stickers)) {
    throw new Error('Invalid decoration storage');
  }
  if (
    doc.stickers.length > LIMITS.staticStickers ||
    (doc.backgroundId !== null && !validId(doc.backgroundId))
  ) {
    throw new Error('Invalid decoration storage');
  }
  const seen = new Set();
  for (const sticker of doc.stickers) {
    if (
      !sticker ||
      !validId(sticker.stickerId) ||
      (sticker.targetEntryId !== undefined && !validId(sticker.targetEntryId))
    ) {
      throw new Error('Invalid decoration storage');
    }
    const key = JSON.stringify([sticker.stickerId, sticker.targetEntryId || null]);
    if (seen.has(key)) {
      throw new Error('Invalid decoration storage');
    }
    seen.add(key);
  }
  return { month, version: doc.version, stickers: doc.stickers, backgroundId: doc.backgroundId };
}

function createDecorationService({
  repository,
  catalogue: inputCatalogue,
  receiptPolicy,
  now = () => new Date(),
}) {
  // These IDs are server configuration, never payload fields or synthetic demo imports.
  const catalogue = {
    stickers: catalogueIds(inputCatalogue.stickers, LIMITS.staticStickers),
    backgrounds: catalogueIds(inputCatalogue.backgrounds, LIMITS.staticBackgrounds),
  };
  return async ({ payload, actor, requestId }) => {
    const ownerId = requireActor(actor);
    const input = validateInput(payload, catalogue);
    if (
      input.operation !== 'get' &&
      (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId))
    ) {
      return fail();
    }
    if (input.operation !== 'get' && !receiptPolicy) {
      throw new AppError('NOT_IMPLEMENTED', '请求回执策略尚未配置。');
    }
    const binding =
      input.operation === 'get' ? null : receiptPolicy.bind('review.decorations', payload, now());
    return repository.transact(ownerId, async (tx) => {
      const current = checkedDocument(await tx.getDecorations(input.month), input.month);
      const marks = await tx.listMonthMarks(input.month);
      if (
        !Array.isArray(marks) ||
        marks.length > 31 ||
        marks.some(
          (mark) =>
            !mark ||
            !validId(mark.id) ||
            !isBusinessDate(mark.date) ||
            !mark.date.startsWith(input.month + '-'),
        ) ||
        new Set(marks.map((mark) => mark.id)).size !== marks.length ||
        new Set(marks.map((mark) => mark.date)).size !== marks.length
      ) {
        throw new Error('Invalid decoration source snapshot');
      }
      const ids = new Set(marks.map((mark) => mark.id));
      const view = (doc) => ({
        month: input.month,
        version: doc.version,
        stickers: doc.stickers
          .filter(
            (sticker) =>
              catalogue.stickers.has(sticker.stickerId) &&
              (!sticker.targetEntryId || ids.has(sticker.targetEntryId)),
          )
          .map((sticker) =>
            sticker.targetEntryId
              ? { stickerId: sticker.stickerId, targetEntryId: sticker.targetEntryId }
              : { stickerId: sticker.stickerId },
          ),
        backgroundId: catalogue.backgrounds.has(doc.backgroundId) ? doc.backgroundId : null,
      });
      if (input.operation === 'get') {
        return view(current);
      }
      const receipt = await tx.getReceipt('review.decorations', requestId);
      if (receipt) {
        if (
          !binding.matches(receipt) ||
          receipt.version !== current.version ||
          receipt.month !== input.month
        ) {
          return fail('CONFLICT');
        }
        await tx.touchAccount();
        return view(current);
      }
      if (input.expectedVersion !== current.version) {
        return fail('CONFLICT');
      }
      if (
        input.operation === 'replace' &&
        input.stickers.some((sticker) => sticker.targetEntryId && !ids.has(sticker.targetEntryId))
      ) {
        return fail();
      }
      let next = current;
      await tx.touchAccount();
      if (input.operation === 'replace' || current.version !== 0) {
        if (current.version === Number.MAX_SAFE_INTEGER) {
          return fail('CONFLICT');
        }
        next = {
          version: current.version + 1,
          stickers: input.operation === 'replace' ? input.stickers : [],
          backgroundId: input.operation === 'replace' ? input.backgroundId : null,
        };
        await tx.setDecorations(input.month, next);
        await tx.invalidateExports();
      }
      await tx.setReceipt('review.decorations', requestId, {
        ...binding.stamp,
        version: next.version,
        month: input.month,
      });
      return view(next);
    });
  };
}
module.exports = { createDecorationService };
