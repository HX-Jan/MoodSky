/* global document, window */
'use strict';

const WEATHER = Object.freeze([
  { code: 'SUNNY', label: '晴天' },
  { code: 'PARTLY_CLOUDY', label: '多云' },
  { code: 'CLOUDY', label: '阴天' },
  { code: 'RAINY', label: '小雨' },
  { code: 'STORMY', label: '风雨' },
]);
const BASE_DATE = '2026-10-17';
const screen = document.querySelector('#screen');
const tabbar = document.querySelector('#tabbar');
const dialog = document.querySelector('#discard-dialog');
const makeState = () => ({
  page: 'today',
  mode: 'demo',
  date: BASE_DATE,
  weather: '',
  text: '',
  tags: [],
  dirty: false,
  entry: null,
  selectedRecord: null,
  notice: '',
  noticeType: 'info',
  phase: 'idle',
  pending: null,
  requestCounter: 0,
  retryIds: [],
  forceUncertain: false,
  month: '2026-10',
  reviewState: 'ready',
  taskState: '',
  preferences: { decorations: true, cardText: false },
  records: [
    { date: '2026-10-04', weather: 'SUNNY', text: '', tags: [] },
    { date: '2026-10-08', weather: 'CLOUDY', text: '', tags: [] },
  ],
});
let state = makeState();
let pendingNavigation = null;
const escapeText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const weatherLabel = (code) => WEATHER.find((weather) => weather.code === code)?.label || '未选择';
const icon = (code, size = '') =>
  `<img ${size ? `style="width:${size}px;height:${size}px"` : ''} src="../assets/weather/${code}.svg" alt="" />`;
