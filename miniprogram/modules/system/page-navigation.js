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
function navigateOnce(page, platform, url, method = 'navigateTo') {
  if (navigation.has(page)) {
    return false;
  }
  const operation = {};
  navigation.set(page, operation);
  const fail = () => {
    if (navigation.get(page) === operation) {
      navigation.delete(page);
      platform.showToast?.({ title: '暂时无法打开，请再试一次', icon: 'none' });
    }
  };
  try {
    platform[method]({ url, fail });
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
