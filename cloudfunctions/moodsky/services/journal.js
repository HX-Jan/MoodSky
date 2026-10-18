const { randomUUID } = require('node:crypto');
const { AppError } = require('../shared/result');
const { validateJournalInput, REQUEST_ID_PATTERN } = require('../shared/validation');
const { isBusinessDate, canCreateEntry } = require('../shared/date');

const invalid = () => {
  throw new AppError('INVALID_INPUT', '记录输入无效。');
};
const conflict = () => {
  throw new AppError('CONFLICT', '记录状态已变化，请刷新后重试。');
};
function requireActor(actor) {
  if (!actor || typeof actor.accountId !== 'string' || !actor.accountId) {
    throw new AppError('UNAUTHENTICATED', '请先登录。');
  }
  return actor.accountId;
}
function dateInput(payload, deleting = false) {
  const allowed = deleting ? ['date', 'expectedVersion'] : ['date'];
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !allowed.includes(key)) ||
    !isBusinessDate(payload.date) ||
    (deleting && (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion <= 0))
  ) {
    invalid();
  }
  return deleting
    ? { date: payload.date, expectedVersion: payload.expectedVersion }
    : { date: payload.date };
}
function entryView(entry) {
  if (!entry) {
    return null;
  }
  return {
    id: entry.id,
    date: entry.date,
    weather: entry.weather,
    tags: [...entry.tags],
    text: entry.text,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
function nextVersion(version) {
  if (!Number.isSafeInteger(version) || version < 0 || version === Number.MAX_SAFE_INTEGER) {
    return conflict();
  }
  return version + 1;
}

// Opt-in backend. The repository must provide atomic, isolated per-account transactions;
// a read/modify/write wrapper around ordinary database calls does NOT satisfy this contract.
function createJournalService({
  repository,
  receiptPolicy,
  now = () => new Date(),
  createId = randomUUID,
}) {
  return async ({ action, payload, originalPayload = payload, actor, requestId }) => {
    const ownerId = requireActor(actor);
    if (!['journal.get', 'journal.upsert', 'journal.delete'].includes(action)) {
      throw new AppError('ACTION_NOT_FOUND', '接口不存在。');
    }
    const saving = action === 'journal.upsert';
    const input = saving
      ? validateJournalInput(payload)
      : dateInput(payload, action === 'journal.delete');
    if (saving && !Number.isSafeInteger(input.expectedVersion)) {
      invalid();
    }
    if (action === 'journal.get') {
      const day = await repository.readDay(ownerId, input.date);
      return { entry: entryView(day && day.entry) };
    }
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
      invalid();
    }
    if (!receiptPolicy) {
      throw new AppError('NOT_IMPLEMENTED', '请求回执策略尚未配置。');
    }
    // Freeze the original input binding, candidate ID and clock before SDK callback retries.
    const instant = now();
    const binding = receiptPolicy.bind(action, originalPayload, instant);
    const candidateId = saving ? createId() : null;
    return repository.transact(ownerId, async (tx) => {
      const day = await tx.getDay(input.date);
      const receipt = await tx.getReceipt(action, requestId);
      const generation = day ? day.version : 0;
      if (receipt) {
        if (!binding.matches(receipt) || receipt.version !== generation) {
          return conflict();
        }
        if (saving) {
          if (!day.entry || day.entry.id !== receipt.entryId) {
            return conflict();
          }
          await tx.touchAccount();
          return { entry: entryView(day.entry) };
        }
        if (day && day.entry) {
          return conflict();
        }
        await tx.touchAccount();
        return { date: input.date, deleted: receipt.deleted };
      }
      const active = day && day.entry;
      if (saving) {
        if (
          (input.expectedVersion === 0 && active) ||
          (input.expectedVersion > 0 && (!active || generation !== input.expectedVersion))
        ) {
          return conflict();
        }
        if (!active && !canCreateEntry(input.date, instant)) {
          throw new AppError('INVALID_INPUT', '已超出新建窗口。');
        }
        const timestamp = instant.toISOString();
        const version = nextVersion(generation);
        const entry = {
          id: active ? active.id : candidateId,
          date: input.date,
          weather: input.weather,
          tags: input.tags,
          text: input.text,
          version,
          createdAt: active ? active.createdAt : timestamp,
          updatedAt: timestamp,
        };
        await tx.touchAccount();
        await tx.setDay(input.date, { version, entry });
        await tx.advanceRevision();
        await tx.setReceipt(action, requestId, { ...binding.stamp, version, entryId: entry.id });
        return { entry: entryView(entry) };
      }
      if (active && generation !== input.expectedVersion) {
        return conflict();
      }
      // Tombstones retain only a monotonic version, no text, tags or weather.
      const version = active ? nextVersion(generation) : generation;
      await tx.touchAccount();
      if (active) {
        await tx.setDay(input.date, { version, entry: null });
        await tx.writeDeletionMarker({
          date: input.date,
          entryId: active.id,
          deletedVersion: version,
          deletedAt: instant.toISOString(),
        });
        await tx.advanceRevision();
      }
      await tx.setReceipt(action, requestId, { ...binding.stamp, version, deleted: !!active });
      return { date: input.date, deleted: !!active };
    });
  };
}

module.exports = { createJournalService, requireActor };
