const { appRuntime, currentPages } = require('../../modules/system/runtime');
const { goHome } = require('../../modules/system/navigation');
const TABS = ['pages/today/index', 'pages/campus/index', 'pages/universe/index', 'pages/me/index'];
Component({
  properties: { hideHome: { type: Boolean, value: false } },
  data: { online: null, recovered: false, update: 'unsupported', homeEntry: false },
  lifetimes: {
    attached() {
      this._pageHidden = false;
      this._unsubscribe = appRuntime.subscribe((state) => this.setData(state));
      this.syncHomeEntry();
    },
    detached() {
      this._pageHidden = true;
      this._cancelHome?.();
      this._unsubscribe?.();
      this._untrackPage?.();
    },
  },
  pageLifetimes: {
    hide() {
      this._pageHidden = true;
      this._cancelHome?.();
    },
    show() {
      this._pageHidden = false;
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
      if (this._pageHidden) {
        return;
      }
      this._cancelHome = goHome(wx);
    },
    onUpdate() {
      appRuntime.applyUpdate();
    },
    onDismiss() {
      appRuntime.dismissRecovery();
    },
  },
});
