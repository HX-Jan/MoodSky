const pendingNotices = new WeakMap();
const visible = (page) =>
  !page._hidden && !page._disposed && !page.data?.shareSinglePage && !page._shareLoginRedirected;
function clearPrivacyNotice(page) {
  pendingNotices.delete(page);
}
function openPrivacyContract(platform, page) {
  if (page && !visible(page)) {
    return;
  }
  const operation = {};
  if (page) {
    pendingNotices.set(page, operation);
  }
  let notified = false;
  const notice = (title) => {
    if (notified || (page && (!visible(page) || pendingNotices.get(page) !== operation))) {
      return;
    }
    notified = true;
    platform.showToast({ title, icon: 'none' });
  };
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
module.exports = { openPrivacyContract, clearPrivacyNotice };
