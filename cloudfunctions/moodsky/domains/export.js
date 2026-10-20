const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 获取用户需要导出的数据 (W2XY03)
 * 这里只负责组织数据，不负责生成真实文件
 */
async function gatherExportData(ownerId) {
  const result = {
    journals: [],
    favorites: [],
    task_history: [],
    preferences: [],
  };

  // 1. 获取记录
  const journalsRes = await db.collection('journals').where({ ownerId }).get();
  result.journals = journalsRes.data;

  // 2. 获取收藏
  const favoritesRes = await db.collection('favorites').where({ ownerId }).get();
  result.favorites = favoritesRes.data;

  // 3. 获取任务历史
  const tasksRes = await db.collection('task_history').where({ ownerId }).get();
  result.task_history = tasksRes.data;

  // 4. 获取偏好
  const prefsRes = await db.collection('preferences').where({ ownerId }).get();
  result.preferences = prefsRes.data.length > 0 ? prefsRes.data[0] : null;

  return result;
}

/**
 * 创建导出任务（契约骨架）
 */
async function createExportJob(ownerId, format) {
  const newJob = {
    ownerId,
    format: format || 'json',
    state: 'pending',
    fileId: null,
    progress: 0,
    error: null,
    expiresAt: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };

  const res = await db.collection('export_jobs').add({ data: newJob });
  return { ...newJob, _id: res._id };
}

module.exports = {
  gatherExportData,
  createExportJob,
};
