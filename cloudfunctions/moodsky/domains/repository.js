const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 获取或创建内部账号（W2XY02）
 * 保证同一微信身份重复请求不会生成多个账号
 */
async function getOrCreateAccount(openid) {
  const accountsRef = db.collection('accounts');

  // 1. 尝试查询
  const res = await accountsRef.where({ _openid: openid }).get();
  if (res.data && res.data.length > 0) {
    return res.data[0];
  }

  // 2. 不存在则创建
  try {
    const newAccount = {
      _openid: openid,
      status: 'active',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };
    const addRes = await accountsRef.add({ data: newAccount });
    return { ...newAccount, _id: addRes._id, id: addRes._id };
  } catch (err) {
    // 处理并发首次创建（依赖唯一索引）
    if (err.errCode === -502001 || err.message.includes('duplicate key')) {
      const retryRes = await accountsRef.where({ _openid: openid }).get();
      if (retryRes.data && retryRes.data.length > 0) {
        return retryRes.data[0];
      }
    }
    throw err;
  }
}

/**
 * 按日期查询本人记录（W2XY02）
 */
async function getJournalByDate(ownerId, date) {
  const res = await db.collection('journals').where({ ownerId, date }).get();
  return res.data && res.data.length > 0 ? res.data[0] : null;
}

/**
 * 保存记录（含同日唯一与乐观锁并发控制）（W2XY02）
 */
async function saveJournal(ownerId, input) {
  const { date, weather, tags, text, expectedVersion } = input;
  const journalsRef = db.collection('journals');

  // 1. 新建逻辑 (expectedVersion === 0)
  if (expectedVersion === 0) {
    const existing = await getJournalByDate(ownerId, date);
    if (existing) {
      const err = new Error('MOOD_ALREADY_EXISTS');
      err.code = 'MOOD_ALREADY_EXISTS';
      throw err;
    }

    const newEntry = {
      ownerId,
      date,
      weather,
      tags: tags || [],
      text: text || '',
      version: 1,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };

    try {
      const addRes = await journalsRef.add({ data: newEntry });
      return { ...newEntry, _id: addRes._id };
    } catch (err) {
      if (err.errCode === -502001 || err.message.includes('duplicate key')) {
        const conflictErr = new Error('MOOD_ALREADY_EXISTS');
        conflictErr.code = 'MOOD_ALREADY_EXISTS';
        throw conflictErr;
      }
      throw err;
    }
  }

  // 2. 更新逻辑 (并发控制)
  const existing = await getJournalByDate(ownerId, date);
  if (!existing) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (existing.version !== expectedVersion) {
    const err = new Error('VERSION_CONFLICT');
    err.code = 'VERSION_CONFLICT';
    throw err;
  }

  // 使用 version 作为乐观锁条件，防止并发覆盖
  const updateRes = await journalsRef
    .where({ _id: existing._id, version: expectedVersion })
    .update({
      data: {
        weather,
        tags: tags || [],
        text: text || '',
        version: _.inc(1),
        updatedAt: db.serverDate(),
      },
    });

  if (updateRes.stats.updated === 0) {
    const err = new Error('VERSION_CONFLICT');
    err.code = 'VERSION_CONFLICT';
    throw err;
  }

  return getJournalByDate(ownerId, date);
}

/**
 * 删除记录并写入 deletion_markers（W2XY02 / W2XY04）
 */
async function deleteJournal(ownerId, date) {
  const existing = await getJournalByDate(ownerId, date);
  if (!existing) {
    return false;
  }

  // 开启事务保证：记录删除与标记写入的原子性
  const transaction = await db.startTransaction();
  try {
    await transaction.collection('journals').doc(existing._id).remove();
    await transaction.collection('deletion_markers').add({
      data: {
        collection: 'journals',
        docId: existing._id,
        deletedAt: db.serverDate(),
      },
    });
    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  getOrCreateAccount,
  getJournalByDate,
  saveJournal,
  deleteJournal,
};
