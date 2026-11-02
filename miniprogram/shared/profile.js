const { AppError } = require('./result');
const MAX_AVATAR_BYTES = 32768;
function profileFields(value) {
  if (!value || typeof value.nickname !== 'string' || typeof value.avatarData !== 'string') {
    throw new AppError('INVALID_INPUT', '个人资料格式无效。');
  }
  const nickname = value.nickname.trim();
  if (Array.from(nickname).length > 20 || /[\u0000-\u001f\u007f]/.test(nickname)) {
    throw new AppError('INVALID_INPUT', '昵称最多20个字，不能包含换行。');
  }
  if (
    value.avatarData &&
    (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatarData) ||
      value.avatarData.length > 43800)
  ) {
    throw new AppError('INVALID_INPUT', '请重新选择头像，图片需小于32KB。');
  }
  return { nickname, avatarData: value.avatarData };
}
function profileView(value) {
  if (!value) {
    return { nickname: '', avatarData: '', version: 0, updatedAt: null };
  }
  if (
    value.version === 0 &&
    value.nickname === '' &&
    value.avatarData === '' &&
    value.updatedAt === null
  ) {
    return { nickname: '', avatarData: '', version: 0, updatedAt: null };
  }
  if (
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new AppError('INVALID_RESPONSE', '个人资料版本无效，请重新读取。');
  }
  return { ...profileFields(value), version: value.version, updatedAt: value.updatedAt };
}
module.exports = { MAX_AVATAR_BYTES, profileFields, profileView };
