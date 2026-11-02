const { appRuntime, currentPages } = require('../../modules/system/runtime');
const { goHome } = require('../../modules/system/navigation');
const TABS = ['pages/today/index', 'pages/campus/index', 'pages/universe/index', 'pages/me/index'];
Component({
  data: { online: null, recovered: false, update: 'unsupported', homeEntry: false },
  lifetimes: {
    attached() {
      this._unsubscribe = appRuntime.subscribe((state) => this.setData(state));
      this.syncHomeEntry();
    },
    detached() {
      this._unsubscribe?.();
      this._untrackPage?.();
    },
  },
  pageLifetimes: {
    show() {
      this.syncHomeEntry();
    },
  },
  methods: {
    syncHomeEntry() {
      const pages = currentPages();
      const page = pages[pages.length - 1];
      if (page && page !== this._trackedPage) {
        this._untrackPage?.();
        this._trackedPage = page;
        this._untrackPage = appRuntime.trackPage(page);
      }
      this.setData({ homeEntry: pages.length === 1 && !TABS.includes(pages[0].route) });
    },
    onHome() {
      goHome(wx);
    },
    onUpdate() {
      appRuntime.applyUpdate();
    },
    onDismiss() {
      appRuntime.dismissRecovery();
    },
  },
});
