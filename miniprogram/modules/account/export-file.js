const { AppError } = require('../../shared/result');

const UNAVAILABLE = '当前微信无法保存或发送文件。你可以在小程序里查看导出内容。';
const HANDOFF_FAILED = '微信未能交付文件。可尝试领取兼容文本，或在小程序里查看导出内容。';
const WRITE_FAILED = '文件保存失败。请检查存储空间，或在小程序里查看导出内容。';
let stagingSequence = 0;

function openNativeFile(platform, method, options) {
  return new Promise((resolve) => {
    try {
      platform[method]({
        ...options,
        success: () => resolve('success'),
        fail: (error) => resolve(/cancel/i.test(error?.errMsg || '') ? 'cancelled' : 'failed'),
      });
    } catch (_error) {
      resolve('failed');
    }
  });
}

function exportChannel(platform) {
  let device = '';
  try {
    device = (platform.getDeviceInfo?.() || platform.getSystemInfoSync?.())?.platform || '';
  } catch (_error) {
    // Fall back to the exposed methods if device information is unavailable.
  }
  if (['windows', 'mac'].includes(device)) {
    return typeof platform.saveFileToDisk === 'function' ? 'disk' : '';
  }
  if (
    !['ios', 'android', 'harmonyos'].includes(device) &&
    typeof platform.saveFileToDisk === 'function'
  ) {
    return 'disk';
  }
  return typeof platform.shareFileMessage === 'function' ? 'chat' : '';
}

async function deliverExportFile(platform, file, current, asText = false) {
  if (!current()) {
    return '';
  }
  const channel = exportChannel(platform);
  if (
    !channel ||
    !platform.env?.USER_DATA_PATH ||
    typeof platform.getFileSystemManager !== 'function'
  ) {
    throw new AppError('LOCAL_FILE_UNAVAILABLE', UNAVAILABLE);
  }
  const suffix = file.extension + (asText ? '.txt' : '');
  const path =
    platform.env.USER_DATA_PATH + '/MoodSky-' + Date.now() + '-' + ++stagingSequence + '.' + suffix;
  let fs;
  try {
    try {
      fs = platform.getFileSystemManager();
      await new Promise((resolve, reject) => {
        fs.writeFile({
          filePath: path,
          data: file.content,
          encoding: 'utf8',
          success: resolve,
          fail: reject,
        });
      });
    } catch (_error) {
      throw new AppError('LOCAL_FILE_ERROR', WRITE_FAILED);
    }
    if (!current()) {
      return '';
    }
    if (channel === 'disk') {
      const result = await openNativeFile(platform, 'saveFileToDisk', { filePath: path });
      if (result === 'success') {
        return '文件已保存到电脑。';
      }
      if (result === 'cancelled') {
        return '已取消保存，可重新领取文件。';
      }
    } else {
      const result = await openNativeFile(platform, 'shareFileMessage', {
        filePath: path,
        fileName: 'MoodSky.' + suffix,
      });
      if (result === 'success') {
        return '文件已发送。';
      }
      if (result === 'cancelled') {
        return '已取消发送，可重新领取文件。';
      }
    }
    throw new AppError('LOCAL_FILE_HANDOFF_FAILED', asText ? UNAVAILABLE : HANDOFF_FAILED);
  } finally {
    // The native callback has finished reading the staging file.
    try {
      fs?.unlink?.({ filePath: path, fail() {} });
    } catch (_error) {
      // Older platforms may not support deleting files through this API.
    }
  }
}

module.exports = { deliverExportFile, exportChannel };
