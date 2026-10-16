const { APP_VERSION, DEFAULT_PREFERENCES } = require('../../shared/constants');
Page({
  data: { version: APP_VERSION, preferences: DEFAULT_PREFERENCES },
  onTasks() {
    wx.navigateTo({ url: '/pages/tasks/index' });
  },
});
