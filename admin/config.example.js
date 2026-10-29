// Copy this file to config.js for a real CloudBase validation run.
// Keep config.js, access keys and callback-domain details out of Git.
globalThis.MOODSKY_ADMIN_CONFIG = {
  envId: '',
  region: 'ap-shanghai',
  provider: 'wechat',
  publishableKey: '', // Only a platform Publishable Key; never a secret access key.
  redirectTo: '',
  // Use an approved, version-pinned @cloudbase/js-sdk browser bundle URL.
  sdkUrl: 'vendor/cloudbase-3.4.8.js',
  sdkVersion: '3.4.8',
  // Enable only after the target Web identity mapping and server role gate are verified.
  placeMaintenanceEnabled: false,
};
