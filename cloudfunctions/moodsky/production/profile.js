const { createHash } = require('node:crypto');
const { AppError } = require('../shared/result');
const { DEFAULT_PREFERENCES } = require('../shared/constants');
const { profileFields, profileView, MAX_AVATAR_BYTES } = require('../shared/profile');
const { createSourceRevisionWriter } = require('../services/account-data');
function createProductionProfile({ db, transactions, now = () => new Date() }) {
  const bump = createSourceRevisionWriter({ db });
  return async (request) => {
    const { payload, requestId } = request;
    const ownerId = request.actor.accountId;
    const writing = payload.operation === 'set';
    const allowed = writing
      ? ['operation', 'nickname', 'avatarData', 'expectedVersion']
      : ['operation'];
    if (
      !['get', 'set'].includes(payload.operation) ||
      Object.keys(payload).some((key) => !allowed.includes(key))
    ) {
      throw new AppError('INVALID_INPUT', '个人资料操作或字段无效。');
    }
    let fields, digest;
    if (writing) {
      fields = profileFields(payload);
      if (
        !Number.isSafeInteger(payload.expectedVersion) ||
        payload.expectedVersion < 0 ||
        payload.expectedVersion >= Number.MAX_SAFE_INTEGER
      ) {
        throw new AppError('INVALID_INPUT', '请重新读取个人资料后再保存。');
      }
      if (fields.avatarData) {
        const [header, encoded] = fields.avatarData.split(',');
        const bytes = Buffer.from(encoded, 'base64');
        const png = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
        const jpeg =
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255 &&
          bytes[bytes.length - 2] === 255 &&
          bytes[bytes.length - 1] === 217;
        if (
          bytes.length > MAX_AVATAR_BYTES ||
          bytes.toString('base64') !== encoded ||
          !(header === 'data:image/png;base64' ? png : jpeg)
        ) {
          throw new AppError('INVALID_INPUT', '头像文件无效，请重新选择。');
        }
      }
      digest = createHash('sha256')
        .update(JSON.stringify([fields, payload.expectedVersion]))
        .digest('hex');
    }
    return transactions.withOwner(ownerId, async () => {
      const tx = transactions.transaction(ownerId);
      const ref = tx.collection('preferences').doc('pref_' + ownerId);
      const row = (await ref.get()).data;
      if (row && row.ownerId !== ownerId) {
        throw new AppError('FORBIDDEN', '无法访问此个人资料。');
      }
      const current = profileView(row?.profile);
      if (!writing) {
        return current;
      }
      if (row?.profile?.requestId === requestId) {
        if (row.profile.digest !== digest) {
          throw new AppError('CONFLICT', '原操作内容已变化，请重新读取。');
        }
        return current;
      }
      if (current.version !== payload.expectedVersion) {
        throw new AppError('CONFLICT', '个人资料已更新，请重新读取后修改。');
      }
      const updatedAt = now().toISOString();
      const profile = { ...fields, version: current.version + 1, updatedAt, requestId, digest };
      const saved = { ...DEFAULT_PREFERENCES, ...row, ownerId, profile, updatedAt };
      delete saved._id;
      await ref.set({ data: saved });
      await bump(ownerId, 'preferences', tx);
      transactions.changed(ownerId);
      return profileView(profile);
    });
  };
}
module.exports = { createProductionProfile };