const button = (action, text, cls = 'primary', disabled = false) =>
  `<button class="${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
const modeBanner = () =>
  `<div class="mode-banner">${state.mode === 'demo' ? '本地演示 · 合成数据，不写入云端' : '服务未接入 · 不会保存或导出真实数据'}</div>`;
const feedback = () =>
  state.notice
    ? `<div class="feedback ${state.noticeType === 'error' ? 'danger' : ''}" role="status">${escapeText(state.notice)}</div>`
    : '';
const entryLink = (action, symbol, title, caption) =>
  `<button class="entry-link" data-action="${action}"><span class="entry-icon" aria-hidden="true">${symbol}</span><span>${title}<small>${caption}</small></span><span class="arrow" aria-hidden="true">›</span></button>`;
const backHeading = (title, target = 'today') =>
  `<div class="back-row"><button class="icon-button" aria-label="返回" data-action="nav:${target}">‹</button><h2>${title}</h2></div>`;
const isEditing = () => state.page === 'today' || state.page === 'record';
const locked = () => state.phase === 'uncertain';
const announce = (message) => {
  document.querySelector('#live-region').textContent = message;
};

function weatherChoices() {
  return `<div class="weather-grid" role="group" aria-label="必选一种天气">${WEATHER.map((weather) => `<button class="weather-choice" data-action="weather:${weather.code}" aria-pressed="${state.weather === weather.code}" ${locked() ? 'disabled' : ''}>${icon(weather.code)}<span>${weather.label}</span></button>`).join('')}</div>`;
}

function saveControls() {
  const caption = locked()
    ? '保存结果未知，请重试原操作'
    : !state.weather
      ? '先选一种天气'
      : state.mode === 'demo'
        ? '保存到本次演示'
        : '尝试保存（服务未接入）';
  return `${button('save', caption, 'primary', !state.weather || locked() || Array.from(state.text).length > 1000)}${feedback()}${locked() ? `${button('retry-save', '重试原操作', 'secondary')}<p class="caption">输入暂时锁定。重试沿用原请求和原输入，不另建一条记录。</p>` : ''}`;
}

function todayPage() {
  const top = `<h2 class="page-title">今天，是什么天气？</h2><div class="date-row"><span>${state.date} · ${state.date === BASE_DATE ? '基线演示日' : '历史日期'}</span><div class="date-controls"><button class="icon-button" data-action="previous-date" aria-label="前一天" ${locked() ? 'disabled' : ''}>‹</button><button class="icon-button" data-action="today-date" aria-label="回到基线演示日" ${locked() ? 'disabled' : ''}>↶</button></div></div><div class="kind-note"><span>每一种天气，都可以在这里停留。</span>${icon('PARTLY_CLOUDY')}</div>${modeBanner()}`;
  if (state.entry && state.mode === 'demo') {
    return `${top}<div class="card"><div class="privacy-row"><span>⌑ 仅自己可见</span><span>每天一条</span></div><div class="saved-weather">${icon(state.entry.weather)}<span>${weatherLabel(state.entry.weather)}</span></div><p class="caption">已保存在本次演示，刷新后清除。<br />正文默认隐藏，进入私人记录后查看。</p>${button('open-entry', '查看私人记录', 'secondary')}</div>${feedback()}${entryLink('edit-entry', '↗', '修改这条记录', '保留日期，编辑天气与选填内容')}${entryLink('nav:tasks', '↟', '此刻，我想要…', '找个角落，或做件很小的事')}`;
  }
  return `${top}<div class="card"><div class="privacy-row"><span>⌑ 仅自己可见</span><span>每天一条</span></div><h3 class="weather-prompt">选一种最贴近此刻的天气</h3>${weatherChoices()}<p class="caption">天气必选，文字和标签都可留白。<br />天气没有好坏，按你的感受选择。</p>${saveControls()}</div>${entryLink('nav:record', '✎', '想写几句？', '文字和标签都可留白')}${entryLink('nav:tasks', '↟', '此刻，我想要…', '任务自愿，无需先保存记录')}`;
}

function recordPage() {
  const tags = ['课业', '休息', '运动', '社交', '独处', '期待', '疲惫', '平静'];
  return `${backHeading('私人天气记录')}${modeBanner()}<div class="kind-note">⌑ 仅自己可见 · 不公开、不评分</div><div class="card"><div class="section-heading"><b>天气（必选）</b><span class="muted">${state.date}</span></div>${weatherChoices()}<div class="field-label"><span>标签（选填）</span><span class="muted">${state.tags.length}/5</span></div><div class="tag-grid">${tags.map((tag) => `<button data-action="tag:${tag}" aria-pressed="${state.tags.includes(tag)}" ${locked() ? 'disabled' : ''}>${tag}</button>`).join('')}</div><label class="field-label" for="journal-text"><span>写一点，也可以留白</span><span id="text-counter" class="muted">${Array.from(state.text).length}/1000</span></label><textarea id="journal-text" placeholder="今天有什么想留给自己的？不写也可以。" ${locked() ? 'disabled' : ''}>${escapeText(state.text)}</textarea><p class="caption">字数按 Unicode 字符计算；仅用于合成演示，请勿输入真实日记。</p>${saveControls()}</div>`;
}

function universePage() {
  const matching = state.records.filter((record) => record.date.startsWith(state.month));
  const [year, month] = state.month.split('-').map(Number);
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  let calendar = '<span></span>'.repeat(firstWeekday);
  for (let day = 1; day <= days; day += 1) {
    const date = `${state.month}-${String(day).padStart(2, '0')}`;
    const entry = matching.find((record) => record.date === date);
    calendar += `<button class="day ${entry ? 'recorded' : ''}" ${entry ? `data-action="detail:${date}"` : 'disabled'} aria-label="${date}，${entry ? weatherLabel(entry.weather) + '，已记录' : '未记录'}">${day}${entry ? icon(entry.weather) : ''}</button>`;
  }
  let content;
  if (state.mode === 'unavailable') {
    content =
      '<div class="card empty-state"><h3>回顾服务尚未连接</h3><p>不会把未接入当作“没有记录”，也不会补出模拟记录。</p></div>';
  } else if (state.reviewState === 'error') {
    content = `<div class="card"><div class="feedback danger"><b class="feedback-title">读取失败（检查情境）</b>未把失败当作空月份。保留当前月份，请重试。</div>${button('review-retry', '重新读取', 'secondary')}</div>`;
  } else {
    content = `<div class="card"><div class="calendar-grid">${['一', '二', '三', '四', '五', '六', '日'].map((day) => `<span class="weekday">${day}</span>`).join('')}${calendar}</div><p class="calendar-hint">本月 ${matching.length} 条合成记录。只标记有记录的日期，不补天气。</p></div><div class="card"><h3 class="weather-prompt">天气卡 · 等价文字入口</h3>${matching.length ? matching.map((entry) => `<button class="list-record" data-action="detail:${entry.date}">${icon(entry.weather)}<span>${entry.date}<br /><small>${weatherLabel(entry.weather)} · 正文默认隐藏</small></span></button>`).join('') : '<div class="empty-state">这个月还没有记录。<br />空白也可以保留。</div>'}</div>`;
  }
  return `<h2 class="page-title">我的天气宇宙</h2><p class="page-subtitle">把走过的天气，收进自己的小宇宙。</p>${modeBanner()}<div class="calendar-heading"><button class="icon-button" data-action="month:previous" aria-label="上一个月">‹</button><span>${year} 年 ${month} 月</span><button class="icon-button" data-action="month:next" aria-label="下一个月">›</button></div><div class="privacy-row"><span>⌑ 仅自己可见</span><span>不与校园天气关联</span></div>${content}`;
}

function detailPage() {
  if (state.mode === 'unavailable') {
    return `${backHeading('私人记录', 'universe')}${modeBanner()}<div class="card empty-state"><h3>私人记录服务尚未连接</h3><p>不会把先前的本地合成记录当作服务端结果。切回本地演示后可继续查看。</p></div>`;
  }
  const entry = state.selectedRecord || state.entry;
  if (!entry) {
    return `${backHeading('私人记录', 'universe')}<div class="card">没有选择记录。</div>`;
  }
  return `${backHeading('私人记录', 'universe')}${modeBanner()}<div class="card"><div class="privacy-row"><span>⌑ 仅自己可见</span><span>${entry.date}</span></div><div class="saved-weather">${icon(entry.weather)}<b>${weatherLabel(entry.weather)}</b></div><p class="caption">仅在详情中显示正文。</p><div class="record-text">${escapeText(entry.text || '这一刻没有写文字，也完整地留住了天气。')}</div><p class="caption">${escapeText(entry.tags.join(' · ') || '未添加标签')}</p>${button('edit-selected', '修改这条记录', 'secondary')}</div>`;
}

function campusPage() {
  return `<h2 class="page-title">找个角落，慢慢来</h2><p class="page-subtitle">想独处、走走，或只是看看。</p>${modeBanner()}<div class="card"><span class="badge">固定模拟 · 校园天气小剧场</span><div class="saved-weather">${icon('PARTLY_CLOUDY', 45)}<span>今天的校园：多云</span></div><p class="caption">这是固定模拟情境，不读取个人记录，也不代表同学情绪或真实天气。</p>${button('nav:weather-info', '了解模拟方式', 'secondary')}</div><div class="card"><div class="place-illustration" aria-hidden="true">⌁</div><span class="badge">合成地点示例 · 未核验</span><h3>图书馆旁的小庭院</h3><p class="caption">适合安静坐一会 · 无需定位即可浏览<br />不是已核验地点推荐，不提供实际导航。</p>${button('nav:place', '查看地点示例', 'secondary')}</div>${entryLink('nav:tasks', '↟', '换个方式照顾自己', '任务完全自愿，可以随时跳过')}`;
}

function tasksPage() {
  let status = '';
  if (state.taskState) {
    status = `<div class="feedback" role="status">${escapeText(state.taskState)}</div>`;
  }
  return `${backHeading('做件很小的事')}${modeBanner()}<div class="kind-note">做不做都可以，不评分、不要求打卡。</div><div class="card"><span class="badge">合成任务示例 · 约 1 分钟</span><h3>喝一口水，停一下</h3><p class="caption">如果你愿意，放下手边的事，喝一口水。也可以直接跳过。</p>${status}${button('task:accept', '我愿意试试')}${button('task:complete', '标记自己已完成', 'secondary', state.taskState !== '你选择尝试这件小事；也可以随时跳过。')}${button('task:skip', '这次先不了', 'secondary')}</div>${button('nav:today', '回到今天', 'secondary')}`;
}

function mePage() {
  return `<h2 class="page-title">照顾自己的小宇宙</h2><p class="page-subtitle">不比较，也不需要连续打卡。</p>${modeBanner()}<div class="card profile">${icon('PARTLY_CLOUDY')}<span><b>校园记录者</b><small>合成演示角色 · 未连接真实身份</small></span></div>${entryLink('nav:preferences', '☷', '偏好设置', '本原型的正文预览和装饰开关')}${entryLink('nav:campus', '♡', '收藏地点', '正式私人收藏仍待接入')}${entryLink('nav:tasks', '↟', '任务与历史', '任务自愿；真实历史待服务接入')}${entryLink('nav:privacy', '⌑', '隐私与数据', '私人范围、导出与注销说明')}${entryLink('nav:support', '?', '帮助与支持', '资源须经学校核验后提供')}`;
}

function preferencesPage() {
  return `${backHeading('偏好设置', 'me')}${modeBanner()}<div class="card"><div class="switch-row"><label for="decorations">显示装饰（此原型未展示装饰）</label><input type="checkbox" id="decorations" ${state.preferences.decorations ? 'checked' : ''} /></div><div class="switch-row"><label for="card-text">允许详情外的正文预览（本轮仍默认隐藏）</label><input type="checkbox" id="card-text" ${state.preferences.cardText ? 'checked' : ''} /></div><p class="caption">只改变当前原型的开关状态；尚未实现跨页面偏好联动，不同步到工程、账号或服务器。</p></div>`;
}

function privacyPage() {
  return `${backHeading('隐私与数据', 'me')}${modeBanner()}<div class="card"><h3>哪些内容只有自己可见？</h3><p>日记天气、文字、标签及月份回顾属于私人记录。校园模拟天气不读取这些数据。</p><p class="caption">本原型没有登录与服务端鉴权；“仅自己可见”是待工程验收的产品范围，不是本地 HTML 提供的账号隔离。</p></div><div class="card"><h3>导出与注销</h3><p class="caption">真实服务尚未接入，本原型不会生成真实导出，也不会发起注销。</p>${button('export-info', '查看导出预期', 'secondary')}${button('closure-info', '查看注销预期', 'secondary')}${feedback()}</div>`;
}

function auxiliaryPage() {
  const definitions = {
    'weather-info': [
      '模拟天气说明',
      'campus',
      '固定模拟，不读取私人日记',
      '校园天气小剧场由固定示例生成，不是校园同学的情绪统计，也不是实时气象。此页面只验证说明是否容易理解。',
    ],
    place: [
      '地点示例',
      'campus',
      '合成示例，未经过现场核验',
      '本轮不新增真实地点与导航承诺。正式地点需由 Qinghan 核对资料、开放时间、坐标及来源后再展示。',
    ],
    support: [
      '帮助与支持',
      'me',
      '支持资源待学校核验',
      '这份设计不提供未经核实的学校电话或心理资源。正式资源由学校核验后接入；当前页面不是危机干预或诊断工具。',
    ],
  };
  const [title, back, heading, body] = definitions[state.page] || ['页面', 'today', '', ''];
  return `${backHeading(title, back)}${modeBanner()}<div class="card"><h3>${heading}</h3><p>${body}</p></div>`;
}

function render() {
  const previousFocus = document.activeElement;
  const focusedAction =
    screen.contains(previousFocus) || tabbar.contains(previousFocus)
      ? previousFocus.dataset.action
      : '';
  const pages = {
    today: todayPage,
    record: recordPage,
    universe: universePage,
    detail: detailPage,
    campus: campusPage,
    tasks: tasksPage,
    me: mePage,
    preferences: preferencesPage,
    privacy: privacyPage,
  };
  screen.innerHTML = (pages[state.page] || auxiliaryPage)();
  const parent =
    {
      record: 'today',
      detail: 'universe',
      preferences: 'me',
      privacy: 'me',
      support: 'me',
      place: 'campus',
      'weather-info': 'campus',
    }[state.page] || state.page;
  tabbar.innerHTML = [
    ['today', '☼', '今天'],
    ['campus', '⌖', '校园'],
    ['universe', '⌁', '天气宇宙'],
    ['me', '♙', '我的'],
  ]
    .map(
      ([page, symbol, label]) =>
        `<button data-action="nav:${page}" ${parent === page ? 'aria-current="page"' : ''}><span class="tab-symbol" aria-hidden="true">${symbol}</span>${label}</button>`,
    )
    .join('');
  document.title = `MoodSky W2 · ${state.page} · 五类天气基线`;
  if (focusedAction) {
    const replacement = [
      ...screen.querySelectorAll('[data-action]'),
      ...tabbar.querySelectorAll('[data-action]'),
    ].find((element) => element.dataset.action === focusedAction && !element.disabled);
    if (replacement) {
      replacement.focus({ preventScroll: true });
    }
  }
}

function clearDraft() {
  state.weather = state.entry?.weather || '';
  state.text = state.entry?.text || '';
  state.tags = [...(state.entry?.tags || [])];
  state.dirty = false;
}

function guarded(callback) {
  if (locked()) {
    state.notice = '保存结果尚未确认，请先重试原操作，避免丢失请求。';
    render();
    return;
  }
  if (state.dirty && isEditing()) {
    pendingNavigation = callback;
    dialog.showModal();
    return;
  }
  callback();
}

function navigate(page) {
  const go = () => {
    state.page = page;
    state.notice = '';
    render();
    screen.scrollTop = 0;
    const heading = screen.querySelector('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    announce('页面已切换');
  };
  if (
    (state.page === 'today' && page === 'record') ||
    (state.page === 'record' && page === 'today' && !state.entry)
  ) {
    go();
  } else {
    guarded(go);
  }
}

function save() {
  if (!state.weather || locked() || Array.from(state.text).length > 1000) {
    return;
  }
  if (state.mode === 'unavailable') {
    state.notice = '当前版本尚未连接保存服务，没有保存。天气、文字和标签已保留，可继续编辑。';
    state.noticeType = 'error';
    render();
    return;
  }
  const request = {
    requestId: 'w2-demo-' + ++state.requestCounter,
    date: state.date,
    weather: state.weather,
    text: state.text,
    tags: [...state.tags],
  };
  if (state.forceUncertain) {
    state.forceUncertain = false;
    state.phase = 'uncertain';
    state.pending = request;
    state.notice = '模拟：保存结果未知。不要重复新建；输入已保留，请重试原操作。';
    state.noticeType = 'error';
    render();
    return;
  }
  completeSave(request);
}

function completeSave(request) {
  const entry = {
    date: request.date,
    weather: request.weather,
    text: request.text,
    tags: [...request.tags],
  };
  state.records = [...state.records.filter((record) => record.date !== entry.date), entry];
  state.entry = entry;
  state.selectedRecord = entry;
  state.dirty = false;
  state.phase = 'idle';
  state.pending = null;
  state.notice = '已保存到本次演示，刷新后清除；没有写入云端。';
  state.noticeType = 'info';
  state.page = state.page === 'record' ? 'detail' : 'today';
  render();
  announce(state.notice);
}

function handleAction(action) {
  const [type, value] = action.split(':');
  if (type === 'nav') {
    navigate(value);
  } else if (type === 'weather' && !locked()) {
    state.weather = value;
    state.dirty = true;
    state.notice = '';
    render();
  } else if (type === 'tag' && !locked()) {
    if (state.tags.includes(value)) {
      state.tags = state.tags.filter((tag) => tag !== value);
    } else if (state.tags.length < 5) {
      state.tags.push(value);
    } else {
      state.notice = '标签最多选 5 个，也可以全部留空。';
    }
    state.dirty = true;
    render();
  } else if (type === 'save') {
    save();
  } else if (type === 'retry-save' && state.pending) {
    state.retryIds.push(state.pending.requestId);
    completeSave(state.pending);
  } else if (type === 'open-entry') {
    state.selectedRecord = state.entry;
    navigate('detail');
  } else if (type === 'edit-entry' || type === 'edit-selected') {
    const entry = type === 'edit-entry' ? state.entry : state.selectedRecord;
    if (entry) {
      state.entry = entry;
      state.date = entry.date;
      clearDraft();
      state.page = 'record';
      render();
    }
  } else if (type === 'detail') {
    state.selectedRecord = state.records.find((entry) => entry.date === value);
    navigate('detail');
  } else if (type === 'previous-date' || type === 'today-date') {
    guarded(() => {
      const date = new Date(state.date + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() - 1);
      state.date = type === 'today-date' ? BASE_DATE : date.toISOString().slice(0, 10);
      state.entry = state.records.find((entry) => entry.date === state.date) || null;
      clearDraft();
      state.notice = '';
      render();
    });
  } else if (type === 'month') {
    const [year, month] = state.month.split('-').map(Number);
    const date = new Date(year, month - 1 + (value === 'next' ? 1 : -1), 1);
    state.month = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    render();
  } else if (type === 'review-retry') {
    state.reviewState = 'ready';
    render();
    announce('已重新读取本地合成示例');
  } else if (type === 'task') {
    state.taskState =
      state.mode === 'unavailable'
        ? '任务服务尚未接入，没有记录操作，也不影响日记。'
        : {
            accept: '你选择尝试这件小事；也可以随时跳过。',
            complete: '已标记本次合成任务完成，不评分，也不写云端。',
            skip: '这次先不了，也没有关系。不影响任何记录。',
          }[value];
    render();
    announce(state.taskState);
  } else if (type === 'export-info') {
    state.notice =
      '导出预期：确认本人身份后创建任务，明确范围、进度和下载有效期。当前服务未接入，未创建任务。';
    state.noticeType = 'info';
    render();
  } else if (type === 'closure-info') {
    state.notice =
      '注销预期：说明后果、二次确认并复核会话，提供可查询进度。当前服务未接入，未停用或删除任何账号。';
    state.noticeType = 'info';
    render();
  }
}

document.addEventListener('click', (event) => {
  const element = event.target.closest('[data-action]');
  if (element && !element.disabled) {
    handleAction(element.dataset.action);
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'journal-text') {
    state.text = event.target.value;
    state.dirty = true;
    document.querySelector('#text-counter').textContent = Array.from(state.text).length + '/1000';
    document.querySelector('[data-action="save"]').disabled =
      !state.weather || Array.from(state.text).length > 1000;
  }
});
document.querySelector('#service-mode').addEventListener('change', (event) => {
  if (locked()) {
    event.target.value = state.mode;
    announce('请先重试原操作');
    return;
  }
  state.mode = event.target.value;
  state.notice = '';
  render();
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'decorations') {
    state.preferences.decorations = event.target.checked;
    announce('仅更改本次原型开关');
  }
  if (event.target.id === 'card-text') {
    state.preferences.cardText = event.target.checked;
    announce('仅更改本次原型开关，详情外正文仍隐藏');
  }
});
document.querySelector('#keep-draft').addEventListener('click', () => {
  dialog.close();
  pendingNavigation = null;
});
document.querySelector('#discard-draft').addEventListener('click', () => {
  const callback = pendingNavigation;
  pendingNavigation = null;
  clearDraft();
  dialog.close();
  if (callback) {
    callback();
  }
});
dialog.addEventListener('cancel', () => {
  pendingNavigation = null;
});
document.querySelector('#scenario-uncertain').addEventListener('click', () => {
  if (state.mode !== 'demo' || !isEditing() || !state.weather || state.entry) {
    announce('请在本地演示的未保存编辑页先选择天气');
    return;
  }
  state.forceUncertain = true;
  state.notice = '下一次保存将演示“结果未知”，随后可重试原操作。';
  state.noticeType = 'info';
  render();
});
document.querySelector('#scenario-loading').addEventListener('click', () => {
  guarded(() => {
    state.page = 'universe';
    state.reviewState = 'error';
    state.notice = '';
    render();
  });
});
document.querySelector('#scenario-empty').addEventListener('click', () => {
  guarded(() => {
    state.page = 'universe';
    state.month = '2026-09';
    state.reviewState = 'ready';
    render();
  });
});
document.querySelector('#reset-demo').addEventListener('click', () => {
  guarded(() => {
    state = makeState();
    document.querySelector('#service-mode').value = 'demo';
    render();
  });
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty || state.pending) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.w2Prototype = { inspect: () => JSON.parse(JSON.stringify(state)) };
render();
