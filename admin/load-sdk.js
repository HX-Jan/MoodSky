/*
 * Loads the pinned CloudBase Web SDK bundle for the static admin prototype.
 * In demo mode no SDK URL is needed. In real mode config.js supplies sdkUrl;
 * the configured version is pinned to the reviewed package dependency;
 * the generated local bundle avoids an unpinned "latest" URL.
 */
(function loadAdminScripts(root) {
  const doc = root.document;
  if (!doc) {
    return;
  }

  const config = root.MOODSKY_ADMIN_CONFIG || {};
  const load = (src) =>
    new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('无法加载脚本：' + src));
      doc.head.appendChild(script);
    });

  const loadLocalAdmin = async () => {
    await load('auth.js');
    if (doc.body && doc.body.dataset.console === 'places') {
      await load('session-boundary.js');
      await load('places.js');
      await load('places-app.js');
    } else {
      await load('app.js');
    }
  };

  (async () => {
    if (config.envId && config.sdkUrl && !root.cloudbase) {
      try {
        await load(config.sdkUrl);
      } catch (_error) {
        // app.js will render a visible configuration error instead of silently
        // falling back to the synthetic demo.
        root.MOODSKY_ADMIN_SDK_LOAD_ERROR = 'SDK_LOAD_FAILED';
      }
    }
    await loadLocalAdmin();
  })().catch((_error) => {
    const notice = doc.getElementById('loginNotice');
    if (notice) {
      notice.textContent = '后台脚本加载失败，请核对本地配置。';
      notice.className = 'notice notice--error';
    }
  });
})(globalThis);
