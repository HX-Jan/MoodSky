const { workStatus, currentPages } = require('./runtime');
const HOME = '/pages/today/index';
function goHome(platform, pages = currentPages) {
  const notice = (title) => platform.showToast({ title, icon: 'none' });
  const leave = () => {
    if (workStatus(pages()).pending) {
      notice('请先完成或重试当前操作');
      return;
    }
    platform.switchTab({ url: HOME, fail: () => notice('暂时无法返回首页，请稍后重试') });
  };
  const work = workStatus(pages());
  if (work.pending) {
    notice('请先完成或重试当前操作');
  } else if (work.draft) {
    platform.showModal({
      title: '内容尚未保存',
      content: '返回首页将放弃本页未保存的修改，确定返回吗？',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      success: (result) => {
        if (result.confirm) {
          leave();
        }
      },
    });
  } else {
    leave();
  }
}
function backOrHome(platform) {
  platform.navigateBack({ fail: () => platform.switchTab({ url: HOME }) });
}
module.exports = { goHome, backOrHome };
