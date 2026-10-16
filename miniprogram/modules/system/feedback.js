const STATES = {
  loading: { symbol: '◌', title: '正在收集云朵', message: '请稍候，内容马上就好。', action: '' },
  empty: {
    symbol: '☁',
    title: '这里还是一片晴空',
    message: '还没有内容，之后再来看看。',
    action: '',
  },
  network: {
    symbol: '☂',
    title: '连接暂时下起了雨',
    message: '请检查网络，再试一次。',
    action: '重试',
  },
  unauthenticated: {
    symbol: '♡',
    title: '先认识一下你',
    message: '登录后才能查看自己的天空。',
    action: '去登录',
  },
  disabled: {
    symbol: '☾',
    title: '账号暂不可用',
    message: '请联系项目管理员了解账号状态。',
    action: '',
  },
  notImplemented: {
    symbol: '✦',
    title: '这片天空正在建设',
    message: '功能还在准备中，完成后就能使用。',
    action: '',
  },
};
function feedbackFor(state) {
  return STATES[state] || STATES.empty;
}
module.exports = { STATES, feedbackFor };
