// Only return fixed messages and a bounded numeric platform error code. Never
// display, persist or log the native callback (which can contain credentials).
function phoneAuthorizationNotice(detail = {}) {
  const message = typeof detail.errMsg === 'string' ? detail.errMsg : '';
  let notice;
  if (/privacy|隐私/i.test(message)) {
    notice =
      '微信隐私授权未完成，请查看隐私保护指引；若仍失败，请联系管理员核对手机号用途声明是否生效。';
  } else if (/^getPhoneNumber:fail\s+(?:user deny|user cancel|cancel)\s*$/i.test(message)) {
    return '你取消了手机号授权，可以稍后再次登录。';
  } else if (
    /no permission|permission denied|access denied|unauthorized|not authorized/i.test(message)
  ) {
    notice = '微信未允许此小程序获取手机号，请联系管理员核对主体认证、手机号接口权限及开通状态。';
  } else if (/quota|limit exceeded|余额|额度/i.test(message)) {
    notice = '小程序的手机号验证额度暂不可用，请联系管理员检查额度后重试。';
  } else if (/network|timeout|time out|网络/i.test(message)) {
    notice = '微信手机号授权连接失败，请检查网络后重试。';
  } else if (/not support|unsupported|not available/i.test(message) || detail.encryptedData) {
    notice = '当前微信未提供新版手机号授权码，请更新微信后重试。';
  } else {
    notice = '微信未返回手机号授权码，请重试；若仍失败，请联系管理员核对手机号接口和隐私配置。';
  }
  return Number.isInteger(detail.errno) && Math.abs(detail.errno) <= 9999999
    ? `${notice}（微信错误码：${detail.errno}）`
    : notice;
}

module.exports = { phoneAuthorizationNotice };
