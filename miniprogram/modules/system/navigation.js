const { workStatus, currentPages } = require('./runtime');
const { cloudSessionState } = require('../../services/session-state');
const HOME = '/pages/today/index';
const homeRequests = new WeakMap();
function goHome(platform, pages = currentPages) {
  const stack = pages();
  const source = stack[stack.length - 1];
  const key = source || platform;
  if (homeRequests.has(key)) {
    return homeRequests.get(key).cancel;
  }
  const generation = cloudSessionState.getGeneration();
  const operation = { navigating: false };
  const cancel = () => {
    if (homeRequests.get(key) === operation) {
      homeRequests.delete(key);
    }
  };
  operation.cancel = cancel;
  homeRequests.set(key, operation);
  const active = () => {
    const latest = pages();
    return (
      homeRequests.get(key) === operation &&
      latest[latest.length - 1] === source &&
      !source?._hidden &&
      !source?._disposed &&
      generation === cloudSessionState.getGeneration()
    );
  };
  const notice = (title) => platform.showToast({ title, icon: 'none' });
  const failed = (title) => {
    const visible = active();
    cancel();
    if (visible) {
      notice(title);
    }
  };
  const leave = () => {
    if (!active()) {
      cancel();
      return;
    }
    if (workStatus(pages()).pending) {
      cancel();
      notice('请先完成或重试当前操作');
      return;
    }
    operation.navigating = true;
    const fail = () => failed('暂时无法返回首页，请稍后重试');
    try {
      platform.switchTab({ url: HOME, fail, complete: cancel });
    } catch (_error) {
      fail();
    }
  };
  if (!active()) {
    cancel();
    return cancel;
  }
  const work = workStatus(stack);
  if (work.pending) {
    cancel();
    notice('请先完成或重试当前操作');
  } else if (work.draft) {
    const fail = () => {
      if (!operation.navigating) {
        failed('暂时无法确认返回，请再试一次');
      }
    };
    try {
      platform.showModal({
        title: '内容尚未保存',
        content: '返回首页将放弃本页未保存的修改，确定返回吗？',
        confirmText: '放弃修改',
        cancelText: '继续编辑',
        success: (result) => {
          if (operation.navigating) {
            return;
          }
          if (result.confirm) {
            leave();
          } else {
            cancel();
          }
        },
        fail,
        complete: () => {
          if (!operation.navigating) {
            cancel();
          }
        },
      });
    } catch (_error) {
      fail();
    }
  } else {
    leave();
  }
  return cancel;
}
function backOrHome(platform) {
  platform.navigateBack({ fail: () => platform.switchTab({ url: HOME }) });
}
module.exports = { goHome, backOrHome };
