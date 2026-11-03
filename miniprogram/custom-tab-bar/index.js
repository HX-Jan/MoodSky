Component({
  data: {
    selected: 0,
    switching: false,
    tabs: [
      { path: '/pages/today/index', label: '今天', icon: 'sun' },
      { path: '/pages/campus/index', label: '校园', icon: 'location' },
      { path: '/pages/universe/index', label: '天气宇宙', icon: 'universe' },
      { path: '/pages/me/index', label: '我的', icon: 'user' },
    ],
  },
  methods: {
    onSelect(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || !Number.isInteger(index) || index === this.data.selected || this.data.switching) {
        return;
      }
      this.setData({ switching: true });
      const token = {};
      this._switchToken = token;
      const release = () => {
        if (this._switchToken === token) {
          this._switchToken = null;
          this.setData({ switching: false });
        }
      };
      const fail = () => {
        if (this._switchToken === token) {
          release();
          wx.showToast?.({ title: '切换失败，请再试一次', icon: 'none' });
        }
      };
      try {
        wx.switchTab({
          url: tab.path,
          success: () => {
            if (this._switchToken === token) {
              this.setData({ selected: index });
              release();
            }
          },
          fail,
          complete: release,
        });
      } catch (_error) {
        fail();
      }
    },
  },
  lifetimes: {
    detached() {
      this._switchToken = null;
    },
  },
});
