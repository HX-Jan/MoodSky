const environment = require('./config/environment.local');
const { APP_NAME } = require('./shared/constants');
const { appRuntime } = require('./modules/system/runtime');

App({
  globalData: { appName: APP_NAME, cloudReady: false },
  onLaunch(options = {}) {
    this._timelinePreview = options.scene === 1154;
    if (options.scene === 1154) {
      return;
    }
    this.startNormalServices();
  },
  startNormalServices() {
    appRuntime.start(wx);
    if (
      !this.globalData.cloudReady &&
      environment &&
      environment.cloudEnabled === true &&
      typeof environment.cloudEnvId === 'string' &&
      environment.cloudEnvId.trim() &&
      wx.cloud &&
      typeof wx.cloud.init === 'function'
    ) {
      try {
        wx.cloud.init({ env: environment.cloudEnvId, traceUser: false });
        this.globalData.cloudReady = true;
      } catch (_error) {
        this.globalData.cloudReady = false;
      }
    }
  },
  onShow(options = {}) {
    this._timelinePreview = options.scene === 1154;
    if (options.scene !== 1154) {
      this.startNormalServices();
      appRuntime.refreshNetwork();
    }
  },
  onPageNotFound() {
    if (!this._timelinePreview) {
      wx.switchTab({ url: '/pages/today/index' });
    }
  },
});
