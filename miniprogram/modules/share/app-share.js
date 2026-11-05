const { isBusinessDate } = require('../../shared/date');
const { cloudSessionState } = require('../../services/session-state');
const { hasRememberedLogin } = require('../account/login-memory');
const IMAGE = '/assets/jiaqi/PARTLY_CLOUDY.png';
const HOME = 'pages/today/index';
const PAGES = Object.freeze({
  'pages/today/index': [
    '今天的天气',
    '用七种天气表达此刻的感受，可以写下标签和几句话，保存到自己的私人账号。',
  ],
  'pages/record/index': [
    '天气记录',
    '选择日期记录天气，支持保存、修改和删除。天气、标签与正文仅记录者本人可见。',
  ],
  'pages/campus/index': [
    '校园地点',
    '浏览福州大学校园推荐地点，到达后可手动完成打卡。打卡记录仅本人可见。',
  ],
  'pages/universe/index': [
    '天气宇宙',
    '用月历回顾自己的天气，按月份整理记录，并查看天气分布与时间线。',
  ],
  'pages/me/index': ['我的', '管理自己的微信账号、头像昵称和私人数据，可申请导出或注销账号。'],
  'pages/review/archive/index': [
    '月份档案',
    '按月份整理自己的天气记录。档案卡片默认隐藏正文，记录只向本人展示。',
  ],
  'pages/review/month/index': [
    '月份回顾',
    '查看选定月份的天气卡片与记录详情。分享此页面不会公开记录者的私人内容。',
  ],
  'pages/review/detail/index': [
    '记录详情',
    '查看本人选定日期的天气、标签与正文。每位使用者只能读取自己账号的记录。',
  ],
  'pages/review/insights/index': [
    '天气回顾',
    '按7天、30天或90天回顾自己的记录。没有记录的日期保持留白。',
  ],
  'pages/tasks/index': [
    '轻任务',
    '浏览轻任务建议，按自己的节奏选择、完成或跳过。任务历史属于自己的账号。',
  ],
  'pages/account/index': ['账号与数据', '导出自己的记录和个人资料，或注销账号并查看数据清理进度。'],
  'pages/login/index': [
    '微信登录',
    '使用微信进入本人账号，头像和昵称可选填。每位使用者拥有独立的私人记录。',
  ],
  'pages/profile/index': [
    '个人资料',
    '选择自己的头像和昵称，用于个人中心展示。个人资料随本人账号保存和管理。',
  ],
});
const PRIVATE = new Set([
  'pages/record/index',
  'pages/universe/index',
  'pages/me/index',
  'pages/review/archive/index',
  'pages/review/month/index',
  'pages/review/detail/index',
  'pages/review/insights/index',
  'pages/account/index',
  'pages/profile/index',
]);
function routeName(route) {
  const value = typeof route === 'string' ? route.replace(/^\//, '') : '';
  if (!Object.prototype.hasOwnProperty.call(PAGES, value)) {
    throw new TypeError('Unknown share page.');
  }
  return value;
}
function validMonth(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isBusinessDate(value + '-01');
}
function first(values, valid) {
  return values.find(valid);
}
function shareQuery(route, page = {}) {
  const data = page.data || {},
    options = page._shareOptions || page.options || page._query || {};
  const query = { fromShare: 'page' };
  if (['pages/today/index', 'pages/record/index', 'pages/review/detail/index'].includes(route)) {
    const date = first(
      [data.date, data.dateLabel, options.date, page._query?.date],
      isBusinessDate,
    );
    if (date) {
      query.date = date;
    }
  }
  if (
    ['pages/universe/index', 'pages/review/month/index', 'pages/review/archive/index'].includes(
      route,
    )
  ) {
    const month = first(
      [data.month, page._currentMonth, page._month, data.selectedMonth, options.month],
      validMonth,
    );
    if (month) {
      query.month = month;
    }
  }
  if (route === 'pages/review/insights/index') {
    const days = first([data.windowDays, Number(options.days)], (value) =>
      [7, 30, 90].includes(value),
    );
    if (days) {
      query.days = String(days);
    }
  }
  if (route === 'pages/tasks/index') {
    query.view = (data.view || options.view) === 'history' ? 'history' : 'suggestions';
  }
  return Object.entries(query)
    .map(([key, value]) => key + '=' + encodeURIComponent(value))
    .join('&');
}
function shareTarget(route, page) {
  const name = routeName(route),
    query = shareQuery(name, page);
  return {
    title: '校园情绪天气 · ' + PAGES[name][0],
    path: '/' + name + '?' + query,
    query,
    imageUrl: IMAGE,
  };
}
function createAppShare({ route = HOME } = {}) {
  const name = routeName(route);
  return {
    onShareAppMessage() {
      const { title, path, imageUrl } = shareTarget(name, this);
      return { title, path, imageUrl };
    },
    onShareTimeline() {
      const { title, query, imageUrl } = shareTarget(name, this);
      return { title, query, imageUrl };
    },
  };
}
function isTimelinePreview(platform) {
  try {
    return (
      (platform?.getEnterOptionsSync?.() || platform?.getLaunchOptionsSync?.())?.scene === 1154
    );
  } catch {
    return false;
  }
}
function enableAppShare(platform) {
  if (!platform || typeof platform.showShareMenu !== 'function' || isTimelinePreview(platform)) {
    return;
  }
  try {
    platform.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'], fail() {} });
  } catch (_error) {
    /* Normal page actions remain usable on older clients. */
  }
}
function parseShareReturn(value) {
  if (typeof value !== 'string' || value.length > 512) {
    return '';
  }
  try {
    const [path, query = '', extra] = value.split('?');
    if (extra !== undefined) {
      return '';
    }
    const route = routeName(path);
    if (route === 'pages/login/index') {
      return '';
    }
    const options = {},
      seen = new Set();
    for (const pair of query.split('&').filter(Boolean)) {
      const [key, val = ''] = pair.split('=');
      const name = decodeURIComponent(key);
      if (seen.has(name)) {
        return '';
      }
      seen.add(name);
      options[name] = decodeURIComponent(val);
    }
    return shareTarget(route, { options }).path;
  } catch {
    return '';
  }
}
function prepareSharedPage(page, platform, config, route, options = {}) {
  const name = routeName(route);
  page._shareOptions = options;
  if (isTimelinePreview(platform)) {
    page.setData({
      shareSinglePage: true,
      sharePageTitle: PAGES[name][0],
      sharePageDescription: PAGES[name][1],
    });
    return true;
  }
  const needsLogin =
    PRIVATE.has(name) || (name === 'pages/tasks/index' && options.view === 'history');
  if (
    config?.explicitWechatLogin === true &&
    options.fromShare === 'page' &&
    needsLogin &&
    !cloudSessionState.capture() &&
    !hasRememberedLogin(platform) &&
    typeof platform?.redirectTo === 'function'
  ) {
    page._shareLoginRedirected = true;
    platform.redirectTo({
      url: '/pages/login/index?returnTo=' + encodeURIComponent(shareTarget(name, { options }).path),
    });
    return true;
  }
  return false;
}
module.exports = {
  createAppShare,
  enableAppShare,
  prepareSharedPage,
  isTimelinePreview,
  parseShareReturn,
  shareTarget,
};
