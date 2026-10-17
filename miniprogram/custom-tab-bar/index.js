Component({
  data: {
    selected: 0,
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
      if (!tab || index === this.data.selected) {
        return;
      }
      wx.switchTab({ url: tab.path, success: () => this.setData({ selected: index }) });
    },
  },
});
