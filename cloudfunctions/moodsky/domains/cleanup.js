// W2XY04 (Phoenix-Yx), revised in PR31. Trusted worker helper; never a public action.
const { createHash } = require('node:crypto');
const { notImplemented } = require('../shared/result');
const { database, identity, account, fail, ownerPage } = require('./storage-support');

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

function createCleanupService({ db, removeExportFile } = {}) {
  async function guard(tx, ownerId, jobId, collection, allowCompleted = false) {
    const owner = account(
      (await tx.collection('accounts').doc(ownerId).get()).data,
      ownerId,
      'disabled',
    );
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
    database(db);
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

      // --- 你的新增代码开始 (W3XY04 文件删除重试容错) ---
      try {
        const receipt = await removeExportFile({ ownerId, jobId, fileId: intent.fileId });
        if (!receipt || (receipt.deleted !== true && receipt.alreadyMissing !== true)) {
          return fail('CONFLICT');
        }
      } catch (err) {
        // 把真实错误原样抛出，方便测试断言，同时让调度器捕获重试
        console.error(`[Cleanup] 删除云存储文件失败: ${intent.fileId}`, err.message);
        throw err;
      }
      // --- 你的新增代码结束 ---
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
    const initial = await db.runTransaction((tx) => guard(tx, ownerId, jobId, 'journals', true));

    if (initial.job.state !== 'completed') {
      for (const collection of COLLECTIONS) {
        await cleanupByOwnerId(collection, ownerId, options);
      }
    }

    for (const collection of COLLECTIONS) {
      if ((await ownerPage(db, collection, ownerId, '', 1)).length) {
        return fail('CONFLICT');
      }
    }

    // --- 你的新增代码开始 (W3XY04 保证清理总数准确且能返回给前端) ---
    return db.runTransaction(async (tx) => {
      const checked = await guard(tx, ownerId, jobId, 'journals', true);

      // 将各集合的清理数量汇总，作为业务反馈返回给前端
      const progress = Object.fromEntries(
        COLLECTIONS.map((collection) => [collection, checked.progress[collection] || 0]),
      );
      const totalDeleted = Object.values(progress).reduce((a, b) => a + b, 0);

      if (checked.job.state !== 'completed') {
        const completed = await checked.jobDocument.update({
          data: {
            state: 'completed',
            progress,
            totalDeleted, // 你的新增字段：记录本次注销清理的完整数据量
            updatedAt: db.serverDate(),
          },
        });
        if (completed.stats?.updated !== 1) {
          return fail('CONFLICT');
        }
      }
      return { state: 'completed', progress, totalDeleted };
    });
    // --- 你的新增代码结束 ---
  }

  return { cleanupByOwnerId, executeAccountCleanup };
}

module.exports = { createCleanupService, markerId, ...createCleanupService() };
