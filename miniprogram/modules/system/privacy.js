function openPrivacyContract(platform) {
  const notice = (title) => platform.showToast({ title, icon: 'none' });
  if (typeof platform.openPrivacyContract !== 'function') {
    notice('请更新微信后查看隐私指引');
    return;
  }
  const fail = () => notice('暂时无法打开隐私指引，请稍后重试');
  try {
    platform.openPrivacyContract({ fail });
  } catch (_error) {
    fail();
  }
}
module.exports = { openPrivacyContract };
