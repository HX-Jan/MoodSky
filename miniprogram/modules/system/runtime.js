function currentPages() {
  return typeof getCurrentPages === 'function' ? getCurrentPages() : [];
}
function workStatus(pages = currentPages()) {
  let draft = false;
  let pending = false;
  for (const page of pages) {
    const data = page.data || {};
    const journal = page._journal?.getState?.() || {};
    draft = draft || !!data.hasUnsavedChanges || !!journal.hasUnsavedChanges;
    pending =
      pending ||
      !!data.busy ||
      !!data.wechatLoginBusy ||
      !!data.pending ||
      !!data.pendingKind ||
      !!data.pendingRetry ||
      !!journal.pendingRetry ||
      !!data.retryPending ||
      ['saving', 'deleting'].includes(data.phase) ||
      ['saving', 'deleting'].includes(journal.phase);
  }
  return { draft, pending };
}
function createAppRuntime({ pages = currentPages } = {}) {
  let platform;
  let started = false;
  let networkRevision = 0;
  let manager;
  let confirming = false;
  let applying = false;
  let state = { online: null, recovered: false, update: 'unsupported' };
  const listeners = new Set();
  // Cached tab pages can hold drafts even when absent from getCurrentPages().
  const trackedPages = new Set();
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener({ ...state }));
  };
  const toast = (title) => platform?.showToast?.({ title, icon: 'none', duration: 3000 });
  const network = (online) => {
    publish({ online, recovered: online ? state.online === false || state.recovered : false });
  };
  const runtime = {
    trackPage(page) {
      trackedPages.add(page);
      return () => trackedPages.delete(page);
    },
    snapshot: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    start(wxPlatform) {
      if (started || !wxPlatform) {
        return;
      }
      started = true;
      platform = wxPlatform;
      platform.onNetworkStatusChange?.((result) => {
        networkRevision++;
        network(result.isConnected);
      });
      runtime.refreshNetwork();
      if (typeof platform.getUpdateManager === 'function') {
        try {
          manager = platform.getUpdateManager();
          publish({ update: 'checking' });
          manager.onCheckForUpdate((result) => {
            if (!['ready', 'failed'].includes(state.update)) {
              publish({ update: result.hasUpdate ? 'downloading' : 'current' });
            }
          });
          manager.onUpdateReady(() => publish({ update: 'ready' }));
          manager.onUpdateFailed(() => publish({ update: 'failed' }));
        } catch (_error) {
          publish({ update: 'unsupported' });
        }
      }
    },
    refreshNetwork() {
      const revision = ++networkRevision;
      platform?.getNetworkType?.({
        success(result) {
          if (revision === networkRevision) {
            network(result.networkType !== 'none');
          }
        },
        fail() {},
      });
    },
    dismissRecovery() {
      publish({ recovered: false });
    },
    showUpdateStatus() {
      if (state.update === 'ready') {
        return runtime.applyUpdate();
      }
      const messages = {
        unsupported: '请升级微信后重试',
        checking: '微信正在检查更新，请稍后再查看',
        current: '微信本次启动检查：暂无新版本',
        downloading: '新版本正在下载，完成后会提示',
        failed: '新版本下载失败，请检查网络后重新进入小程序',
      };
      toast(messages[state.update]);
    },
    applyUpdate() {
      if (state.update !== 'ready' || confirming || applying) {
        return;
      }
      const check = () => {
        const work = workStatus([...new Set([...pages(), ...trackedPages])]);
        if (work.pending || work.draft) {
          toast(work.pending ? '请先完成或重试当前操作，再更新' : '请先保存正在编辑的内容，再更新');
          return false;
        }
        return true;
      };
      if (!check()) {
        return;
      }
      confirming = true;
      platform.showModal({
        title: '新版本已准备好',
        content: '更新会重新打开小程序，现在更新吗？',
        confirmText: '立即更新',
        cancelText: '稍后',
        success(result) {
          if (result.confirm && check()) {
            applying = true;
            try {
              manager.applyUpdate();
            } catch (_error) {
              applying = false;
              toast('暂时无法更新，请稍后重新进入小程序');
            }
          }
        },
        complete() {
          confirming = false;
        },
      });
    },
  };
  return runtime;
}
const appRuntime = createAppRuntime();
module.exports = { createAppRuntime, appRuntime, workStatus, currentPages };
