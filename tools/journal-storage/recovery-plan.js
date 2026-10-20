// Offline preflight only: no database writes, deletes, file reads or service reopening.
// Ledger coverage flags are declarations to review, not proof this module can authenticate.
const { isBusinessDate } = require('../../cloudfunctions/moodsky/shared/date');
const { validateJournalInput } = require('../../cloudfunctions/moodsky/shared/validation');
const { LAYOUT, dayId } = require('./cloudbase-candidate');
const idValid = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const version = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
function time(value) {
  if (typeof value !== 'string') {
    return NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}
const blocked = (reason) => ({
  status: 'blocked',
  reason,
  mayOpenPrivateServices: false,
  actions: [],
});
function planJournalRecovery({ accountId, backup, ledger, cutoff }) {
  if (
    !idValid(accountId) ||
    !backup ||
    !ledger ||
    backup.ownerId !== accountId ||
    ledger.ownerId !== accountId
  ) {
    return blocked('OWNER_OR_SOURCE_INVALID');
  }
  const snapshotAt = time(backup.snapshotAt);
  const from = time(ledger.from);
  const through = time(ledger.through);
  const cutoffAt = time(cutoff);
  if (
    !Number.isFinite(snapshotAt) ||
    !Number.isFinite(from) ||
    !Number.isFinite(through) ||
    !Number.isFinite(cutoffAt) ||
    snapshotAt > cutoffAt ||
    from > snapshotAt ||
    through < cutoffAt
  ) {
    return blocked('LEDGER_WATERMARK_GAP');
  }
  if (ledger.independent !== true || ledger.complete !== true) {
    return blocked('INDEPENDENT_COMPLETE_LEDGER_REQUIRED');
  }
  if (
    backup.layout !== LAYOUT ||
    !Array.isArray(backup.journals) ||
    !Array.isArray(ledger.events)
  ) {
    return blocked('LAYOUT_OR_ROWS_INVALID');
  }
  const minimumMetadata = {};
  for (const field of ['journalRevision', 'operationFence', 'exportEpoch']) {
    if (!version(backup[field]) || !version(ledger[field])) {
      return blocked('SOURCE_VERSION_MATERIAL_MISSING');
    }
    minimumMetadata[field] = Math.max(backup[field], ledger[field]);
    if (minimumMetadata[field] === Number.MAX_SAFE_INTEGER) {
      return blocked('SOURCE_VERSION_EXHAUSTED');
    }
  }
  if (!['active', 'disabled'].includes(ledger.accountStatus)) {
    return blocked('ACCOUNT_STATUS_MATERIAL_MISSING');
  }
  const byDate = new Map();
  const events = new Map();
  const generations = new Map();
  const entryGenerations = new Map();
  const entryDates = new Map();
  for (const event of ledger.events) {
    const deletedAt = event && time(event.deletedAt);
    if (
      !event ||
      event.ownerId !== accountId ||
      !isBusinessDate(event.date) ||
      !idValid(event.entryId) ||
      !version(event.deletedVersion, 2) ||
      !Number.isFinite(deletedAt) ||
      deletedAt > through
    ) {
      return blocked('DELETION_LEDGER_INVALID');
    }
    const key = event.entryId + ':' + event.deletedVersion;
    const generation = event.date + ':' + event.deletedVersion;
    if (
      (generations.has(generation) && generations.get(generation) !== event.entryId) ||
      (entryGenerations.has(event.entryId) && entryGenerations.get(event.entryId) !== generation)
    ) {
      return blocked('DELETION_LEDGER_CONTRADICTION');
    }
    generations.set(generation, event.entryId);
    entryGenerations.set(event.entryId, generation);
    entryDates.set(event.entryId, event.date);
    const normalized = JSON.stringify([
      event.date,
      event.entryId,
      event.deletedVersion,
      event.deletedAt,
    ]);
    if (events.has(key)) {
      if (events.get(key) !== normalized) {
        return blocked('DELETION_LEDGER_CONTRADICTION');
      }
      continue;
    }
    events.set(key, normalized);
    const current = byDate.get(event.date) || [];
    current.push(event);
    byDate.set(event.date, current);
  }
  const dates = new Set();
  const ids = new Set();
  const actions = [];
  let preservedActiveCount = 0;
  for (const row of backup.journals) {
    if (
      !row ||
      row.ownerId !== accountId ||
      !isBusinessDate(row.date) ||
      dates.has(row.date) ||
      !version(row.version, 1) ||
      !['active', 'deleted'].includes(row.state)
    ) {
      return blocked('BACKUP_ROWS_INVALID');
    }
    dates.add(row.date);
    if (row.state === 'active') {
      try {
        validateJournalInput({
          date: row.date,
          weather: row.weather,
          tags: row.tags,
          text: row.text,
          expectedVersion: row.version,
        });
      } catch (_error) {
        return blocked('BACKUP_ROWS_INVALID');
      }
      if (!idValid(row.entryId) || ids.has(row.entryId)) {
        return blocked('BACKUP_ROWS_INVALID');
      }
      ids.add(row.entryId);
      if (entryDates.has(row.entryId) && entryDates.get(row.entryId) !== row.date) {
        return blocked('DELETED_ID_MOVED_TO_ANOTHER_DATE');
      }
    } else if (
      ['text', 'weather', 'tags', 'entryId'].some((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      )
    ) {
      return blocked('BACKUP_TOMBSTONE_CONTAINS_CONTENT');
    }
    const markers = byDate.get(row.date) || [];
    const latestVersion = markers.reduce((max, marker) => Math.max(max, marker.deletedVersion), 0);
    if (row.state === 'active' && latestVersion === row.version) {
      return blocked('ACTIVE_DELETION_GENERATION_COLLISION');
    }
    if (
      row.state === 'active' &&
      markers.some(
        (marker) => marker.entryId === row.entryId && marker.deletedVersion <= row.version,
      )
    ) {
      return blocked('DELETED_ID_REUSED_OR_GENERATION_CORRUPT');
    }
    if (latestVersion > row.version || (latestVersion === row.version && row.state === 'active')) {
      actions.push({
        operation: 'replace-day-with-tombstone',
        docId: dayId(accountId, row.date),
        expectedVersion: row.version,
        replacement: {
          layout: LAYOUT,
          ownerId: accountId,
          date: row.date,
          version: latestVersion,
          state: 'deleted',
        },
      });
    } else if (row.state === 'active') {
      preservedActiveCount++;
    }
  }
  // Restore missing dates as generation tombstones too: absence must not reset them to v1.
  for (const [date, markers] of byDate) {
    if (!dates.has(date)) {
      actions.push({
        operation: 'create-missing-tombstone',
        docId: dayId(accountId, date),
        expectedVersion: 0,
        replacement: {
          layout: LAYOUT,
          ownerId: accountId,
          date,
          version: markers.reduce((max, marker) => Math.max(max, marker.deletedVersion), 0),
          state: 'deleted',
        },
      });
    }
  }
  actions.sort((a, b) => a.replacement.date.localeCompare(b.replacement.date));
  return {
    status: 'plan',
    mayOpenPrivateServices: false,
    accountStatusRequired: ledger.accountStatus,
    minimumMetadata,
    mustIssueNewExportEpoch: true,
    preservedActiveCount,
    distinctDeletionEvents: events.size,
    actions,
    remaining: [
      'VERIFY_LEDGER_PROVENANCE',
      'EXECUTE_ATOMIC_REPLAY',
      'RECONCILE_EXPORTS_AND_CACHES',
      'INDEPENDENT_RECOVERY_ACCEPTANCE',
    ],
  };
}
module.exports = { planJournalRecovery };
