/*
 * Loads the pinned CloudBase Web SDK bundle for the static admin prototype.
 * In demo mode no SDK URL is needed. In real mode config.js supplies sdkUrl;
 * the exact version stays an environment-owner decision instead of using
 * an unpinned "latest" URL.
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

  const loadLocalAdmin = () => load('auth.js').then(() => load('app.js'));

  (async () => {
    if (config.envId && config.sdkUrl && !root.cloudbase) {
      try {
        await load(config.sdkUrl);
      } catch (error) {
        // app.js will render a visible configuration error instead of silently
        // falling back to the synthetic demo.
        root.MOODSKY_ADMIN_SDK_LOAD_ERROR = error.message;
      }
    }
    await loadLocalAdmin();
  })().catch((error) => {
    const notice = doc.getElementById('loginNotice');
    if (notice) {
      notice.textContent = error.message || '后台脚本加载失败。';
      notice.className = 'notice notice--error';
    }
  });
})(globalThis);
