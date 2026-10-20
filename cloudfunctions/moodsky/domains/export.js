// W2XY03 (Phoenix-Yx), revised in PR31. Internal snapshot/job helpers, not public handlers.
const { createHash } = require('node:crypto');
const { notImplemented } = require('../shared/result');
const { REQUEST_ID_PATTERN } = require('../shared/validation');
const { database, identity, account, fail, sourceState, ownerPage } = require('./storage-support');
const SOURCES = {
  journals: [
    'ownerId',
    'date',
    'weather',
    'tags',
    'text',
    'version',
    'state',
    'createdAt',
    'updatedAt',
  ],
  favorites: ['ownerId', 'placeId', 'placeName', 'createdAt'],
  task_history: ['ownerId', 'taskId', 'taskTitle', 'date', 'state', 'createdAt'],
  preferences: ['ownerId', 'cardTextPreview', 'decorationsEnabled', 'updatedAt'],
  month_decorations: ['ownerId', 'month', 'version', 'stickers', 'backgroundId'],
};

function createExportService({
  db,
  readSourceState,
  maxRecords,
  pageSize = 100,
  now = () => new Date(),
} = {}) {
  const state = async (ownerId) => {
    database(db);
    if (typeof readSourceState !== 'function') {
      return notImplemented();
    }
    return db.runTransaction(async (tx) => {
      account((await tx.collection('accounts').doc(ownerId).get()).data, ownerId, 'active');
      return sourceState(await readSourceState(ownerId, tx), ownerId);
    });
  };
  async function gatherExportData(ownerId) {
    identity(ownerId);
    if (
      !Number.isSafeInteger(maxRecords) ||
      maxRecords < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return fail();
    }
    const before = await state(ownerId);
    const result = {};
    for (const [collection, fields] of Object.entries(SOURCES)) {
      const records = [];
      let cursor = '',
        scanned = 0;
      while (true) {
        const rows = await ownerPage(db, collection, ownerId, cursor, pageSize);
        scanned += rows.length;
        if (scanned > maxRecords) {
          return fail();
        } // Never return a silently truncated file.
        for (const row of rows) {
          if (collection === 'journals') {
            if (!['active', 'deleted'].includes(row.state)) {
              return fail('CONFLICT');
            }
            if (row.state === 'deleted') {
              continue;
            }
          }
          const projected = Object.fromEntries(
            fields.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]),
          );
          if (collection === 'journals') {
            projected.id = row.entryId || row._id;
          }
          records.push(projected);
        }
        if (rows.length < pageSize) {
          break;
        }
        cursor = rows.at(-1)._id;
      }
      result[collection] = records;
    }
    if (result.preferences.length > 1) {
      return fail('CONFLICT');
    }
    const after = await state(ownerId);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      return fail('CONFLICT');
    }
    return {
      ownerId,
      accountStatus: 'active',
      sourceRevision: before.revisions.journals,
      sourceRevisions: before.revisions,
      accountEpoch: before.epoch,
      journals: result.journals,
      favorites: result.favorites,
      taskHistory: result.task_history,
      preferences: result.preferences[0] || null,
      monthDecorations: result.month_decorations,
    };
  }
  async function createExportJob(ownerId, format, requestId) {
    identity(ownerId);
    if (
      !['json', 'markdown'].includes(format) ||
      typeof requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(requestId)
    ) {
      return fail();
    }
    const source = await state(ownerId);
    const timestamp = now().toISOString();
    const jobId = createHash('sha256')
      .update(JSON.stringify(['export-job', ownerId, requestId]))
      .digest('hex')
      .slice(0, 32);
    return db.runTransaction(async (tx) => {
      account((await tx.collection('accounts').doc(ownerId).get()).data, ownerId, 'active');
      const document = tx.collection('export_jobs').doc(jobId);
      const existing = (await document.get()).data;
      if (existing) {
        if (
          existing.ownerId !== ownerId ||
          existing.format !== format ||
          existing.accountEpoch !== source.epoch ||
          JSON.stringify(existing.sourceRevisions) !== JSON.stringify(source.revisions) ||
          !['pending', 'processing', 'ready', 'expired', 'failed'].includes(existing.state)
        ) {
          return fail('CONFLICT');
        }
        return { jobId, state: existing.state, format: existing.format };
      }
      await document.set({
        data: {
          ownerId,
          format,
          state: 'pending',
          accountEpoch: source.epoch,
          sourceRevisions: source.revisions,
          fileId: null,
          expiresAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
      return { jobId, state: 'pending', format };
    });
  }
  return { gatherExportData, createExportJob };
}
module.exports = { createExportService, ...createExportService() };
