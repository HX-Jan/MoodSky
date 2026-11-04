// Keep a successful navigation locked until the source page is shown again.
// Releasing at navigateTo.complete would allow a queued second tap to push twice.
const navigation = new WeakMap();
function resetPageNavigation(page) {
  navigation.delete(page);
}
function pausePageNavigation(page) {
  navigation.set(page, { paused: true });
}
function isPageNavigationBlocked(page) {
  return navigation.has(page);
}
function navigateOnce(page, platform, url, method = 'navigateTo', fallbackUrl) {
  if (navigation.has(page)) {
    return false;
  }
  const operation = {};
  navigation.set(page, operation);
  const failed = () => {
    if (navigation.get(page) === operation) {
      navigation.delete(page);
      platform.showToast?.({
        title: fallbackUrl ? '暂时无法返回，请再试一次' : '暂时无法打开，请再试一次',
        icon: 'none',
      });
    }
  };
  const fail = () => {
    if (navigation.get(page) !== operation) {
      return;
    }
    if (!fallbackUrl) {
      failed();
      return;
    }
    if (operation.fallingBack) {
      return;
    }
    operation.fallingBack = true;
    try {
      platform.switchTab({ url: fallbackUrl, fail: failed });
    } catch (_error) {
      failed();
    }
  };
  try {
    platform[method]({ ...(url === undefined ? {} : { url }), fail });
  } catch (_error) {
    fail();
  }
  return true;
}
module.exports = {
  navigateOnce,
  resetPageNavigation,
  pausePageNavigation,
  isPageNavigationBlocked,
};
