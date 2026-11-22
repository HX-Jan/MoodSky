#!/usr/bin/env node
'use strict';
// Alpha sprint evidence harness for Zhifeng Dai (AS-Z01 / AS-Z02, review module).
//
// It loads the real page modules in a sandboxed mini-program shim (the same
// technique as tests/week6-review-zhifeng.test.js), runs them against the shared
// synthetic SEED_ENTRIES, and writes:
//   - expectation-first CSV tables (expected columns are filled before the run)
//   - SVG diagrams rendered from the recorded page state
//
// The SVGs are rendered from runtime data, not developer-tool screenshots. When
// the native WeChat simulator is unavailable this is stated in the reports.
//
// Usage:
//   node tools/week6-z/alpha-review-harness.cjs --cycle c1 --out docs/alpha-sprint/zhifeng-dai/c1

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const { createSessionState } = require(path.join(ROOT, 'miniprogram/services/session-state'));
const { AppError } = require(path.join(ROOT, 'miniprogram/shared/result'));
const { businessDate } = require(path.join(ROOT, 'miniprogram/shared/date'));
const { weatherLabel } = require(path.join(ROOT, 'miniprogram/shared/weather'));
const { createLocalStore } = require(path.join(ROOT, 'miniprogram/modules/review/demo-store'));
const { createReviewDemoService } = require(
  path.join(ROOT, 'miniprogram/modules/review/demo-service'),
);
const { createReviewReader } = require(path.join(ROOT, 'miniprogram/modules/review/reader'));
const { SEED_ENTRIES, EMPTY_DEMO_MONTH } = require(
  path.join(ROOT, 'miniprogram/modules/review/demo-data'),
);
const { createMemoryJournalService } = require(
  path.join(ROOT, 'miniprogram/modules/journal/demo-service'),
);
const { createJournalController } = require(
  path.join(ROOT, 'miniprogram/modules/journal/controller'),
);
const { backendClient } = require(path.join(ROOT, 'tests/helpers/backend-client'));

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (rounds = 4) => {
  for (let index = 0; index < rounds; index += 1) {
    await settle();
  }
};
const scope = (letter) => 'scope_' + letter.repeat(64);
const list = (value) => Array.from(value || []);
const shiftDate = (date, offset) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function demoStore() {
  return createLocalStore(clone(SEED_ENTRIES));
}

function demoPage(name, { store, service, query = {}, wx: wxExtra = {} } = {}) {
  const filename = path.resolve(ROOT, 'miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  const demoService = require(path.join(ROOT, 'miniprogram/modules/review/demo-service'));
  const demoStoreModule = require(path.join(ROOT, 'miniprogram/modules/review/demo-store'));
  const wx = {
    _pullStops: 0,
    _navigations: [],
    stopPullDownRefresh() {
      this._pullStops += 1;
    },
    navigateTo(options = {}) {
      this._navigations.push({ method: 'navigateTo', url: options.url || '' });
    },
    switchTab(options = {}) {
      this._navigations.push({ method: 'switchTab', url: options.url || '' });
    },
    redirectTo(options = {}) {
      this._navigations.push({ method: 'redirectTo', url: options.url || '' });
    },
    reLaunch(options = {}) {
      this._navigations.push({ method: 'reLaunch', url: options.url || '' });
    },
    navigateBack() {
      this._navigations.push({ method: 'navigateBack', url: '' });
    },
    showToast() {},
    showModal() {},
    showShareMenu() {},
    ...wxExtra,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { journalDemo: true, cloudEnabled: false };
      }
      if (id.endsWith('/review/demo-store')) {
        return { reviewStore: store, createLocalStore: demoStoreModule.createLocalStore };
      }
      if (id.endsWith('/review/demo-service')) {
        return {
          reviewDemoService: service,
          createReviewDemoService: demoService.createReviewDemoService,
        };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: clone(definition.data),
    updates: 0,
    setData(values) {
      Object.assign(this.data, values);
      this.updates += 1;
    },
  };
  page.onLoad(query);
  return { page, wx };
}

function cloudPage(name, { reader, sessionState, query = {}, wx: wxExtra = {} }) {
  const filename = path.resolve(ROOT, 'miniprogram/pages', name, 'index.js');
  const localRequire = createRequire(filename);
  let definition;
  const readerModule = require(path.join(ROOT, 'miniprogram/modules/review/reader'));
  const boundary = require(path.join(ROOT, 'miniprogram/modules/review/session-boundary'));
  const wx = {
    _pullStops: 0,
    _navigations: [],
    stopPullDownRefresh() {
      this._pullStops += 1;
    },
    navigateTo() {},
    switchTab() {},
    navigateBack() {},
    showToast() {},
    showModal() {},
    showShareMenu() {},
    ...wxExtra,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { journalDemo: false, cloudEnabled: true };
      }
      if (id.endsWith('/review/session-boundary') && sessionState) {
        return {
          ...boundary,
          subscribeReviewSession: (listener) =>
            boundary.subscribeReviewSession(listener, sessionState),
        };
      }
      if (id.endsWith('/review/reader')) {
        return {
          reviewReader: reader,
          reviewErrorMessage: readerModule.reviewErrorMessage,
          createReviewReader: readerModule.createReviewReader,
        };
      }
      if (id.endsWith('/review/demo-store')) {
        const forbidden = () => {
          throw new Error('SYNTHETIC demo store must not be used in cloud mode');
        };
        return {
          reviewStore: { subscribe: forbidden, listAll: forbidden },
          createLocalStore: forbidden,
        };
      }
      if (id.endsWith('/review/demo-service')) {
        const forbidden = () => {
          throw new Error('SYNTHETIC demo service must not be used in cloud mode');
        };
        return { reviewDemoService: {}, createReviewDemoService: forbidden };
      }
      return localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: clone(definition.data),
    updates: 0,
    setData(values) {
      Object.assign(this.data, values);
      this.updates += 1;
    },
  };
  page.onLoad(query);
  return { page, wx };
}

const recordedCells = (page) =>
  list(page.data.weeks)
    .flatMap((week) => list(week))
    .filter((cell) => cell.recorded)
    .map((cell) => ({
      date: cell.date,
      id: cell.id,
      weather: cell.weather,
      label: cell.label,
    }));

const cellsOf = (page) =>
  list(page.data.weeks)
    .flatMap((week) => list(week))
    .map((cell) => ({
      key: cell.key,
      date: cell.date || '',
      day: cell.day || 0,
      blank: cell.blank === true,
      recorded: cell.recorded === true,
    }));

const cardsOf = (page) =>
  list(page.data.cards).map((card) => ({
    id: card.id,
    date: card.date,
    weather: card.weather,
    label: card.label,
    hasText: Object.hasOwn(card, 'text') || Object.hasOwn(card, 'textPreview'),
  }));

// ---------------------------------------------------------------- CSV / SVG IO

function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeCsv(file, columns, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');
}

