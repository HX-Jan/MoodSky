const { AppError } = require('../../shared/result');
const { createRequest } = require('../../services/api');

// Reuse a short-lived server decision ticket, never a consumed phone code.
// No account association or re-registration happens without confirmation.
function createPhoneSignIn({ call, platform, isCurrent, isAgreed }) {
  const check = () => {
    if (!isCurrent() || !isAgreed()) {
      throw new AppError('UNAUTHENTICATED', '登录已取消，请重新登录。');
    }
  };
  return async (code) => {
    check();
    const result = await call(createRequest('account.phoneLogin', { mode: 'login', code }));
    check();
    const data = result?.data;
    if (!data?.nextStep) {
      return result;
    }
    if (
      !['link', 'register'].includes(data.nextStep) ||
      typeof data.phoneTicket !== 'string' ||
      !data.phoneTicket ||
      data.phoneTicket.length > 2048 ||
      !/^1[3-9]\d\*{4}\d{4}$/.test(data.phoneLabel)
    ) {
      throw new AppError('INVALID_RESPONSE', '登录服务响应不兼容，请稍后重试。');
    }
    const registering = data.nextStep === 'register';
    const confirmed = await new Promise((resolve) => {
      if (typeof platform.showModal !== 'function') {
        resolve(false);
        return;
      }
      platform.showModal({
        title: registering ? '重新注册' : '关联现有记录',
        content: registering
          ? `手机号 ${data.phoneLabel} 对应的账号已注销。是否创建全新的空账号？原有记录和导出不会恢复。`
          : `是否将此微信已有的账号与 ${data.phoneLabel} 关联？确认后可用该手机号登录并访问原有记录。`,
        confirmText: registering ? '重新注册' : '关联并登录',
        cancelText: '取消',
        success: (value) => resolve(value.confirm === true),
        fail: () => resolve(false),
      });
    }).catch(() => false);
    check();
    if (!confirmed) {
      throw new AppError('UNAUTHENTICATED', '已取消登录，未更改账号。');
    }
    const confirmedResult = await call(
      createRequest('account.phoneLogin', {
        mode: data.nextStep,
        ticket: data.phoneTicket,
        confirm: registering ? 'REGISTER' : 'LINK',
      }),
    );
    check();
    return confirmedResult;
  };
}
module.exports = { createPhoneSignIn };
