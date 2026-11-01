const TITLE = 'MoodSky · 用天气记下今天的感受';
const HOME = '/pages/today/index';
const IMAGE = '/assets/jiaqi/PARTLY_CLOUDY.png';

function createAppShare({ timeline = false } = {}) {
  return {
    // Always share the app, never the current private page or its screenshot.
    onShareAppMessage() {
      return { title: TITLE, path: HOME, imageUrl: IMAGE };
    },
    ...(timeline
      ? {
          // Timeline keeps the current route, so enable it only on the home page.
          onShareTimeline() {
            return { title: TITLE, query: '', imageUrl: IMAGE };
          },
        }
      : {}),
  };
}

function enableAppShare(platform, { timeline = false } = {}) {
  if (!platform || typeof platform.showShareMenu !== 'function') {
    return;
  }
  try {
    if (!timeline && typeof platform.hideShareMenu === 'function') {
      platform.hideShareMenu({ menus: ['shareTimeline'], fail() {} });
    }
    platform.showShareMenu({
      menus: timeline ? ['shareAppMessage', 'shareTimeline'] : ['shareAppMessage'],
      fail() {},
    });
  } catch (_error) {
    // Older clients may lack a sharing menu; normal page actions still work.
  }
}

module.exports = { createAppShare, enableAppShare };
