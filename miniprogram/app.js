const environment = require('./config/environment.local');
const { APP_NAME } = require('./shared/constants');

App({
  globalData: { appName: APP_NAME, cloudReady: false },
  onLaunch() {
    if (
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
});
