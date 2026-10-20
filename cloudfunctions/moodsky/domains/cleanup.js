const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 批量清理某个集合中属于某用户的记录 (W2XY04)
 * @param {string} collectionName 集合名
 * @param {string} ownerId 用户ID
 * @param {number} batchSize 每次删除数量
 */
async function cleanupByOwnerId(collectionName, ownerId, batchSize = 100) {
  let deletedTotal = 0;
  let hasMore = true;

  while (hasMore) {
    // 1. 分批查询
    const res = await db.collection(collectionName).where({ ownerId }).limit(batchSize).get();

    if (!res.data || res.data.length === 0) {
      hasMore = false;
      break;
    }

    // 2. 逐条删除并写入删除标记 (保证备份恢复时可以重放)
    for (const doc of res.data) {
      await db.collection(collectionName).doc(doc._id).remove();
      await db.collection('deletion_markers').add({
        data: {
          collection: collectionName,
          docId: doc._id,
          deletedAt: db.serverDate(),
        },
      });
      deletedTotal++;
    }

    // 3. 如果本次查询返回数量少于 batchSize，说明已经删完
    if (res.data.length < batchSize) {
      hasMore = false;
    }
  }

  return deletedTotal;
}

/**
 * 执行完整的账号数据清理任务 (W2XY04)
 * 按模块顺序清理
 */
async function executeAccountCleanup(ownerId) {
  // 清理顺序很重要：先清私人数据，最后清偏好和导出记录
  const collectionsToClean = [
    'journals',
    'favorites',
    'task_history',
    'preferences',
    'month_decorations',
    'request_receipts',
  ];

  const progress = {};

  for (const coll of collectionsToClean) {
    try {
      const count = await cleanupByOwnerId(coll, ownerId);
      progress[coll] = count;
    } catch (err) {
      progress[coll] = `error: ${err.message}`;
      // 如果中途出错，根据契约应当记录并抛出，等待重试机制接管
      throw new Error(`CLEANUP_FAILED_AT_${coll}`);
    }
  }

  // 导出任务比较特殊，需要先删云存储文件，再删记录
  // 这里先留空，等 W2XY03 导出模块写完后再补
  progress['export_jobs'] = 0;

  return progress;
}

module.exports = {
  cleanupByOwnerId,
  executeAccountCleanup,
};
