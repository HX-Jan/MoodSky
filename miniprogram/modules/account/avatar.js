const { MAX_AVATAR_BYTES, profileFields } = require('../../shared/profile');
const { AppError } = require('../../shared/result');
async function prepareAvatar(platform, filePath) {
  const compressed = await new Promise((resolve, reject) =>
    platform.compressImage({
      src: filePath,
      quality: 60,
      compressedWidth: 128,
      compressedHeight: 128,
      success: resolve,
      fail: reject,
    }),
  );
  const result = await new Promise((resolve, reject) =>
    platform.getFileSystemManager().readFile({
      filePath: compressed.tempFilePath,
      encoding: 'base64',
      success: resolve,
      fail: reject,
    }),
  );
  const base64 = result.data;
  if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4) {
    throw new AppError('INVALID_INPUT', '头像太大，请换一张图片。');
  }
  const mime = base64.startsWith('iVBORw0KGgo') ? 'png' : base64.startsWith('/9j/') ? 'jpeg' : '';
  if (!mime) {
    throw new AppError('INVALID_INPUT', '请选择PNG或JPEG头像。');
  }
  return profileFields({ nickname: '', avatarData: 'data:image/' + mime + ';base64,' + base64 })
    .avatarData;
}
module.exports = { prepareAvatar };
