// W2XY04 (Phoenix-Yx), revised in PR31. Trusted worker helper; never a public action.
const { createHash } = require('node:crypto');
const { notImplemented } = require('../shared/result');
const {
  storageOptions,
  database,
  identity,
  account,
  fail,
  ownerPage,
} = require('./storage-support');
const COLLECTIONS = [
  'journals',
  'favorites',
  'task_history',
  'preferences',
  'month_decorations',
  'request_receipts',
  'export_jobs',
];
const markerId = (ownerId, collection, docId) =>
  createHash('sha256')
    .update(JSON.stringify(['account-cleanup', ownerId, collection, docId]))
    .digest('hex')
    .slice(0, 32);

function createCleanupService(options = {}) {
  const { db, removeExportFile } = storageOptions(
    options,
    arguments.length,
    'createCleanupService',
  );
  async function guard(tx, ownerId, jobId, collection, allowCompleted = false) {
    const owner = account(
      (await tx.collection('accounts').doc(ownerId).get()).data,
      ownerId,
      'disabled',
    );
    // This layout retains per-day generations. Its worker protocol must be reviewed separately.
    if (collection === 'journals' && owner.journalLayout === 'deterministic-days-v1') {
      return notImplemented();
    }
    const jobDocument = tx.collection('cleanup_jobs').doc(jobId);
    const job = (await jobDocument.get()).data;
    if (
      !job ||
      job.ownerId !== ownerId ||
      !['pending', 'processing', ...(allowCompleted ? ['completed'] : [])].includes(job.state) ||
      job.exportAccessRevoked !== true
    ) {
      return fail('FORBIDDEN');
    }
    const progress = job.progress || {};
    if (
      typeof progress !== 'object' ||
      Array.isArray(progress) ||
      Object.keys(progress).some(
        (key) =>
          !COLLECTIONS.includes(key) || !Number.isSafeInteger(progress[key]) || progress[key] < 0,
      )
    ) {
      return fail('CONFLICT');
    }
    return { jobDocument, job, progress };
  }
  function context(ownerId, options) {
    identity(ownerId);
    identity(options?.jobId);
    const batchSize = options.batchSize === undefined ? 100 : options.batchSize;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      return fail();
    }
    database(db, ['collection', 'serverDate']);
    return { jobId: options.jobId, batchSize };
  }
  async function prepare(tx, collection, ownerId, jobId, docId) {
    const checked = await guard(tx, ownerId, jobId, collection);
    const document = tx.collection(collection).doc(docId);
    const row = (await document.get()).data;
    if (!row) {
      return null;
    }
    if (row.ownerId !== ownerId || row._id !== docId) {
      return fail('FORBIDDEN');
    }
    const markerDocument = tx
      .collection('deletion_markers')
      .doc(markerId(ownerId, collection, docId));
    const marker = (await markerDocument.get()).data;
    if (
      marker &&
      (marker.ownerId !== ownerId ||
        marker.collection !== collection ||
        marker.docId !== docId ||
        marker.jobId !== jobId ||
        marker.cleanupState !== 'pending')
    ) {
      return fail('CONFLICT');
    }
    if (!marker) {
      // Metadata only. No private body, credentials or file references in the ledger.
      await markerDocument.set({
        data: {
          ownerId,
          collection,
          docId,
          jobId,
          deletedAt: db.serverDate(),
          cleanupState: 'pending',
        },
      });
    }
    return { ...checked, document, markerDocument, row };
  }
  async function finish(prepared, collection) {
    if (!prepared) {
      return false;
    }
    const { document, markerDocument, progress } = prepared;
    const count = progress[collection] || 0;
    if (count === Number.MAX_SAFE_INTEGER) {
      return fail('CONFLICT');
    }
    // Intent + deletion + persisted progress commit/rollback together.
    const marked = await markerDocument.update({ data: { cleanupState: 'completed' } });
    if (marked.stats?.updated !== 1) {
      return fail('CONFLICT');
    }
    const result = await document.remove();
    if (result.stats?.removed !== 1) {
      return fail('CONFLICT');
    }
    const progressed = await prepared.jobDocument.update({
      data: {
        state: 'processing',
        progress: { ...progress, [collection]: count + 1 },
        updatedAt: db.serverDate(),
      },
    });
    if (progressed.stats?.updated !== 1) {
      return fail('CONFLICT');
    }
    return true;
  }
  async function removeRow(collection, ownerId, jobId, row) {
    if (collection !== 'export_jobs') {
      return db.runTransaction(async (tx) =>
        finish(await prepare(tx, collection, ownerId, jobId, row._id), collection),
      );
    }
    // External files cannot participate in a DB transaction. Persist intent FIRST.
    const intent = await db.runTransaction(async (tx) => {
      const prepared = await prepare(tx, collection, ownerId, jobId, row._id);
      if (!prepared) {
        return null;
      }
      const fileId = prepared.row.fileId;
      if (fileId !== null && fileId !== undefined && (typeof fileId !== 'string' || !fileId)) {
        return fail('CONFLICT');
      }
      return { fileId: fileId || null };
    });
    if (!intent) {
      return false;
    }
    if (intent.fileId) {
      if (typeof removeExportFile !== 'function') {
        return notImplemented();
      }
      const receipt = await removeExportFile({ ownerId, jobId, fileId: intent.fileId });
      if (!receipt || (receipt.deleted !== true && receipt.alreadyMissing !== true)) {
        return fail('CONFLICT');
      }
    }
    return db.runTransaction(async (tx) => {
      const prepared = await prepare(tx, collection, ownerId, jobId, row._id);
      if (prepared && (prepared.row.fileId || null) !== intent.fileId) {
        return fail('CONFLICT');
      }
      return finish(prepared, collection);
    });
  }
  async function cleanupByOwnerId(collection, ownerId, options) {
    if (!COLLECTIONS.includes(collection)) {
      return fail();
    }
    const { jobId, batchSize } = context(ownerId, options);
    await db.runTransaction((tx) => guard(tx, ownerId, jobId, collection));
    let deletedTotal = 0;
    // Re-read the first batch after each committed deletion; no offset can skip shifted rows.
    while (true) {
      const rows = await ownerPage(db, collection, ownerId, '', batchSize);
      if (!rows.length) {
        break;
      }
      for (const row of rows) {
        if (await removeRow(collection, ownerId, jobId, row)) {
          deletedTotal++;
        }
      }
    }
    return deletedTotal;
  }
  async function executeAccountCleanup(ownerId, options) {
    const { jobId } = context(ownerId, options);
    // Preflight layout/auth before any module is removed.
    const initial = await db.runTransaction((tx) => guard(tx, ownerId, jobId, 'journals', true));
    if (initial.job.state !== 'completed') {
      for (const collection of COLLECTIONS) {
        await cleanupByOwnerId(collection, ownerId, options);
      }
    }
    // Check all scopes are empty before claiming completed; retain the deletion ledger.
    for (const collection of COLLECTIONS) {
      if ((await ownerPage(db, collection, ownerId, '', 1)).length) {
        return fail('CONFLICT');
      }
    }
    return db.runTransaction(async (tx) => {
      const checked = await guard(tx, ownerId, jobId, 'journals', true);
      const progress = Object.fromEntries(
        COLLECTIONS.map((collection) => [collection, checked.progress[collection] || 0]),
      );
      if (checked.job.state !== 'completed') {
        const completed = await checked.jobDocument.update({
          data: { state: 'completed', progress, updatedAt: db.serverDate() },
        });
        if (completed.stats?.updated !== 1) {
          return fail('CONFLICT');
        }
      }
      return { state: 'completed', progress };
    });
  }
  return { cleanupByOwnerId, executeAccountCleanup };
}
module.exports = { createCleanupService, markerId, ...createCleanupService() };
