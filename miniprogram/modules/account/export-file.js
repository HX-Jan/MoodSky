const { AppError } = require('../../shared/result');

const UNAVAILABLE = '当前微信无法交出文件。你可以在小程序里查看导出内容。';
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

async function deliverExportFile(platform, file, current) {
  if (!current()) {
    return '';
  }
  if (!platform.env?.USER_DATA_PATH || typeof platform.getFileSystemManager !== 'function') {
    throw new AppError('LOCAL_FILE_UNAVAILABLE', UNAVAILABLE);
  }
  const disk = typeof platform.saveFileToDisk === 'function';
  const share = typeof platform.shareFileMessage === 'function';
  if (!disk && !share) {
    throw new AppError('LOCAL_FILE_UNAVAILABLE', UNAVAILABLE);
  }
  const fileName =
    ['MoodSky', file.jobId, Date.now(), ++stagingSequence].join('-') + '.' + file.extension;
  const path = platform.env.USER_DATA_PATH + '/' + fileName;
  let fs;
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
  try {
    if (!current()) {
      return '';
    }
    if (disk) {
      const result = await openNativeFile(platform, 'saveFileToDisk', { filePath: path });
      if (result === 'success') {
        return '文件已保存到电脑。';
      }
      if (result === 'cancelled') {
        return '已取消保存，可重新领取文件。';
      }
    }
    if (share && current()) {
      const result = await openNativeFile(platform, 'shareFileMessage', {
        filePath: path,
        fileName: '天气记录.' + file.extension,
      });
      if (result === 'success') {
        return '文件已发送。';
      }
      if (result === 'cancelled') {
        return '已取消发送，可重新领取文件。';
      }
    }
    throw new AppError('LOCAL_FILE_UNAVAILABLE', UNAVAILABLE);
  } finally {
    // The native callback has finished reading the staging file.
    try {
      fs.unlink?.({ filePath: path, fail() {} });
    } catch (_error) {
      // Older platforms may not support deleting files through this API.
    }
  }
}

module.exports = { deliverExportFile };