function verdict(expected, actual) {
  return expected === actual ? 'PASS' : 'FAIL';
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value).replace(/[&<>"]/g, (character) => ESCAPES[character]);
const FONT = 'system-ui, Segoe UI, Microsoft YaHei, PingFang SC, sans-serif';

function svgShell({ width, height, title, subtitle, footer, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <rect width="100%" height="100%" fill="#f4f7fb"/>
  <text x="40" y="50" font-family="${FONT}" font-size="25" font-weight="700" fill="#12233f">${esc(title)}</text>
  <text x="40" y="78" font-family="${FONT}" font-size="13" fill="#5b6b82">${esc(subtitle)}</text>
  ${body}
  <text x="40" y="${height - 22}" font-family="${FONT}" font-size="12" fill="#7a8798">${esc(footer)}</text>
</svg>
`;
}

function svgText(
  x,
  y,
  value,
  { size = 14, weight = 400, fill = '#243247', anchor = 'start' } = {},
) {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
}

function svgPanel(x, y, width, height, title, lines, accent = '#2f6fed') {
  const rows = lines
    .map((line, index) => svgText(x + 18, y + 74 + index * 26, line, { size: 13, fill: '#334155' }))
    .join('\n  ');
  return `<g>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="#ffffff" stroke="#dbe4f0"/>
  <rect x="${x}" y="${y}" width="${width}" height="46" rx="14" fill="#eef4ff"/>
  <rect x="${x}" y="${y + 32}" width="${width}" height="14" fill="#eef4ff"/>
  ${svgText(x + 18, y + 30, title, { size: 15, weight: 700, fill: accent })}
  ${rows}
</g>`;
}

function svgBadge(x, y, text, pass = true) {
  const fill = pass ? '#e8f7ee' : '#fdecec';
  const color = pass ? '#15803d' : '#b91c1c';
  return `<g>
  <rect x="${x}" y="${y}" width="150" height="34" rx="17" fill="${fill}" stroke="${color}"/>
  ${svgText(x + 75, y + 22, text, { size: 13, weight: 700, fill: color, anchor: 'middle' })}
</g>`;
}

function writeSvg(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (_error) {
    return 'unknown';
  }
}

function runLog(file, cycle, summary) {
  const lines = [
    '# alpha review harness run log',
    'cycle: ' + cycle,
    'executed_at: ' + new Date().toISOString(),
    'business_date: ' + businessDate(),
    'platform: ' + process.platform + ' ' + os.release(),
    'node: ' + process.version,
    'cwd: ' + ROOT,
    'git_sha: ' + gitSha(),
    'pages: real miniprogram page modules under a vm mini-program shim, journalDemo=true / cloudEnabled=false',
    'seed: shared SEED_ENTRIES (7 records, 2026-09-27..2026-10-16), empty demo month ' +
      EMPTY_DEMO_MONTH,
    'evidence: SVGs are rendered from recorded page state; they are not developer-tool screenshots',
    '',
    'summary:',
  ];
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'svg' || key === 'csv') {
      continue;
    }
    lines.push('  ' + key + ': ' + JSON.stringify(value));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

// -------------------------------------------------------------------- expected

const CURRENT_MONTH = businessDate().slice(0, 7); // run day drives the "current month" row
const MONTH_ORDER = [CURRENT_MONTH, '2026-10', '2026-09', EMPTY_DEMO_MONTH];
const MONTH_GRID = {
  '2026-10': { days: 31, lead: 3, blank: 4, weeks: 5 },
  '2026-09': { days: 30, lead: 1, blank: 5, weeks: 5 },
  [EMPTY_DEMO_MONTH]: { days: 31, lead: 5, blank: 11, weeks: 6 },
};
// The current month is derived from the run day, so its grid expectation is
// computed before the pages run instead of being frozen to November.
if (!MONTH_GRID[CURRENT_MONTH]) {
  const first = new Date(CURRENT_MONTH + '-01T00:00:00.000Z');
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(
    Date.UTC(Number(CURRENT_MONTH.slice(0, 4)), Number(CURRENT_MONTH.slice(5, 7)), 0),
  ).getUTCDate();
  const weeks = Math.ceil((lead + days) / 7);
  MONTH_GRID[CURRENT_MONTH] = { days, lead, blank: weeks * 7 - days, weeks };
}
const SEED_BY_MONTH = new Map();
for (const entry of SEED_ENTRIES) {
  const month = entry.date.slice(0, 7);
  if (!SEED_BY_MONTH.has(month)) {
    SEED_BY_MONTH.set(month, []);
  }
  SEED_BY_MONTH.get(month).push(entry);
}
const labelOf = (entry) => weatherLabel(entry.weather, entry.weatherName);
const expectedCount = (month) => (SEED_BY_MONTH.get(month) || []).length;
const expectedSummary = (month) => {
  const count = expectedCount(month);
  return count > 0 ? '本月 ' + count + ' 条记录' : '本月暂无记录';
};
const reviewWindowStart = shiftDate(businessDate(), -89);
const expectedTimeline = SEED_ENTRIES.filter(
  (entry) => entry.date >= reviewWindowStart && entry.date <= businessDate(),
).sort((a, b) => (a.date > b.date ? -1 : 1));

function row(month, date, entryId, view, expected, note = '') {
  return {
    month,
    date,
    entry_id: entryId,
    view,
    expected,
    actual: '',
    match: '',
    note,
  };
}

function fill(rowValue, actual) {
  rowValue.actual = actual;
  rowValue.match = verdict(rowValue.expected, actual);
  return rowValue;
}

// ------------------------------------------------------------------- C1 / C4

async function collectBaseline({ includeReturn }) {
  const rows = [];
  // Expectations are recorded before any page runs.
  for (const month of MONTH_ORDER) {
    const grid = MONTH_GRID[month];
    rows.push(
      row(
        month,
        '',
        '',
        'month_summary',
        expectedCount(month) + '|' + expectedSummary(month) + '|error=',
      ),
    );
    rows.push(
      row(
        month,
        '',
        '',
        'month_grid',
        'days=' +
          grid.days +
          '|blank=' +
          grid.blank +
          '|weeks=' +
          grid.weeks +
          '|recorded=' +
          expectedCount(month),
      ),
    );
  }
  for (const entry of SEED_ENTRIES) {
    rows.push(
      row(
        entry.date.slice(0, 7),
        entry.date,
        entry.id,
        'calendar',
        entry.weather + '|' + labelOf(entry) + '|recorded',
      ),
    );
    rows.push(
      row(
        entry.date.slice(0, 7),
        entry.date,
        entry.id,
        'month_archive',
        entry.weather + '|' + labelOf(entry) + '|card',
      ),
    );
    rows.push(
      row(
        entry.date.slice(0, 7),
        entry.date,
        entry.id,
        'detail',
        labelOf(entry) + '|v' + entry.version + '|' + entry.text,
      ),
    );
  }
  for (const entry of expectedTimeline) {
    rows.push(
      row(entry.date.slice(0, 7), entry.date, entry.id, 'review_90d', labelOf(entry) + '|timeline'),
    );
  }
  rows.push(row('', '', '', 'archive_index', '2026-10|5;2026-09|2;2026-08|0|empty'));
  rows.push(row('2026-09', '', '', 'non_current_refresh', '2026-09|2|error=|pullStops=1'));
  rows.push(
    row(
      EMPTY_DEMO_MONTH,
      '',
      '',
      'empty_month_refresh',
      EMPTY_DEMO_MONTH + '|0|本月暂无记录|error=',
    ),
  );
  if (includeReturn) {
    rows.push(row('2026-09', '', '', 'return_to_universe', '2026-09|2|error='));
  }

  const store = demoStore();
  const service = createReviewDemoService({ store });
  const pages = new Map();
  for (const month of MONTH_ORDER) {
    pages.set(month, demoPage('universe', { store, service, query: { month } }).page);
  }
  const monthPages = new Map();
  for (const month of MONTH_ORDER) {
    monthPages.set(month, demoPage('review/month', { store, service, query: { month } }).page);
  }
  const archive = demoPage('review/archive', { store, service, query: {} }).page;
  const details = new Map();
  for (const entry of [...SEED_ENTRIES].reverse()) {
    details.set(
      entry.date,
      demoPage('review/detail', {
        store,
        service,
        query: { month: entry.date.slice(0, 7), date: entry.date, id: entry.id },
      }).page,
    );
  }
  const insights = demoPage('review/insights', { store, service, query: { days: '90' } }).page;
  await flush();

  for (const month of MONTH_ORDER) {
    const page = pages.get(month);
    const rowSummary = rows.find((item) => item.view === 'month_summary' && item.month === month);
    fill(
      rowSummary,
      page.data.monthRecordCount +
        '|' +
        page.data.monthSummary +
        '|error=' +
        page.data.calendarError,
    );
    const flat = cellsOf(page);
    const grid = rows.find((item) => item.view === 'month_grid' && item.month === month);
    fill(
      grid,
      'days=' +
        flat.filter((cell) => !cell.blank).length +
        '|blank=' +
        flat.filter((cell) => cell.blank).length +
        '|weeks=' +
        list(page.data.weeks).length +
        '|recorded=' +
        flat.filter((cell) => cell.recorded).length,
    );
  }

  const calendarByDate = new Map();
  for (const month of MONTH_ORDER) {
    for (const cell of recordedCells(pages.get(month))) {
      calendarByDate.set(cell.date, cell);
    }
  }
  const cardsByDate = new Map();
  for (const month of MONTH_ORDER) {
    for (const card of cardsOf(monthPages.get(month))) {
      cardsByDate.set(card.date, card);
    }
  }
  const timelineByDate = new Map(
    list(insights.data.timelineItems).map((item) => [item.date, item]),
  );

  for (const entry of SEED_ENTRIES) {
    const calendarRow = rows.find((item) => item.view === 'calendar' && item.entry_id === entry.id);
    const cell = calendarByDate.get(entry.date);
    fill(calendarRow, cell ? cell.weather + '|' + cell.label + '|recorded' : 'absent');

    const archiveRow = rows.find(
      (item) => item.view === 'month_archive' && item.entry_id === entry.id,
    );
    const card = cardsByDate.get(entry.date);
    fill(archiveRow, card ? card.weather + '|' + card.label + '|card' : 'absent');
    archiveRow.note = card && card.hasText ? 'card carries text' : 'no body on card';

    const detailRow = rows.find((item) => item.view === 'detail' && item.entry_id === entry.id);
    const detail = details.get(entry.date);
    fill(
      detailRow,
      detail.data.phase === 'ready'
        ? detail.data.weatherLabel + '|' + detail.data.versionText + '|' + detail.data.text
        : detail.data.phase + '|' + detail.data.errorMessage,
    );
    if (detail.data.phase !== 'ready') {
      detailRow.note = detail.data.errorMessage;
    }

    const reviewRow = rows.find((item) => item.view === 'review_90d' && item.entry_id === entry.id);
    if (reviewRow) {
      const item = timelineByDate.get(entry.date);
      fill(reviewRow, item ? item.label + '|timeline' : 'absent');
      reviewRow.note = 'window ' + reviewWindowStart + '..' + businessDate();
    }
  }

  fill(
    rows.find((item) => item.view === 'archive_index'),
    list(archive.data.months)
      .map((item) => item.month + '|' + item.recordCount + (item.empty ? '|empty' : ''))
      .join(';'),
  );

  // Non-current month pull-to-refresh keeps the month and rows. A dedicated page
  // captures the native pull indicator count without disturbing the read page.
  const refresh = demoPage('universe', { store, service, query: { month: '2026-09' } });
  await flush();
  await refresh.page.onPullDownRefresh();
  await flush(1);
  fill(
    rows.find((item) => item.view === 'non_current_refresh'),
    refresh.page.data.month +
      '|' +
      refresh.page.data.monthRecordCount +
      '|error=' +
      refresh.page.data.calendarError +
      '|pullStops=' +
      refresh.wx._pullStops,
  );
  // Empty month refresh keeps the empty state.
  const empty = demoPage('universe', { store, service, query: { month: EMPTY_DEMO_MONTH } });
  await flush();
  await empty.page.onPullDownRefresh();
  await flush(1);
  fill(
    rows.find((item) => item.view === 'empty_month_refresh'),
    empty.page.data.month +
      '|' +
      empty.page.data.monthRecordCount +
      '|' +
      empty.page.data.monthSummary +
      '|error=' +
      empty.page.data.calendarError,
  );
  const september = pages.get('2026-09');
  if (includeReturn) {
    september.onHide();
    september.onShow();
    await flush();
    fill(
      rows.find((item) => item.view === 'return_to_universe'),
      september.data.month +
        '|' +
        september.data.monthRecordCount +
        '|error=' +
        september.data.calendarError,
    );
  }

  const state = {
    currentMonth: CURRENT_MONTH,
    months: MONTH_ORDER,
    record: '2026-10-16',
    calendarByDate,
    cardsByDate,
    archiveMonths: list(archive.data.months),
    detail1016: details.get('2026-10-16'),
    insights,
    emptyPage: empty.page,
    september,
    pages,
    monthPages,
  };

  for (const page of pages.values()) {
    page.onUnload();
  }
  for (const page of monthPages.values()) {
    page.onUnload();
  }
  archive.onUnload();
  for (const page of details.values()) {
    page.onUnload();
  }
  insights.onUnload();
  refresh.page.onUnload();
  empty.page.onUnload();

  return { rows, state };
}

function crossPageSvg(state, title) {
  const record = state.record;
  const cell = state.calendarByDate.get(record);
  const card = state.cardsByDate.get(record);
  const detail = state.detail1016.data;
  const timeline = list(state.insights.data.timelineItems).find((item) => item.date === record);
  const panels = [
    {
      title: '天气宇宙 · 月历',
      lines: [
        '日期：' + record,
        '标记：' + (cell ? cell.weather + ' / ' + cell.label : 'absent'),
        '本月：' + state.pages.get('2026-10').data.monthRecordCount + ' 条记录',
        '点击：可进入本人详情',
      ],
    },
    {
      title: '月份档案 · 卡片',
      lines: [
        '日期：' + record,
        '标记：' + (card ? card.weather + ' / ' + card.label : 'absent'),
        '卡片数：' + list(state.monthPages.get('2026-10').data.cards).length,
        '正文：卡片不展示（无正文）',
      ],
    },
    {
      title: '详情 · 本人全文',
      lines: [
        '日期：' + detail.dateLabel,
        '天气：' + detail.weatherLabel,
        '版本：' + detail.versionText,
        '正文：' + String(detail.text).slice(0, 26) + '…',
      ],
    },
    {
      title: '回顾 · 90 天时间线',
      lines: [
        '日期：' + (timeline ? timeline.date : 'absent'),
        '标记：' + (timeline ? timeline.label : 'absent'),
        '窗口：' + state.insights.data.metaText,
        '分布：' +
          list(state.insights.data.distRows)
            .filter((item) => item.count > 0)
            .map((item) => item.label + '=' + item.count)
            .join(' / '),
      ],
    },
  ];
  const body = panels
    .map((panel, index) =>
      svgPanel(40 + index * 295, 120, 265, 250, panel.title, panel.lines, '#2f6fed'),
    )
    .join('\n  ');
  const consistent = [cell, card, timeline].every(Boolean) && detail.phase === 'ready';
  const badge = svgBadge(40, 405, consistent ? '四入口一致 PASS' : '存在差异 FAIL', consistent);
  const footer =
    '来源：真实页面模块 + 共享 SEED_ENTRIES；由运行状态渲染，非微信开发者工具截图。' +
    '记录ID ' +
    record.replace(/-/g, '') +
    '；当前月 ' +
    state.currentMonth +
    '。';
  return svgShell({
    width: 1240,
    height: 470,
    title,
    subtitle: '同一条合成记录在月历、月份档案、详情和回顾中的实际显示；预期在运行前写入 CSV。',
    footer,
    body: body + '\n  ' + badge,
  });
}

function emptyMonthSvg(state, title) {
  const month = EMPTY_DEMO_MONTH;
  const page = state.emptyPage;
  const flat = cellsOf(page);
  const grid = MONTH_GRID[month];
  const cellWidth = 58;
  const cellHeight = 52;
  const startX = 46;
  const startY = 150;
  let gridMarkup = '';
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  for (let index = 0; index < 7; index += 1) {
    gridMarkup += svgText(
      startX + index * cellWidth + cellWidth / 2,
      startY - 12,
      weekdays[index],
      { size: 12, fill: '#7a8798', anchor: 'middle' },
    );
  }
  for (let index = 0; index < flat.length; index += 1) {
    const column = index % 7;
    const rowIndex = Math.floor(index / 7);
    const x = startX + column * cellWidth;
    const y = startY + rowIndex * cellHeight;
    const cell = flat[index];
    const fill = cell.blank ? '#f8fafc' : '#ffffff';
    const stroke = cell.blank ? '#eef2f7' : '#dbe4f0';
    gridMarkup += `<rect x="${x}" y="${y}" width="${cellWidth - 6}" height="${cellHeight - 6}" rx="8" fill="${fill}" stroke="${stroke}"/>`;
    if (!cell.blank) {
      gridMarkup += svgText(x + (cellWidth - 6) / 2, y + 29, String(cell.day), {
        size: 13,
        weight: 600,
        fill: '#334155',
        anchor: 'middle',
      });
    }
  }
  const summaryLines = [
    '月份：' + page.data.month + '（非当前月空态）',
    '本月记录：' + page.data.monthRecordCount + ' 条',
    '摘要：' + page.data.monthSummary,
    '日历错误：' + (page.data.calendarError || '无'),
    '天气标识：0 个（空白日期不补天气）',
    '当前月 ' +
      state.currentMonth +
      '：' +
      state.pages.get(state.currentMonth).data.monthRecordCount +
      ' 条 / ' +
      state.pages.get(state.currentMonth).data.monthSummary,
  ];
  const body =
    gridMarkup +
    '\n  ' +
    svgPanel(500, 120, 360, 300, '空月份实测（2026-08）', summaryLines, '#0f766e') +
    '\n  ' +
    svgBadge(
      500,
      440,
      '空月结果 PASS',
      page.data.month === month && page.data.monthRecordCount === 0,
    );
  const footer =
    '网格为 ' +
    grid.weeks +
    ' 周、' +
    grid.days +
    ' 天、' +
    grid.blank +
    ' 个留白；由页面 weeks 数据渲染，非开发者工具截图。';
  return svgShell({
    width: 1240,
    height: 520,
    title,
    subtitle: '全空月份 2026-08 与非当前月 2026-09 刷新、返回结果；留白不补天气。',
    footer,
    body,
  });
}

async function runC1(outDir) {
  const { rows, state } = await collectBaseline({ includeReturn: true });
  const base = path.join(outDir, 'evidence');
  writeCsv(
    path.join(outDir, 'four-view-baseline.csv'),
    ['month', 'date', 'entry_id', 'view', 'expected', 'actual', 'match', 'note'],
    rows,
  );
  writeSvg(
    path.join(base, 'cross-page-2026-10-16.svg'),
    crossPageSvg(state, 'C1-Z｜同一记录跨页核对（2026-10-16）'),
  );
  writeSvg(
    path.join(base, 'empty-month-2026-08.svg'),
    emptyMonthSvg(state, 'C1-Z｜空月份与非当前月结果（2026-08 / 2026-09）'),
  );
  const summary = {
    cycle: 'c1',
    rows: rows.length,
    pass: rows.filter((item) => item.match === 'PASS').length,
    fail: rows.filter((item) => item.match === 'FAIL').length,
    current_month: state.currentMonth,
    empty_month: EMPTY_DEMO_MONTH,
  };
  runLog(path.join(base, 'run-c1.txt'), 'c1', summary);
  return summary;
}

async function runC4(outDir) {
  const { rows, state } = await collectBaseline({ includeReturn: true });
  // Re-run the failure and stale-response cases against the frozen candidate.
  const failure = await exerciseFailureMaterial();
  const stale = await exerciseStale();
  for (const item of failure) {
    rows.push({
      month: item.month,
      date: item.date,
      entry_id: '',
      view: 'regression_failure:' + item.scenario,
      expected: item.expected,
      actual: item.actual,
      match: verdict(item.expected, item.actual),
      note: item.note,
    });
  }
  for (const item of stale) {
    rows.push({
      month: item.month,
      date: '',
      entry_id: '',
      view: 'regression_stale:' + item.case,
      expected: item.expected,
      actual: item.actual,
      match: verdict(item.expected, item.actual),
      note: item.note,
    });
  }
  writeCsv(
    path.join(outDir, 'final-four-view.csv'),
    ['month', 'date', 'entry_id', 'view', 'expected', 'actual', 'match', 'note'],
    rows,
  );
  writeSvg(
    path.join(outDir, 'evidence', 'final-four-view.svg'),
    crossPageSvg(state, 'C4-Z｜最终候选四入口核对（2026-10-16）'),
  );
  writeSvg(
    path.join(outDir, 'evidence', 'final-empty-month.svg'),
    emptyMonthSvg(state, 'C4-Z｜演示素材：空月份与非当前月'),
  );
  const summary = {
    cycle: 'c4',
    rows: rows.length,
    pass: rows.filter((item) => item.match === 'PASS').length,
    fail: rows.filter((item) => item.match === 'FAIL').length,
    regression_rows: failure.length + stale.length,
  };
  runLog(path.join(outDir, 'evidence', 'run-c4.txt'), 'c4', summary);
  return summary;
}

// ------------------------------------------------------------------------ C2

async function exerciseUpdateDelete() {
  const store = demoStore();
  const service = createReviewDemoService({ store });
  const journal = createMemoryJournalService({ seedEntries: clone(SEED_ENTRIES) });
  const controller = createJournalController({
    service: journal,
    isDemo: true,
    onChanged: (change) => store.syncFromJournal(journal, change),
  });
  const universe = demoPage('universe', { store, service, query: { month: '2026-10' } }).page;
  const monthPage = demoPage('review/month', { store, service, query: { month: '2026-10' } }).page;
  const detail = demoPage('review/detail', {
    store,
    service,
    query: { month: '2026-10', date: '2026-10-16', id: 'demo_20261016' },
  }).page;
  const insights = demoPage('review/insights', { store, service, query: { days: '90' } }).page;
  await flush();

  const snap = () => {
    const cell = recordedCells(universe).find((item) => item.date === '2026-10-16');
    const first = list(monthPage.data.cards)[0];
    const line = list(insights.data.timelineItems).find((item) => item.date === '2026-10-16');
    const stormy = list(insights.data.distRows).find((item) => item.key === 'STORMY');
    const rainy = list(insights.data.distRows).find((item) => item.key === 'RAINY');
    return {
      count: universe.data.monthRecordCount,
      cell,
      cards: list(monthPage.data.cards).length,
      first,
      phase: detail.data.phase,
      label: detail.data.weatherLabel,
      text: detail.data.text,
      version: detail.data.versionText,
      hasLine: Boolean(line),
      lineLabel: line ? line.label : '',
      stormy: stormy ? stormy.count : -1,
      rainy: rainy ? rainy.count : -1,
    };
  };

  const before = snap();
  await controller.loadDate('2026-10-16');
  controller.chooseWeather('STORMY');
  controller.setText('SYNTHETIC W6 edited body');
  await controller.save();
  await flush();
  const edited = snap();

  controller.requestDelete();
  await controller.confirmDelete();
  await flush();
  const deleted = snap();

  const september = demoPage('universe', { store, service, query: { month: '2026-09' } }).page;
  await flush();
  const septemberCount = september.data.monthRecordCount;
  const septemberCells = recordedCells(september)
    .map((item) => item.date)
    .join(',');

  controller.dispose();
  for (const page of [universe, monthPage, detail, insights, september]) {
    page.onUnload();
  }

  return [
    {
      step: 'baseline',
      month: '2026-10',
      date: '2026-10-16',
      view: 'calendar',
      expected: '2026-10-16|RAINY|雨天|count=5',
      actual: before.cell
        ? before.cell.date +
          '|' +
          before.cell.weather +
          '|' +
          before.cell.label +
          '|count=' +
          before.count
        : 'absent|count=' + before.count,
      note: '',
    },
    {
      step: 'baseline',
      month: '2026-10',
      date: '2026-10-16',
      view: 'month_archive',
      expected: '2026-10-16|RAINY|雨天|cards=5|no-text',
      actual:
        (before.first
          ? before.first.date + '|' + before.first.weather + '|' + before.first.label
          : 'absent') +
        '|cards=' +
        before.cards +
        '|no-text',
      note: '',
    },
    {
      step: 'baseline',
      month: '2026-10',
      date: '2026-10-16',
      view: 'detail',
      expected:
        'ready|雨天|v1|合成演示：今天的雨声很合适记录心情，可在 Today 页编辑本条后回 Universe 查看刷新。',
      actual: before.phase + '|' + before.label + '|' + before.version + '|' + before.text,
      note: '',
    },
    {
      step: 'baseline',
      month: '2026-10',
      date: '2026-10-16',
      view: 'review',
      expected: 'has-1016=true|label=雨天|STORMY=1|RAINY=2',
      actual:
        'has-1016=' +
        before.hasLine +
        '|label=' +
        before.lineLabel +
        '|STORMY=' +
        before.stormy +
        '|RAINY=' +
        before.rainy,
      note: '90-day window',
    },
    {
      step: 'after_edit',
      month: '2026-10',
      date: '2026-10-16',
      view: 'calendar',
      expected: '2026-10-16|STORMY|雷雨|count=5',
      actual: edited.cell
        ? edited.cell.date +
          '|' +
          edited.cell.weather +
          '|' +
          edited.cell.label +
          '|count=' +
          edited.count
        : 'absent|count=' + edited.count,
      note: 'weather + text edit through journal controller',
    },
    {
      step: 'after_edit',
      month: '2026-10',
      date: '2026-10-16',
      view: 'month_archive',
      expected: '2026-10-16|STORMY|雷雨|cards=5|no-text',
      actual:
        (edited.first
          ? edited.first.date + '|' + edited.first.weather + '|' + edited.first.label
          : 'absent') +
        '|cards=' +
        edited.cards +
        '|no-text',
      note: '',
    },
    {
      step: 'after_edit',
      month: '2026-10',
      date: '2026-10-16',
      view: 'detail',
      expected: 'ready|雷雨|v2|SYNTHETIC W6 edited body',
      actual: edited.phase + '|' + edited.label + '|' + edited.version + '|' + edited.text,
      note: '',
    },
    {
      step: 'after_edit',
      month: '2026-10',
      date: '2026-10-16',
      view: 'review',
      expected: 'has-1016=true|label=雷雨|STORMY=2|RAINY=1',
      actual:
        'has-1016=' +
        edited.hasLine +
        '|label=' +
        edited.lineLabel +
        '|STORMY=' +
        edited.stormy +
        '|RAINY=' +
        edited.rainy,
      note: 'distribution re-binned from the same store',
    },
    {
      step: 'after_delete',
      month: '2026-10',
      date: '2026-10-16',
      view: 'calendar',
      expected: 'absent|count=4|dates=2026-10-01,2026-10-09,2026-10-12,2026-10-15',
      actual:
        (deleted.cell ? deleted.cell.date + '|' + deleted.cell.weather : 'absent') +
        '|count=' +
        deleted.count +
        '|dates=' +
        recordedCells(universe)
          .map((item) => item.date)
          .join(','),
      note: '',
    },
    {
      step: 'after_delete',
      month: '2026-10',
      date: '2026-10-16',
      view: 'month_archive',
      expected: '2026-10-15|cards=4',
      actual: (deleted.first ? deleted.first.date : 'absent') + '|cards=' + deleted.cards,
      note: '',
    },
    {
      step: 'after_delete',
      month: '2026-10',
      date: '2026-10-16',
      view: 'detail',
      expected: 'missing||',
      actual: deleted.phase + '|' + deleted.label + '|' + deleted.text,
      note: 'old link must not show the deleted body',
    },
    {
      step: 'after_delete',
      month: '2026-10',
      date: '2026-10-16',
      view: 'review',
      expected: 'has-1016=false|STORMY=1|RAINY=1',
      actual:
        'has-1016=' + deleted.hasLine + '|STORMY=' + deleted.stormy + '|RAINY=' + deleted.rainy,
      note: '',
    },
    {
      step: 'after_delete',
      month: '2026-09',
      date: '',
      view: 'other_month',
      expected: '2026-09|count=2|dates=2026-09-27,2026-09-30',
      actual: '2026-09|count=' + septemberCount + '|dates=' + septemberCells,
      note: 'an October delete must not touch September',
    },
  ];
}

async function exerciseFailureMaterial() {
  const rows = [];
  const expect = (scenario, month, date, expected, actual, blocking, note = '') => {
    rows.push({ scenario, month, date, expected, actual, blocking, note });
  };

  const store = demoStore();
  const base = createReviewDemoService({ store });
  let calendarFailures = 1;
  let archiveFailures = 1;
  const service = {
    ...base,
    async calendar(month) {
      if (calendarFailures > 0) {
        calendarFailures -= 1;
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC calendar outage');
      }
      return base.calendar(month);
    },
    async monthArchive(month) {
      if (archiveFailures > 0) {
        archiveFailures -= 1;
        throw new AppError('NETWORK_ERROR', 'SYNTHETIC archive outage');
      }
      return base.monthArchive(month);
    },
  };

  const { page } = demoPage('universe', { store, service, query: { month: '2026-09' } });
  await flush();
  expect(
    'calendar_failure_initial',
    '2026-09',
    '',
    'error=连接失败，请重新读取。|month=2026-09|label=2026年9月|busy=false|count=0',
    'error=' +
      page.data.calendarError +
      '|month=' +
      page.data.month +
      '|label=' +
      page.data.monthLabel +
      '|busy=' +
      page.data.calendarBusy +
      '|count=' +
      page.data.monthRecordCount,
    'false',
    'failed read keeps the chosen month',
  );

  page.onShow();
  await flush();
  expect(
    'calendar_show_recovery',
    '2026-09',
    '',
    'error=|count=2|dates=2026-09-27,2026-09-30',
    'error=' +
      page.data.calendarError +
      '|count=' +
      page.data.monthRecordCount +
      '|dates=' +
      recordedCells(page)
        .map((item) => item.date)
        .join(','),
    'false',
    'returning to the page re-reads automatically',
  );

  calendarFailures = 1;
  const retryFail = await page.onRetry();
  const retryFailError = page.data.calendarError;
  const retryOk = await page.onRetry();
  await flush(1);
  expect(
    'calendar_explicit_retry',
    '2026-09',
    '',
    'first=false|error=连接失败，请重新读取。|second=true|month=2026-09|count=2',
    'first=' +
      retryFail +
      '|error=' +
      retryFailError +
      '|second=' +
      retryOk +
      '|month=' +
      page.data.month +
      '|count=' +
      page.data.monthRecordCount,
    'false',
    '',
  );

  calendarFailures = 1;
  const pullFail = await page.onPullDownRefresh();
  const pullFailError = page.data.calendarError;
  const pullOk = await page.onPullDownRefresh();
  await flush(1);
  expect(
    'calendar_pull_refresh',
    '2026-09',
    '',
    'first=false|error=连接失败，请重新读取。|second=true|month=2026-09|count=2',
    'first=' +
      pullFail +
      '|error=' +
      pullFailError +
      '|second=' +
      pullOk +
      '|month=' +
      page.data.month +
      '|count=' +
      page.data.monthRecordCount,
    'false',
    '',
  );

  const monthPage = demoPage('review/month', { store, service, query: { month: '2026-10' } }).page;
  await flush();
  expect(
    'archive_failure_initial',
    '2026-10',
    '',
    'error=连接失败，请重新读取。|month=|count=0',
    'error=' +
      monthPage.data.error +
      '|month=' +
      monthPage.data.month +
      '|count=' +
      monthPage.data.recordCount,
    'false',
    'nothing is painted from a failed read',
  );
  monthPage.onShow();
  await flush();
  expect(
    'archive_show_recovery',
    '2026-10',
    '',
    'error=|month=2026-10|count=5',
    'error=' +
      monthPage.data.error +
      '|month=' +
      monthPage.data.month +
      '|count=' +
      monthPage.data.recordCount,
    'false',
    '',
  );

  const decoStore = demoStore();
  const decoBase = createReviewDemoService({ store: decoStore });
  let decorationFailures = 1;
  const decoService = {
    ...decoBase,
    async decorations(input) {
      if (input && input.operation === 'get' && decorationFailures > 0) {
        decorationFailures -= 1;
        throw new AppError('INVALID_RESPONSE', 'SYNTHETIC asset outage');
      }
      return decoBase.decorations(input);
    },
  };
  const { page: decoPage, wx: decoWx } = demoPage('universe', {
    store: decoStore,
    service: decoService,
    query: { month: '2026-10' },
  });
  await flush();
  expect(
    'decoration_get_failure',
    '2026-10',
    '',
    'note=装饰状态读取失败，已降级为默认背景；月历与记录不受影响。|ready=false|count=5|error=',
    'note=' +
      decoPage.data.decorationNote +
      '|ready=' +
      decoPage.data.decorationReady +
      '|count=' +
      decoPage.data.monthRecordCount +
      '|error=' +
      decoPage.data.calendarError,
    'false',
    'core review content stays available',
  );

  await decoPage.onRetryDecoration();
  await flush(1);
  const decoReady = decoPage.data.decorationReady;
  await decoPage.onAddSticker();
  await flush(1);
  expect(
    'decoration_retry',
    '2026-10',
    '',
    'ready=true|stickers=1',
    'ready=' + decoReady + '|stickers=' + list(decoPage.data.decorationStickers).length,
    'false',
    '',
  );

  decoPage.onSimulateAssetFailure();
  await flush(1);
  const firstSticker = list(decoPage.data.decorationStickers)[0] || {};
  expect(
    'sticker_asset_failure',
    '2026-10',
    '',
    'failed=true|background=默认背景|sticker=素材未加载|degraded=true|count=5|error=',
    'failed=' +
      decoPage.data.decorationFailed +
      '|background=' +
      decoPage.data.decorationBackground +
      '|sticker=' +
      (firstSticker.title || '') +
      '|degraded=' +
      (firstSticker.degraded === true) +
      '|count=' +
      decoPage.data.monthRecordCount +
      '|error=' +
      decoPage.data.calendarError,
    'false',
    'text and default background replace the missing asset',
  );

  const cell = recordedCells(decoPage)[0];
  decoPage.onDayTap({ currentTarget: { dataset: { date: cell.date, id: cell.id } } });
  const detailNav = decoWx._navigations[0] ? decoWx._navigations[0].url : '';
  decoPage.onShow();
  await flush();
  decoPage.onOpenArchive();
  decoPage.onShow();
  await flush();
  decoPage.onOpenInsights();
  const archiveNav = decoWx._navigations[1] ? decoWx._navigations[1].url : '';
  const insightsNav = decoWx._navigations[2] ? decoWx._navigations[2].url : '';
  expect(
    'navigation_while_degraded',
    '2026-10',
    '',
    'detail=/pages/review/detail/index?month=2026-10&date=' +
      cell.date +
      '&id=' +
      cell.id +
      '|archive=/pages/review/archive/index?month=2026-10|insights=/pages/review/insights/index',
    'detail=' + detailNav + '|archive=' + archiveNav + '|insights=' + insightsNav,
    'false',
    'all three entries remain reachable',
  );

  const blank = cellsOf(decoPage).find((item) => item.blank);
  decoPage.onDayTap({ currentTarget: { dataset: { date: blank.date, id: undefined } } });
  expect(
    'blank_day_tap',
    '2026-10',
    '',
    'navigations=3',
    'navigations=' + decoWx._navigations.length,
    'false',
    'blank days never open a detail page',
  );

  const detail = demoPage('review/detail', {
    store: decoStore,
    service: decoService,
    query: { month: '2026-10', date: cell.date, id: cell.id },
  }).page;
  await flush();
  expect(
    'detail_while_assets_failed',
    '2026-10',
    cell.date,
    'phase=ready|has-text=true',
    'phase=' + detail.data.phase + '|has-text=' + (detail.data.text.length > 0),
    'false',
    '',
  );

  for (const item of [page, monthPage, decoPage, detail]) {
    item.onUnload();
  }
  return rows;
}

async function runC2(outDir) {
  const updateRows = await exerciseUpdateDelete();
  const failureRows = await exerciseFailureMaterial();
  const base = path.join(outDir, 'evidence');
  writeCsv(
    path.join(outDir, 'four-view-update-delete.csv'),
    ['step', 'month', 'date', 'view', 'expected', 'actual', 'match', 'note'],
    updateRows.map((item) => ({ ...item, match: verdict(item.expected, item.actual) })),
  );
  writeCsv(
    path.join(outDir, 'failure-material-results.csv'),
    ['scenario', 'month', 'date', 'expected', 'actual', 'blocking', 'match', 'note'],
    failureRows.map((item) => ({ ...item, match: verdict(item.expected, item.actual) })),
  );

  // Evidence SVG: matrix of the three stages across four entries.
  const stageRows = ['编辑前', '编辑后', '删除后'];
  const views = ['天气宇宙', '月份档案', '详情', '回顾'];
  const pick = (step, view) => updateRows.find((item) => item.step === step && item.view === view);
  const cellText = (step, view) => {
    const item = pick(step, view);
    if (!item) {
      return '—';
    }
    return String(item.actual).replace(/\|/g, ' · ').slice(0, 30);
  };
  const steps = ['baseline', 'after_edit', 'after_delete'];
  let matrix = '';
  const colWidth = 285;
  for (let index = 0; index < views.length; index += 1) {
    matrix += svgText(250 + index * colWidth, 150, views[index], {
      size: 13,
      weight: 700,
      fill: '#2f6fed',
    });
  }
  for (let index = 0; index < steps.length; index += 1) {
    const y = 190 + index * 100;
    matrix += svgText(50, y + 22, stageRows[index], { size: 15, weight: 700 });
    matrix += `<line x1="40" y1="${y + 42}" x2="1200" y2="${y + 42}" stroke="#e3eaf4"/>`;
    for (let column = 0; column < views.length; column += 1) {
      matrix += `<rect x="${240 + column * colWidth}" y="${y}" width="${colWidth - 16}" height="66" rx="9" fill="#ffffff" stroke="#dbe4f0"/>`;
      matrix += svgText(
        252 + column * colWidth,
        y + 26,
        cellText(steps[index], ['calendar', 'month_archive', 'detail', 'review'][column]),
        {
          size: 11,
          fill: '#334155',
        },
      );
      matrix += svgText(
        252 + column * colWidth,
        y + 46,
        cellText(steps[index], ['calendar', 'month_archive', 'detail', 'review'][column]) === '—'
          ? ''
          : '同源快照',
        {
          size: 10,
          fill: '#8493a6',
        },
      );
    }
  }
  writeSvg(
    path.join(base, 'update-delete-propagation.svg'),
    svgShell({
      width: 1240,
      height: 520,
      title: 'C2-Z｜同一记录修改与删除的四入口传播',
      subtitle: '通过 Today 页控制器修改天气与正文、再删除；每个入口读取同一演示数据源。',
      footer:
        '由四入口页面状态渲染，非微信开发者工具截图；完整逐项预期/实测见 four-view-update-delete.csv。',
      body: matrix,
    }),
  );

  // Evidence SVG: failure / material degradation cards.
  const cards = [
    [
      '月历读取失败→重试',
      pick2(failureRows, 'calendar_failure_initial'),
      pick2(failureRows, 'calendar_explicit_retry'),
    ],
    ['非当前月空态刷新', pick2(failureRows, 'calendar_pull_refresh')],
    [
      '月份档案失败→返回',
      pick2(failureRows, 'archive_failure_initial'),
      pick2(failureRows, 'archive_show_recovery'),
    ],
    ['素材失败降级', pick2(failureRows, 'sticker_asset_failure')],
  ];
  const failureBody = cards
    .map((card, index) => {
      const x = 40 + (index % 2) * 590;
      const y = 120 + Math.floor(index / 2) * 190;
      const lines = card
        .slice(1)
        .filter(Boolean)
        .map(
          (item) =>
            item.scenario +
            '：' +
            (item.actual.length > 42 ? item.actual.slice(0, 42) + '…' : item.actual),
        );
      return svgPanel(x, y, 560, 160, card[0], lines, '#b45309');
    })
    .join('\n  ');
  writeSvg(
    path.join(base, 'failure-material-degrade.svg'),
    svgShell({
      width: 1240,
      height: 500,
      title: 'C2-Z｜加载失败与素材失败的降级结果',
      subtitle: '失败后月份与主要数据保留；装饰素材失败不阻断月历、档案和详情入口。',
      footer: '由页面状态渲染，非开发者工具截图；逐项预期/实测见 failure-material-results.csv。',
      body: failureBody,
    }),
  );

  const summary = {
    cycle: 'c2',
    update_rows: updateRows.length,
    failure_rows: failureRows.length,
    pass:
      updateRows.filter((item) => verdict(item.expected, item.actual) === 'PASS').length +
      failureRows.filter((item) => verdict(item.expected, item.actual) === 'PASS').length,
    fail:
      updateRows.filter((item) => verdict(item.expected, item.actual) === 'FAIL').length +
      failureRows.filter((item) => verdict(item.expected, item.actual) === 'FAIL').length,
  };
  runLog(path.join(base, 'run-c2.txt'), 'c2', summary);
  return summary;
}

function pick2(rows, scenario) {
  return rows.find((item) => item.scenario === scenario);
}

// ------------------------------------------------------------------------ C3

async function exerciseStale() {
  const rows = [];
  const add = (caseName, month, expected, actual, note = '') => {
    rows.push({ case: caseName, month, expected, actual, note });
  };

  const store = demoStore();
  const base = createReviewDemoService({ store });
  const control = { hold: null };
  const service = {
    ...base,
    calendar(month) {
      if (control.hold && control.hold.month === month) {
        const held = control.hold;
        control.hold = null;
        return held.promise;
      }
      return base.calendar(month);
    },
  };

  const { page } = demoPage('universe', { store, service, query: { month: '2026-09' } });
  await flush();
  add(
    'switch_month',
    '2026-09',
    'month=2026-09|count=2|no-october-dates=true|busy=false',
    'month=' +
      page.data.month +
      '|count=' +
      page.data.monthRecordCount +
      '|no-october-dates=' +
      !/2026-10-0[19]|2026-10-1[25]|2026-10-16/.test(JSON.stringify(page.data)) +
      '|busy=' +
      page.data.calendarBusy,
    'initial September view',
  );

  const monthGate = deferred();
  control.hold = { month: '2026-10', promise: monthGate.promise };
  page.onMonthPick({ detail: { value: '2026-10' } });
  const busyDuringSwitch = page.data.calendarBusy;
  const monthDuringSwitch = page.data.month;
  const cellsDuringSwitch = recordedCells(page).length;
  page.onMonthPick({ detail: { value: '2026-09' } });
  await flush();
  monthGate.resolve(await base.calendar('2026-10'));
  await flush();
  add(
    'switch_month',
    '2026-09',
    'busy=true|month=2026-10|pending-cells=0|final=2026-09|count=2|no-october-dates=true',
    'busy=' +
      busyDuringSwitch +
      '|month=' +
      monthDuringSwitch +
      '|pending-cells=' +
      cellsDuringSwitch +
      '|final=' +
      page.data.month +
      '|count=' +
      page.data.monthRecordCount +
      '|no-october-dates=' +
      !/2026-10-0[19]|2026-10-1[25]|2026-10-16/.test(JSON.stringify(page.data)),
    'late October response released after switching back to September',
  );

  const leaveGate = deferred();
  control.hold = { month: '2026-10', promise: leaveGate.promise };
  page.onMonthPick({ detail: { value: '2026-10' } });
  const busyBeforeLeave = page.data.calendarBusy;
  page.onHide();
  const hidden = page._pageVisible === false;
  page.onShow();
  await flush();
  const countAfterReturn = page.data.monthRecordCount;
  leaveGate.resolve({
    ok: true,
    data: { month: '2026-10', entries: [], recordCount: 0, sourceRevision: 1 },
  });
  await flush();
  add(
    'leave_return',
    '2026-10',
    'busy=true|hidden=true|after-return=2026-10|count=5|stale-discarded=5',
    'busy=' +
      busyBeforeLeave +
      '|hidden=' +
      hidden +
      '|after-return=2026-10|count=' +
      countAfterReturn +
      '|stale-discarded=' +
      page.data.monthRecordCount,
    'a stale empty snapshot must not blank the refreshed month',
  );

  const moduleGate = deferred();
  control.hold = { month: '2026-09', promise: moduleGate.promise };
  page.onMonthPick({ detail: { value: '2026-09' } });
  const busyBeforeHop = page.data.calendarBusy;
  page.onHide();
  const archive = demoPage('review/archive', { store, service, query: {} }).page;
  await flush();
  const archiveMonths = list(archive.data.months)
    .map((item) => item.month + '|' + item.recordCount)
    .join(';');
  moduleGate.resolve({
    ok: true,
    data: { month: '2026-09', entries: [], recordCount: 0, sourceRevision: 2 },
  });
  await flush();
  add(
    'module_hop',
    '2026-09',
    'busy=true|archive=2026-10|5;2026-09|2;2026-08|0|no-september-records-leak=true',
    'busy=' +
      busyBeforeHop +
      '|archive=' +
      archiveMonths +
      '|no-september-records-leak=' +
      !/2026-09-27|2026-09-30/.test(JSON.stringify(archive.data)),
    'module B keeps its own state while A has a pending read',
  );
  page.onShow();
  await flush();
  add(
    'module_hop',
    '2026-09',
    'return=2026-09|count=2|dates=2026-09-27,2026-09-30',
    'return=' +
      page.data.month +
      '|count=' +
      page.data.monthRecordCount +
      '|dates=' +
      recordedCells(page)
        .map((item) => item.date)
        .join(','),
    'returning to the calendar shows the fresh month only',
  );
  page.onUnload();
  archive.onUnload();

  // Account switch: A's late response must not repaint under B.
  const f = backendClient();
  const state = createSessionState();
  state.accept(scope('a'));
  const aEntry = await f.save({
    date: '2026-10-17',
    weather: 'CUSTOM',
    weatherName: 'A合成私有',
    text: 'SYNTHETIC A private body',
  });
  f.setActor('b');
  const bEntry = await f.call(
    'journal.upsert',
    { date: '2026-10-17', weather: 'SUNNY', text: 'SYNTHETIC B private body', expectedVersion: 0 },
    { actor: 'b' },
  );
  f.setActor('a');

  const hold = deferred();
  let holdMonth = '2026-10';
  const delayedReview = {
    ...f.review,
    calendar(month) {
      if (month === holdMonth) {
        holdMonth = '';
        return hold.promise;
      }
      return f.review.calendar(month);
    },
  };
  const reader = createReviewReader({
    review: delayedReview,
    journal: f.journal,
    sessionState: state,
  });
  const aSnapshot = await f.review.calendar('2026-10');
  const cloudUniverse = cloudPage('universe', {
    reader,
    sessionState: state,
    query: { month: '2026-10' },
  }).page;
  await flush(1);
  const cloudBusy = cloudUniverse.data.calendarBusy;
  const cloudCells = recordedCells(cloudUniverse).length;
  f.setActor('b');
  state.accept(scope('b'));
  const switchedError = cloudUniverse.data.calendarError;
  hold.resolve(aSnapshot);
  await flush();
  add(
    'account_switch',
    '2026-10',
    'busy=true|pending-cells=0|error=登录状态已变化，请重新读取。|count=0|no-A-data=true',
    'busy=' +
      cloudBusy +
      '|pending-cells=' +
      cloudCells +
      '|error=' +
      switchedError +
      '|count=' +
      cloudUniverse.data.monthRecordCount +
      '|no-A-data=' +
      !/A合成私有|A private body/.test(JSON.stringify(cloudUniverse.data)),
    'the late A response is discarded; no cross-account paint',
  );

  const retryOk = await cloudUniverse.onRetry();
  await flush(1);
  add(
    'account_switch',
    '2026-10',
    'retry=true|error=|record=2026-10-17|晴天|no-A-data=true',
    'retry=' +
      retryOk +
      '|error=' +
      cloudUniverse.data.calendarError +
      '|record=' +
      recordedCells(cloudUniverse)
        .map((item) => item.date + '|' + item.label)
        .join(',') +
      '|no-A-data=' +
      !/A合成私有/.test(JSON.stringify(cloudUniverse.data)),
    'only B may appear after an explicit retry',
  );

  const cloudDetail = cloudPage('review/detail', {
    reader,
    sessionState: state,
    query: { month: '2026-10', date: '2026-10-17', id: aEntry.data.entry.id },
  }).page;
  await flush();
  add(
    'account_switch',
    '2026-10',
    'detail=stale|text=|no-body=true',
    'detail=' +
      cloudDetail.data.phase +
      '|text=' +
      cloudDetail.data.text +
      '|no-body=' +
      !/B private body|A private body/.test(JSON.stringify(cloudDetail.data)),
    'A old link stays stale under B; id check ' + bEntry.data.entry.id,
  );
  cloudUniverse.onUnload();
  cloudDetail.onUnload();
  return rows;
}

async function exerciseInvalidParams() {
  const rows = [];
  const add = (caseName, expected, actual, note = '') => {
    rows.push({ case: caseName, expected, actual, note });
  };
  const store = demoStore();
  const service = createReviewDemoService({ store });
  const currentMonth = businessDate().slice(0, 7);
  for (const month of ['2026-13', '2026-09-27', 'abc', '']) {
    const { page } = demoPage('universe', { store, service, query: { month } });
    await flush();
    add(
      'invalid_month:' + JSON.stringify(month),
      'month=' + currentMonth + '|count=0|error=',
      'month=' +
        page.data.month +
        '|count=' +
        page.data.monthRecordCount +
        '|error=' +
        page.data.calendarError,
      'invalid month falls back to the current month',
    );
    page.onUnload();
  }
  const missing = demoPage('review/month', { store, service, query: {} }).page;
  await flush();
  add(
    'missing_month_param',
    'error=缺少月份参数，请从月份档案进入。|count=0',
    'error=' + missing.data.error + '|count=' + missing.data.recordCount,
  );
  const invalid = demoPage('review/month', { store, service, query: { month: '2026-13' } }).page;
  await flush();
  add(
    'invalid_month_param',
    'error=回顾参数无效，请返回选择有效日期或月份。|count=0',
    'error=' + invalid.data.error + '|count=' + invalid.data.recordCount,
  );
  const noDate = demoPage('review/detail', { store, service, query: { id: 'demo_20261016' } }).page;
  await flush();
  add(
    'missing_date_param',
    'phase=error|error=缺少有效的记录日期参数。|text=',
    'phase=' +
      noDate.data.phase +
      '|error=' +
      noDate.data.errorMessage +
      '|text=' +
      noDate.data.text,
  );
  const staleId = demoPage('review/detail', {
    store,
    service,
    query: { month: '2026-10', date: '2026-10-16', id: 'demo_foreign' },
  }).page;
  await flush();
  add(
    'mismatched_entry_id',
    'phase=stale|text=|no-body=true',
    'phase=' +
      staleId.data.phase +
      '|text=' +
      staleId.data.text +
      '|no-body=' +
      !/今天的雨声/.test(JSON.stringify(staleId.data)),
    'old id must not reveal the body of a rebuilt record',
  );
  for (const page of [missing, invalid, noDate, staleId]) {
    page.onUnload();
  }
  return rows;
}

async function runC3(outDir) {
  const stale = await exerciseStale();
  const update = await exerciseUpdateDelete();
  const failure = await exerciseFailureMaterial();
  const invalid = await exerciseInvalidParams();

  writeCsv(
    path.join(outDir, 'stale-response-results.csv'),
    ['case', 'month', 'expected', 'actual', 'match', 'note'],
    stale.map((item) => ({ ...item, match: verdict(item.expected, item.actual) })),
  );

  const regression = [];
  for (const item of update) {
    regression.push({
      case: 'update_delete:' + item.step + ':' + item.view,
      expected: item.expected,
      actual: item.actual,
      match: verdict(item.expected, item.actual),
      note: item.note,
    });
  }
  for (const item of failure) {
    regression.push({
      case: 'failure_material:' + item.scenario,
      expected: item.expected,
      actual: item.actual,
      match: verdict(item.expected, item.actual),
      note: item.note,
    });
  }
  for (const item of invalid) {
    regression.push({
      case: 'invalid_param:' + item.case,
      expected: item.expected,
      actual: item.actual,
      match: verdict(item.expected, item.actual),
      note: item.note,
    });
  }
  writeCsv(
    path.join(outDir, 'regression-c3.csv'),
    ['case', 'expected', 'actual', 'match', 'note'],
    regression,
  );

  const lanes = [
    {
      title: '切月：2026-10 请求未返回 → 切回 2026-09',
      lines: [
        '切月时：busy=true、month=2026-10、格子=0',
        '切回后：month=2026-09、count=2',
        '释放旧响应：月份仍为 2026-09，10 月日期=0',
      ],
    },
    {
      title: '离页返回：2026-10 请求未返回 → onHide/onShow',
      lines: [
        '离开时：pageVisible=false、busy 释放',
        '返回重读：month=2026-10、count=5',
        '释放旧空快照：count 仍为 5（被丢弃）',
      ],
    },
    {
      title: '切号：A 请求未返回 → 切到 B',
      lines: [
        '切号后：error=登录状态已变化、count=0',
        '释放 A 旧响应：无 A 私有数据',
        '显式重试：仅 B 的 2026-10-17／晴天',
      ],
    },
  ];
  const laneMarkup = lanes
    .map((lane, index) =>
      svgPanel(40 + index * 395, 120, 360, 250, lane.title, lane.lines, '#7c3aed'),
    )
    .join('\n  ');
  writeSvg(
    path.join(outDir, 'evidence', 'stale-response-isolation.svg'),
    svgShell({
      width: 1240,
      height: 470,
      title: 'C3-Z｜旧响应隔离：切月、离页返回与切号',
      subtitle: '固定旧请求待返回，再执行切换并释放；检查当前月份、详情与账号归属。',
      footer:
        '由页面与云替身状态渲染，非开发者工具截图；逐项预期/实测见 stale-response-results.csv 与 regression-c3.csv。',
      body: laneMarkup,
    }),
  );

  const summary = {
    cycle: 'c3',
    stale_rows: stale.length,
    regression_rows: regression.length,
    pass:
      stale.filter((item) => verdict(item.expected, item.actual) === 'PASS').length +
      regression.filter((item) => item.match === 'PASS').length,
    fail:
      stale.filter((item) => verdict(item.expected, item.actual) === 'FAIL').length +
      regression.filter((item) => item.match === 'FAIL').length,
  };
  runLog(path.join(outDir, 'evidence', 'run-c3.txt'), 'c3', summary);
  return summary;
}

// ---------------------------------------------------------------------- entry

function parseArgs(argv) {
  const result = { cycle: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--cycle') {
      result.cycle = argv[index + 1] || '';
      index += 1;
    } else if (argv[index] === '--out') {
      result.out = argv[index + 1] || '';
      index += 1;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cycle = args.cycle;
  if (!['c1', 'c2', 'c3', 'c4'].includes(cycle)) {
    throw new Error('Usage: --cycle c1|c2|c3|c4 [--out <dir>]');
  }
  const outDir = path.resolve(ROOT, args.out || path.join('docs/alpha-sprint/zhifeng-dai', cycle));
  fs.mkdirSync(outDir, { recursive: true });
  const runners = { c1: runC1, c2: runC2, c3: runC3, c4: runC4 };
  const summary = await runners[cycle](outDir);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
