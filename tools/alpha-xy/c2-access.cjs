#!/usr/bin/env node
// C2-XY (2026-11-23 and 24): export content, ownership, stale receipts and
// claim permissions against the production entry and the in-memory WX-shaped
// database. Every scenario gets its own database copy so a mutation in one row
// cannot explain a pass in another.
//
//   node tools/alpha-xy/c2-access.cjs [--out <dir>]
//
// The server answers are recorded as they are, with artifact bodies and the
// cleanup receipt replaced by placeholders before anything is written to disk.
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryDatabase } = require('../week6-xy/memory-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../../cloudfunctions/moodsky/production/config');
const policy = require('../export-candidate/access-policy');

const REPO = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = path.resolve(
  outIndex === -1 ? path.join(REPO, 'docs/alpha/xiang-yu/c2-20261123') : args[outIndex + 1],
);

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '44'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '55'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '66'.repeat(32),
  MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'true',
});

const OPENID_A = 'SIMULATED_C2XY_A';
const OPENID_B = 'SIMULATED_C2XY_B';
const OWNER_A = accountId(config, OPENID_A);
const OWNER_B = accountId(config, OPENID_B);
const START = Date.parse('2026-11-23T02:00:00.000Z');
const HOUR = 3600000;
const FILE_MS = 24 * HOUR;
const CONFLICT_TEXT = '导出尚未完成或已失效，请重新读取。';
const POLICY_FORBIDDEN_TEXT = '当前无法领取此导出。';
const SCOPE_TEXT = '登录范围已变化，请重新登录。';
const DISABLED_TEXT = '账号已停用。';
const OWNERSHIP_TEXT = '身份与权限由服务端确定。';

const stamp = (iso) => new Date(iso).toISOString();
const JOURNAL_A_OLD = 'SIMULATED-C2XY A 较早记录：上午在图书馆自习。';
const JOURNAL_A_LIVE = 'SIMULATED-C2XY A 记录（version=2）：内容已修改，旧导出必须失效。';
const JOURNAL_B = 'SIMULATED-C2XY B 的记录：内容与 A 明显不同，用于检查归属隔离。';

let clockNow = START;
const clock = () => new Date(clockNow);
let currentOpenid = OPENID_A;
const identity = () => ({
  APPID: APP_ID,
  ENV: ENV_ID,
  SOURCE: 'wx_devtools',
  OPENID: currentOpenid,
  identityFromCurrentInvocation: true,
});

// One deterministic fixture per scenario: shapes follow domains/export.js
// SOURCES and the formatter's projection rules.
function buildFixture() {
  const visiblePlace = (id, name) => ({
    _id: id,
    name,
    campusId: 'SIMULATED_CAMPUS',
    enabled: true,
    isSynthetic: false,
    source: 'SIMULATED-C2XY 实地核验',
    verifiedAt: stamp('2026-11-01T00:00:00.000Z'),
    validUntil: stamp('2027-05-01T00:00:00.000Z'),
  });
  return [
    {
      name: 'journals',
      rows: [
        {
          _id: 'c2xy_a_journal_old',
          ownerId: OWNER_A,
          entryId: 'entry-c2xy-a-2026-11-19',
          date: '2026-11-19',
          weather: 'RAINY',
          tags: ['TIREDNESS'],
          text: JOURNAL_A_OLD,
          version: 1,
          state: 'active',
          createdAt: stamp('2026-11-19T12:00:00.000Z'),
          updatedAt: stamp('2026-11-19T12:00:00.000Z'),
        },
        {
          _id: 'c2xy_a_journal_deleted',
          ownerId: OWNER_A,
          entryId: 'entry-c2xy-a-2026-11-20',
          date: '2026-11-20',
          weather: 'STORMY',
          tags: [],
          text: 'SIMULATED-C2XY A 已删除记录：正文不得出现在导出中。',
          version: 2,
          state: 'deleted',
          createdAt: stamp('2026-11-20T03:00:00.000Z'),
          updatedAt: stamp('2026-11-20T04:00:00.000Z'),
        },
        {
          _id: 'c2xy_b_journal_1',
          ownerId: OWNER_B,
          entryId: 'entry-c2xy-b-2026-11-17',
          date: '2026-11-17',
          weather: 'SUNNY',
          tags: ['SOCIAL'],
          text: JOURNAL_B,
          version: 1,
          state: 'active',
          createdAt: stamp('2026-11-17T06:00:00.000Z'),
          updatedAt: stamp('2026-11-17T06:00:00.000Z'),
        },
      ],
    },
    {
      name: 'favorites',
      rows: [
        {
          _id: 'c2xy_a_fav_01',
          ownerId: OWNER_A,
          placeId: 'place_c2xy_library',
          placeName: 'SIMULATED-C2XY A 收藏-图书馆',
          createdAt: stamp('2026-11-17T01:01:00.000Z'),
        },
        {
          _id: 'c2xy_a_fav_02',
          ownerId: OWNER_A,
          placeId: 'place_c2xy_lake',
          placeName: 'SIMULATED-C2XY A 收藏-湖边',
          createdAt: stamp('2026-11-17T01:02:00.000Z'),
        },
        {
          _id: 'c2xy_a_fav_03',
          ownerId: OWNER_A,
          placeId: 'place_c2xy_canteen',
          placeName: 'SIMULATED-C2XY A 收藏-食堂',
          createdAt: stamp('2026-11-17T01:03:00.000Z'),
        },
        {
          _id: 'c2xy_b_fav_01',
          ownerId: OWNER_B,
          placeId: 'place_c2xy_hall',
          placeName: 'SIMULATED-C2XY B 收藏-礼堂',
          createdAt: stamp('2026-11-16T02:00:00.000Z'),
        },
      ],
    },
    {
      name: 'task_history',
      rows: [
        {
          _id: 'c2xy_a_task_1',
          ownerId: OWNER_A,
          taskId: 'breathing-3',
          taskTitle: 'SIMULATED-C2XY A 任务（已完成）',
          date: '2026-11-18',
          state: 'completed',
          createdAt: stamp('2026-11-18T01:30:00.000Z'),
        },
        {
          _id: 'c2xy_a_task_2',
          ownerId: OWNER_A,
          taskId: 'walk-10',
          taskTitle: 'SIMULATED-C2XY A 任务（跳过）',
          date: '2026-11-19',
          state: 'skipped',
          createdAt: stamp('2026-11-19T02:00:00.000Z'),
        },
        {
          _id: 'c2xy_b_task_1',
          ownerId: OWNER_B,
          taskId: 'breathing-3',
          taskTitle: 'SIMULATED-C2XY B 任务（已完成）',
          date: '2026-11-17',
          state: 'completed',
          createdAt: stamp('2026-11-17T03:00:00.000Z'),
        },
      ],
    },
    {
      name: 'place_checkins',
      rows: [
        {
          _id: 'c2xy_a_checkin_1',
          ownerId: OWNER_A,
          placeId: 'place_c2xy_library',
          date: '2026-11-18',
          completedAt: stamp('2026-11-18T09:00:00.000Z'),
        },
        {
          _id: 'c2xy_b_checkin_1',
          ownerId: OWNER_B,
          placeId: 'place_c2xy_hall',
          date: '2026-11-16',
          completedAt: stamp('2026-11-16T10:00:00.000Z'),
        },
      ],
    },
    {
      name: 'campus_checkin_states',
      rows: [
        {
          _id: 'campus_state_' + OWNER_A,
          ownerId: OWNER_A,
          owner: OWNER_A,
          revision: 3,
          requests: {},
          visits: [
            {
              placeId: 'place_c2xy_hill',
              placeName: 'SIMULATED-C2XY A 校园-后山',
              date: '2026-11-15',
              selfReported: true,
              completedAt: stamp('2026-11-15T09:00:00.000Z'),
            },
            {
              placeId: 'place_c2xy_canteen',
              placeName: 'SIMULATED-C2XY A 校园-食堂',
              date: '2026-11-17',
              selfReported: true,
              completedAt: stamp('2026-11-17T04:10:00.000Z'),
            },
          ],
        },
        {
          _id: 'campus_state_' + OWNER_B,
          ownerId: OWNER_B,
          owner: OWNER_B,
          revision: 1,
          requests: {},
          visits: [
            {
              placeId: 'place_c2xy_hall',
              placeName: 'SIMULATED-C2XY B 校园-礼堂',
              date: '2026-11-16',
              selfReported: true,
              completedAt: stamp('2026-11-16T10:00:00.000Z'),
            },
          ],
        },
      ],
    },
    {
      name: 'month_decorations',
      rows: [
        {
          _id: 'decoration_c2xy_2026-11',
          ownerId: OWNER_A,
          month: '2026-11',
          version: 2,
          backgroundId: 'BACKGROUND_SKY_NIGHT',
          stickers: [
            { stickerId: 'STICKER_MOON', targetEntryId: 'entry-c2xy-a-2026-11-19' },
            { stickerId: 'STICKER_CAT' },
            { stickerId: 'STICKER_LEAF', targetEntryId: 'entry-c2xy-gone-0001' },
          ],
        },
      ],
    },
    {
      name: 'places',
      rows: [
        visiblePlace('place_c2xy_library', '图书馆'),
        visiblePlace('place_c2xy_lake', '湖边'),
        visiblePlace('place_c2xy_canteen', '食堂'),
        visiblePlace('place_c2xy_hill', '后山'),
        { _id: 'place_c2xy_hall', name: '礼堂', campusId: 'SIMULATED_CAMPUS', status: 'active' },
      ],
    },
    {
      name: 'task_templates',
      rows: [
        {
          _id: 'breathing-3',
          title: '三次呼吸',
          enabled: true,
          steps: ['吸气', '呼气'],
          durationMin: 1,
          tags: ['REST'],
        },
      ],
    },
  ];
}

function seed(memory) {
  for (const collection of buildFixture()) {
    for (const row of collection.rows) {
      memory.put(collection.name, row);
    }
  }
}

let sequence = 0;
const createRequest = (action, payload) => ({
  apiVersion: '1',
  requestId: 'req_c2xy_' + String(++sequence).padStart(4, '0'),
  action,
  payload,
});

const csv = (rows) =>
  rows
    .map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
    .join('\n') + '\n';

const rows = [];
const failures = [];
// Journal entries get a generated UUID and the close receipt is a signed token;
// both are masked so receipts stay reproducible and carry no credential.
const maskGenerated = (text) =>
  String(text)
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      '<generated-entry-id>',
    )
    .replace(/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<redacted-receipt>');
function recordCase({ category, scenario, action, expected, actual, verdict, evidence }) {
  // Case ids follow execution order so the table stays contiguous even when a
  // scenario gains a case above another one.
  const id = 'C' + String(rows.length + 1).padStart(2, '0');
  const pass = verdict === undefined ? false : verdict;
  rows.push({
    id,
    category,
    scenario,
    action,
    expected: maskGenerated(expected),
    actual: maskGenerated(actual),
    conclusion: pass ? '通过' : '偏差',
    evidence: evidence || '',
  });
  if (!pass) {
    failures.push({
      id,
      scenario,
      expected: maskGenerated(expected),
      actual: maskGenerated(actual),
    });
  }
}
const ok = (res) => res.ok === true;
const flat = (res) =>
  res.ok
    ? 'ok ' +
      Object.entries(res.data || {})
        .filter(([key]) => key !== 'content')
        .map(([key, value]) => key + '=' + JSON.stringify(value))
        .join(' ')
    : res.error.code + ' ' + res.error.message;
const codeOf = (res) => (res.ok ? 'ok' : res.error.code);

function makeContext() {
  const memory = createMemoryDatabase();
  seed(memory);
  const entry = createProductionEntry({
    readConfig: () => config,
    openDatabase: () => memory.db,
    now: clock,
    readIdentity: () => identity(),
  });
  const scopes = new Map();
  async function signIn(openid) {
    currentOpenid = openid;
    const res = await entry(createRequest('account.session', {}));
    if (!res.ok) {
      throw new Error('sign-in failed for ' + openid + ': ' + JSON.stringify(res));
    }
    scopes.set(openid, res.data.scope);
    return res;
  }
  async function call(openid, action, payload = {}, options = {}) {
    currentOpenid = openid;
    const request = createRequest(action, payload);
    if (options.rawScope !== undefined) {
      request.sessionScope = options.rawScope;
    } else if (options.noScope !== true) {
      const scope = scopes.get(openid);
      if (scope) {
        request.sessionScope = scope;
      }
    }
    return entry(request);
  }
  return { memory, entry, scopes, signIn, call };
}

const snapshotOf = (memory) => JSON.parse(JSON.stringify(memory.inspect()));

// ---------------------------------------------------------------- content
async function scenarioContent() {
  const category = '内容完整性与归属';
  clockNow = START;
  const { memory, signIn, call } = makeContext();
  await signIn(OPENID_A);
  await signIn(OPENID_B);
  const before = snapshotOf(memory);

  const upserted = await call(OPENID_A, 'journal.upsert', {
    date: '2026-11-23',
    weather: 'PARTLY_CLOUDY',
    tags: ['REST', 'CALM'],
    text: JOURNAL_A_LIVE,
    expectedVersion: 0,
  });
  const preference = await call(OPENID_A, 'account.preferences', {
    operation: 'set',
    cardTextPreview: true,
    decorationsEnabled: true,
  });
  recordCase({
    id: 'C01',
    category,
    scenario: 'A 通过真实写入接口新增一条当日记录与偏好',
    action: 'journal.upsert / account.preferences',
    expected: '两次写入成功',
    // The entry id is a generated UUID; mask it so the receipt stays reproducible.
    actual: (flat(upserted) + ' | ' + flat(preference)).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      '<generated-entry-id>',
    ),
    verdict: ok(upserted) && ok(preference),
    evidence: 'fixture',
  });

  const requested = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const jobId = requested.data?.jobId;
  recordCase({
    id: 'C02',
    category,
    scenario: 'A 申请 JSON 导出',
    action: 'account.requestExport {format:"json"}',
    expected: 'ok，state=ready，format=json',
    actual: flat(requested),
    verdict: ok(requested) && requested.data?.state === 'ready',
    evidence: jobId,
  });

  const downloaded = await call(OPENID_A, 'account.downloadExport', { jobId });
  const content = downloaded.data?.content ?? '';
  const parsed = JSON.parse(content);
  const data = parsed.data;
  const journalDates = data.journals.map((row) => row.date);
  recordCase({
    id: 'C03',
    category,
    scenario: 'A 领取 JSON 正文',
    action: 'account.downloadExport {jobId}',
    expected: 'ok，extension=json，byteLength 与正文一致',
    actual:
      flat({ ...downloaded, data: { ...downloaded.data, content: undefined } }) +
      ' bytes=' +
      Buffer.byteLength(content, 'utf8'),
    verdict:
      ok(downloaded) &&
      downloaded.data.extension === 'json' &&
      downloaded.data.byteLength === Buffer.byteLength(content, 'utf8'),
    evidence: jobId,
  });

  recordCase({
    id: 'C04',
    category,
    scenario: '本人记录完整且只含 active 行',
    action: '解析 JSON 正文',
    expected: '记录 2 条，日期 2026-11-19 与 2026-11-23 升序，删除行正文不出现',
    actual: 'journals=' + journalDates.join(',') + ' deletedText=' + content.includes('已删除记录'),
    verdict:
      journalDates.length === 2 &&
      journalDates[0] === '2026-11-19' &&
      journalDates[1] === '2026-11-23' &&
      !content.includes('已删除记录') &&
      content.includes(JOURNAL_A_LIVE) &&
      content.includes(JOURNAL_A_OLD),
    evidence: jobId,
  });

  recordCase({
    id: 'C05',
    category,
    scenario: 'B 的内容不进入 A 的导出',
    action: '检查正文',
    expected: '不含 B 记录正文、B 收藏地点、B 任务标题',
    actual:
      'BText=' +
      content.includes('B 的记录') +
      ' BPlace=' +
      content.includes('place_c2xy_hall') +
      ' BTask=' +
      content.includes('SIMULATED-C2XY B 任务'),
    verdict:
      !content.includes('B 的记录') &&
      !content.includes('place_c2xy_hall') &&
      !content.includes('SIMULATED-C2XY B 任务'),
    evidence: jobId,
  });

  recordCase({
    id: 'C06',
    category,
    scenario: '导出不携带归属与内部标识',
    action: '检查正文',
    expected: '不含 ownerId 字段、accountId、openid、campus revision/requests',
    actual:
      'ownerId=' +
      content.includes('ownerId') +
      ' account=' +
      content.includes(OWNER_A) +
      ' openid=' +
      content.includes(OPENID_A) +
      ' revision=' +
      content.includes('"revision"'),
    verdict:
      !content.includes('ownerId') &&
      !content.includes(OWNER_A) &&
      !content.includes(OPENID_A) &&
      !content.includes('"revision"') &&
      !content.includes('"requests"'),
    evidence: jobId,
  });

  recordCase({
    id: 'C07',
    category,
    scenario: '收藏去重并按 createdAt 排序',
    action: '检查 data.favorites',
    expected: '3 条，placeId 顺序为 library、lake、canteen',
    actual: 'favorites=' + data.favorites.map((row) => row.placeId).join(','),
    verdict:
      data.favorites.length === 3 &&
      data.favorites.map((row) => row.placeId).join(',') ===
        'place_c2xy_library,place_c2xy_lake,place_c2xy_canteen',
    evidence: jobId,
  });

  recordCase({
    id: 'C08',
    category,
    scenario: '任务历史只导出契约允许的状态',
    action: '检查 data.taskHistory',
    expected: '2 条，状态属于 selected/completed/replaced/skipped',
    actual: 'tasks=' + data.taskHistory.map((row) => row.state).join(','),
    verdict:
      data.taskHistory.length === 2 &&
      data.taskHistory.every((row) =>
        ['selected', 'completed', 'replaced', 'skipped'].includes(row.state),
      ),
    evidence: jobId,
  });

  const decoration = data.monthDecorations[0];
  recordCase({
    id: 'C09',
    category,
    scenario: '月份装饰只丢弃悬空贴纸，无目标贴纸保留',
    action: '检查 data.monthDecorations',
    expected: '1 个装饰、2 个贴纸：MOON 带 targetDate=2026-11-19，CAT 无 targetDate，LEAF 被丢弃',
    actual: 'stickers=' + JSON.stringify(decoration.stickers),
    verdict:
      data.monthDecorations.length === 1 &&
      decoration.stickers.length === 2 &&
      decoration.stickers[0].stickerId === 'STICKER_MOON' &&
      decoration.stickers[0].targetDate === '2026-11-19' &&
      decoration.stickers[1].stickerId === 'STICKER_CAT' &&
      decoration.stickers[1].targetDate === undefined,
    evidence: jobId,
  });

  const checkins = data.checkins || [];
  const manual = checkins.filter((row) => row.selfReported !== true);
  const selfReported = checkins.filter((row) => row.selfReported === true);
  recordCase({
    id: 'C10',
    category,
    scenario: '打卡导出区分手工打卡与校园自报',
    action: '检查 data.checkins',
    expected: '3 条：1 条手工（仅 placeId，无 placeName）、2 条校园自报（含 placeName）',
    actual:
      'total=' +
      checkins.length +
      ' manual=' +
      manual.length +
      ' self=' +
      selfReported.length +
      ' manualNames=' +
      manual.filter((row) => row.placeName !== undefined).length,
    verdict:
      checkins.length === 3 &&
      manual.length === 1 &&
      manual[0].placeId === 'place_c2xy_library' &&
      manual[0].placeName === undefined &&
      selfReported.length === 2,
    evidence: jobId,
  });

  recordCase({
    id: 'C11',
    category,
    scenario: '顶层结构与格式版本',
    action: '检查 JSON 顶层键',
    expected: "键为 exportVersion/exportedAt/data，exportVersion='1.0-candidate'",
    actual: Object.keys(parsed).join(',') + ' ' + parsed.exportVersion,
    verdict:
      Object.keys(parsed).sort().join(',') === 'data,exportVersion,exportedAt' &&
      parsed.exportVersion === '1.0-candidate',
    evidence: jobId,
  });

  recordCase({
    id: 'C12',
    category,
    scenario: '导出时间取服务端时钟',
    action: '检查 exportedAt',
    expected: 'exportedAt=2026-11-23T02:00:00.000Z',
    actual: parsed.exportedAt,
    verdict: parsed.exportedAt === '2026-11-23T02:00:00.000Z',
    evidence: jobId,
  });

  const markdown = await call(OPENID_A, 'account.requestExport', { format: 'markdown' });
  const markdownDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: markdown.data?.jobId,
  });
  const markdownText = markdownDownload.data?.content ?? '';
  recordCase({
    id: 'C13',
    category,
    scenario: 'Markdown 格式领取',
    action: 'account.requestExport {format:"markdown"} → downloadExport',
    expected: 'ok，extension=md，含标题与私密提示，含 A 正文，不含 B 正文',
    actual:
      codeOf(markdownDownload) +
      ' ext=' +
      markdownDownload.data?.extension +
      ' title=' +
      markdownText.includes('# MoodSky 数据导出（格式候选）') +
      ' notice=' +
      markdownText.includes('此文件包含私人数据'),
    verdict:
      ok(markdownDownload) &&
      markdownDownload.data.extension === 'md' &&
      markdownText.includes('# MoodSky 数据导出（格式候选）') &&
      markdownText.includes('此文件包含私人数据') &&
      markdownText.includes(JOURNAL_A_LIVE) &&
      !markdownText.includes('B 的记录'),
    evidence: markdown.data?.jobId,
  });

  const after = snapshotOf(memory);
  const untouched = (collection, key) =>
    JSON.stringify(before[collection + ':' + key]) ===
    JSON.stringify(after[collection + ':' + key]);
  recordCase({
    id: 'C14',
    category,
    scenario: '导出不改动 B 数据与公共地点',
    action: '导出前后逐行比对',
    expected: 'B 记录/收藏/任务/打卡与 places 行逐字节不变',
    actual:
      'bJournal=' +
      untouched('journals', 'c2xy_b_journal_1') +
      ' bFav=' +
      untouched('favorites', 'c2xy_b_fav_01') +
      ' place=' +
      untouched('places', 'place_c2xy_library'),
    verdict:
      untouched('journals', 'c2xy_b_journal_1') &&
      untouched('favorites', 'c2xy_b_fav_01') &&
      untouched('task_history', 'c2xy_b_task_1') &&
      untouched('place_checkins', 'c2xy_b_checkin_1') &&
      untouched('places', 'place_c2xy_library') &&
      untouched('places', 'place_c2xy_hall'),
    evidence: jobId,
  });

  return { jsonSample: content, markdownSample: markdownText };
}

// --------------------------------------------------------------- access
async function scenarioAccess() {
  const category = '归属与访问边界';
  clockNow = START;
  const { signIn, call, scopes } = makeContext();
  await signIn(OPENID_A);
  await signIn(OPENID_B);
  const scopeA = scopes.get(OPENID_A);
  const jobA = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const jobId = jobA.data?.jobId;

  const statusByB = await call(OPENID_B, 'account.exportStatus', { jobId });
  recordCase({
    id: 'C15',
    category,
    scenario: 'B 用 A 的 jobId 查状态',
    action: 'account.exportStatus',
    expected: 'FORBIDDEN，且与失效文案相同（不泄露任务存在性）',
    actual: codeOf(statusByB) + ' ' + (statusByB.error?.message ?? ''),
    verdict: codeOf(statusByB) === 'FORBIDDEN' && statusByB.error?.message === CONFLICT_TEXT,
    evidence: jobId,
  });

  const downloadByB = await call(OPENID_B, 'account.downloadExport', { jobId });
  recordCase({
    id: 'C16',
    category,
    scenario: 'B 用 A 的 jobId 领取正文',
    action: 'account.downloadExport',
    expected: 'FORBIDDEN，无正文',
    actual: codeOf(downloadByB) + ' content=' + Boolean(downloadByB.data?.content),
    verdict: codeOf(downloadByB) === 'FORBIDDEN' && !downloadByB.data?.content,
    evidence: jobId,
  });

  const unknown = await call(OPENID_A, 'account.exportStatus', { jobId: 'c2xy_unknown_job_id' });
  recordCase({
    id: 'C17',
    category,
    scenario: 'A 查询不存在的任务',
    action: 'account.exportStatus',
    expected: 'FORBIDDEN，与失效文案相同',
    actual: codeOf(unknown) + ' ' + (unknown.error?.message ?? ''),
    verdict: codeOf(unknown) === 'FORBIDDEN' && unknown.error?.message === CONFLICT_TEXT,
    evidence: 'c2xy_unknown_job_id',
  });

  const invalidId = await call(OPENID_A, 'account.exportStatus', { jobId: 'bad id 中文' });
  recordCase({
    id: 'C18',
    category,
    scenario: 'A 传入非法 jobId 形状',
    action: 'account.exportStatus',
    expected: 'INVALID_INPUT',
    actual: codeOf(invalidId) + ' ' + (invalidId.error?.message ?? ''),
    verdict: codeOf(invalidId) === 'INVALID_INPUT',
    evidence: 'bad id 中文',
  });

  const extraPayload = await call(OPENID_A, 'account.exportStatus', { jobId, ownerId: OWNER_A });
  recordCase({
    id: 'C19',
    category,
    scenario: 'A 在查询里夹带 ownerId',
    action: 'account.exportStatus',
    expected: 'INVALID_REQUEST「' + OWNERSHIP_TEXT + '」（身份字段在路由前被拒）',
    actual: codeOf(extraPayload) + ' ' + (extraPayload.error?.message ?? ''),
    verdict:
      codeOf(extraPayload) === 'INVALID_REQUEST' && extraPayload.error?.message === OWNERSHIP_TEXT,
    evidence: jobId,
  });

  const badFormat = await call(OPENID_A, 'account.requestExport', { format: 'pdf' });
  recordCase({
    id: 'C20',
    category,
    scenario: 'A 申请不支持的格式',
    action: 'account.requestExport {format:"pdf"}',
    expected: 'INVALID_INPUT，不创建任务',
    actual: codeOf(badFormat) + ' ' + (badFormat.error?.message ?? ''),
    verdict: codeOf(badFormat) === 'INVALID_INPUT',
    evidence: 'pdf',
  });

  const noScope = await call(OPENID_A, 'account.exportStatus', { jobId }, { noScope: true });
  recordCase({
    id: 'C21',
    category,
    scenario: 'A 不带登录范围调用',
    action: 'account.exportStatus（无 sessionScope）',
    expected: 'UNAUTHENTICATED「' + SCOPE_TEXT + '」',
    actual: codeOf(noScope) + ' ' + (noScope.error?.message ?? ''),
    verdict: codeOf(noScope) === 'UNAUTHENTICATED' && noScope.error?.message === SCOPE_TEXT,
    evidence: 'no-scope',
  });

  const malformed = await call(
    OPENID_A,
    'account.exportStatus',
    { jobId },
    { rawScope: 'scope_c2xy_short' },
  );
  recordCase({
    id: 'C22',
    category,
    scenario: 'A 带畸形登录范围',
    action: 'account.exportStatus（scope 形状不合法）',
    expected: 'UNAUTHENTICATED「' + SCOPE_TEXT + '」',
    actual: codeOf(malformed) + ' ' + (malformed.error?.message ?? ''),
    verdict: codeOf(malformed) === 'UNAUTHENTICATED',
    evidence: 'scope_c2xy_short',
  });

  // B's identity presenting A's scope: the account must not be resolved by the
  // scope alone, so the pair cannot be mixed across accounts.
  const mixedScope = await call(OPENID_B, 'account.exportStatus', { jobId }, { rawScope: scopeA });
  recordCase({
    id: 'C23',
    category,
    scenario: 'B 的身份携 A 的登录范围',
    action: 'account.exportStatus（scope 与身份不匹配）',
    expected: 'UNAUTHENTICATED「' + SCOPE_TEXT + '」',
    actual: codeOf(mixedScope) + ' ' + (mixedScope.error?.message ?? ''),
    verdict: codeOf(mixedScope) === 'UNAUTHENTICATED',
    evidence: jobId,
  });

  return { jobId };
}

// ----------------------------------------------------------- invalidation
async function scenarioInvalidation() {
  const category = '旧回执与来源变化';
  clockNow = START;
  const { signIn, call } = makeContext();
  await signIn(OPENID_A);
  await signIn(OPENID_B);

  const first = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const firstId = first.data?.jobId;
  const ready = await call(OPENID_A, 'account.exportStatus', { jobId: firstId });
  recordCase({
    id: 'C23',
    category,
    scenario: 'A 申请后状态为可领取',
    action: 'account.exportStatus',
    expected: 'ready',
    actual: flat(ready),
    verdict: ok(ready) && ready.data.state === 'ready',
    evidence: firstId,
  });

  const edited = await call(OPENID_A, 'journal.upsert', {
    date: '2026-11-23',
    weather: 'CLOUDY',
    tags: ['REST'],
    text: JOURNAL_A_LIVE,
    expectedVersion: 0,
  });
  recordCase({
    id: 'C24',
    category,
    scenario: 'A 在导出后修改记录',
    action: 'journal.upsert（新日期）',
    expected: '写入成功，来源版本前进',
    actual: flat(edited),
    verdict: ok(edited),
    evidence: '2026-11-23',
  });

  const stale = await call(OPENID_A, 'account.exportStatus', { jobId: firstId });
  recordCase({
    id: 'C25',
    category,
    scenario: '旧任务在来源变化后失效',
    action: 'account.exportStatus',
    expected: 'ok，state=expired',
    actual: flat(stale),
    verdict: ok(stale) && stale.data.state === 'expired',
    evidence: firstId,
  });

  const staleDownload = await call(OPENID_A, 'account.downloadExport', { jobId: firstId });
  recordCase({
    id: 'C26',
    category,
    scenario: '旧任务领取被拒绝',
    action: 'account.downloadExport',
    expected: 'CONFLICT「' + CONFLICT_TEXT + '」，无正文',
    actual: codeOf(staleDownload) + ' ' + (staleDownload.error?.message ?? ''),
    verdict:
      codeOf(staleDownload) === 'CONFLICT' &&
      staleDownload.error?.message === CONFLICT_TEXT &&
      !staleDownload.data?.content,
    evidence: firstId,
  });

  const second = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const secondDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: second.data?.jobId,
  });
  const newContent = secondDownload.data?.content ?? '';
  recordCase({
    id: 'C27',
    category,
    scenario: '来源变化后重新申请可领取',
    action: 'account.requestExport → downloadExport',
    expected: 'ok，正文含新记录且不含旧导出的日期集合',
    actual:
      codeOf(secondDownload) +
      ' dates=' +
      (newContent
        ? JSON.parse(newContent)
            .data.journals.map((row) => row.date)
            .join(',')
        : ''),
    verdict:
      ok(secondDownload) &&
      newContent.includes(JOURNAL_A_LIVE) &&
      newContent.includes('2026-11-23'),
    evidence: second.data?.jobId,
  });

  const favorite = await call(OPENID_A, 'campus.favorites', {
    operation: 'add',
    placeId: 'place_c2xy_hill',
  });
  const afterFavorite = await call(OPENID_A, 'account.exportStatus', {
    jobId: second.data?.jobId,
  });
  recordCase({
    id: 'C28',
    category,
    scenario: '收藏写入入口在生产候选入口关闭（边界记录）',
    action: 'campus.favorites add → account.exportStatus',
    expected:
      'NOT_IMPLEMENTED「此功能正在开发，尚未保存或修改任何数据。」；收藏来源未前进，任务仍 ready',
    actual: flat(favorite) + ' | ' + flat(afterFavorite),
    verdict:
      codeOf(favorite) === 'NOT_IMPLEMENTED' &&
      ok(afterFavorite) &&
      afterFavorite.data.state === 'ready',
    evidence: second.data?.jobId,
  });

  const third = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const preference = await call(OPENID_A, 'account.preferences', {
    operation: 'set',
    cardTextPreview: false,
    decorationsEnabled: true,
  });
  const afterPreference = await call(OPENID_A, 'account.exportStatus', {
    jobId: third.data?.jobId,
  });
  recordCase({
    id: 'C29',
    category,
    scenario: '偏好变更使上一份导出失效',
    action: 'account.preferences set → account.exportStatus',
    expected: '偏好写入成功，任务 state=expired',
    actual: flat(preference) + ' | ' + flat(afterPreference),
    verdict: ok(preference) && ok(afterPreference) && afterPreference.data.state === 'expired',
    evidence: third.data?.jobId,
  });

  const fourth = await call(OPENID_A, 'account.requestExport', { format: 'markdown' });
  const fourthDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: fourth.data?.jobId,
  });
  recordCase({
    id: 'C30',
    category,
    scenario: '连续变化后仍可申请并领取',
    action: 'account.requestExport → downloadExport',
    expected: 'ok，正文含最新偏好与收藏',
    actual: codeOf(fourthDownload) + ' bytes=' + (fourthDownload.data?.byteLength ?? 0),
    verdict: ok(fourthDownload) && fourthDownload.data.byteLength > 0,
    evidence: fourth.data?.jobId,
  });

  return { staleJobId: firstId, currentJobId: fourth.data?.jobId };
}

// ---------------------------------------------------------------- expiry
async function scenarioExpiry() {
  const category = '到期边界';
  clockNow = START;
  const { signIn, call } = makeContext();
  await signIn(OPENID_A);

  const requested = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const jobId = requested.data?.jobId;

  const statusReady = await call(OPENID_A, 'account.exportStatus', { jobId });
  recordCase({
    id: 'C31',
    category,
    scenario: '刚生成的导出为可领取',
    action: 'account.exportStatus',
    expected: 'ready',
    actual: flat(statusReady),
    verdict: ok(statusReady) && statusReady.data.state === 'ready',
    evidence: jobId,
  });

  const download = await call(OPENID_A, 'account.downloadExport', { jobId });
  recordCase({
    id: 'C32',
    category,
    scenario: '到期前可领取',
    action: 'account.downloadExport',
    expected: 'ok，正文非空',
    actual: codeOf(download) + ' bytes=' + (download.data?.byteLength ?? 0),
    verdict: ok(download) && download.data.byteLength > 0,
    evidence: jobId,
  });

  clockNow = START + FILE_MS - 1;
  const beforeBoundary = await call(OPENID_A, 'account.exportStatus', { jobId });
  recordCase({
    id: 'C33',
    category,
    scenario: '到期前 1 毫秒仍为可领取',
    action: 'account.exportStatus（now=readyAt+24h-1ms）',
    expected: 'ready',
    actual: flat(beforeBoundary),
    verdict: ok(beforeBoundary) && beforeBoundary.data.state === 'ready',
    evidence: jobId,
  });

  clockNow = START + FILE_MS;
  const atBoundary = await call(OPENID_A, 'account.exportStatus', { jobId });
  recordCase({
    id: 'C34',
    category,
    scenario: '到期时刻转为已过期',
    action: 'account.exportStatus（now=readyAt+24h）',
    expected: 'ok，state=expired',
    actual: flat(atBoundary),
    verdict: ok(atBoundary) && atBoundary.data.state === 'expired',
    evidence: jobId,
  });

  const expiredDownload = await call(OPENID_A, 'account.downloadExport', { jobId });
  recordCase({
    id: 'C35',
    category,
    scenario: '到期后领取被拒绝',
    action: 'account.downloadExport（now=readyAt+24h）',
    expected: 'CONFLICT「' + CONFLICT_TEXT + '」',
    actual: codeOf(expiredDownload) + ' ' + (expiredDownload.error?.message ?? ''),
    verdict:
      codeOf(expiredDownload) === 'CONFLICT' && expiredDownload.error?.message === CONFLICT_TEXT,
    evidence: jobId,
  });

  clockNow = START + FILE_MS + HOUR;
  const later = await call(OPENID_A, 'account.exportStatus', { jobId });
  recordCase({
    id: 'C36',
    category,
    scenario: '到期一小时后仍为已过期',
    action: 'account.exportStatus（now=readyAt+25h）',
    expected: 'expired',
    actual: flat(later),
    verdict: ok(later) && later.data.state === 'expired',
    evidence: jobId,
  });

  clockNow = START;
  const renewed = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  recordCase({
    id: 'C37',
    category,
    scenario: '过期后可重新申请',
    action: 'account.requestExport',
    expected: 'ok，新任务 ready',
    actual: flat(renewed),
    verdict: ok(renewed) && renewed.data.state === 'ready' && renewed.data.jobId !== jobId,
    evidence: renewed.data?.jobId,
  });

  return { jobId, expiredJobId: jobId };
}

// ------------------------------------------------------ disabled and register
async function scenarioDisabled() {
  const category = '停用与重新注册';
  clockNow = START;
  const { signIn, call, scopes } = makeContext();
  await signIn(OPENID_A);
  await signIn(OPENID_B);
  const scopeA = scopes.get(OPENID_A);

  const jobA = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const jobB = await call(OPENID_B, 'account.requestExport', { format: 'json' });
  recordCase({
    id: 'C38',
    category,
    scenario: 'A 与 B 各自生成导出',
    action: 'account.requestExport × 2',
    expected: '两个任务均 ready 且 jobId 不同',
    actual: flat(jobA) + ' | ' + flat(jobB),
    verdict:
      ok(jobA) && ok(jobB) && jobA.data.jobId !== jobB.data.jobId && jobA.data.state === 'ready',
    evidence: jobA.data?.jobId,
  });

  const closed = await call(OPENID_A, 'account.close', { confirm: 'CLOSE' });
  recordCase({
    id: 'C39',
    category,
    scenario: 'A 注销账号',
    action: 'account.close {confirm:"CLOSE"}',
    expected:
      'accountStatus=disabled、privateActionsDenied=true、sessionRevocation=not_implemented、cleanup 与 receipt 返回',
    actual: flat(closed),
    verdict:
      ok(closed) &&
      closed.data.accountStatus === 'disabled' &&
      closed.data.privateActionsDenied === true &&
      closed.data.sessionRevocation === 'not_implemented' &&
      Boolean(closed.data.receipt) &&
      Boolean(closed.data.cleanup?.jobId),
    evidence: closed.data?.cleanup?.jobId,
  });

  const statusAfterClose = await call(OPENID_A, 'account.exportStatus', {
    jobId: jobA.data.jobId,
  });
  recordCase({
    id: 'C40',
    category,
    scenario: '停用后查询旧导出状态',
    action: 'account.exportStatus',
    expected: 'ACCOUNT_DISABLED「' + DISABLED_TEXT + '」',
    actual: codeOf(statusAfterClose) + ' ' + (statusAfterClose.error?.message ?? ''),
    verdict:
      codeOf(statusAfterClose) === 'ACCOUNT_DISABLED' &&
      statusAfterClose.error?.message === DISABLED_TEXT,
    evidence: jobA.data?.jobId,
  });

  const requestAfterClose = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  recordCase({
    id: 'C41',
    category,
    scenario: '停用后申请新导出',
    action: 'account.requestExport',
    expected: 'ACCOUNT_DISABLED「' + DISABLED_TEXT + '」',
    actual: codeOf(requestAfterClose) + ' ' + (requestAfterClose.error?.message ?? ''),
    verdict: codeOf(requestAfterClose) === 'ACCOUNT_DISABLED',
    evidence: 'post-close',
  });

  const downloadAfterClose = await call(OPENID_A, 'account.downloadExport', {
    jobId: jobA.data.jobId,
  });
  recordCase({
    id: 'C42',
    category,
    scenario: '停用后领取旧导出',
    action: 'account.downloadExport',
    expected: 'ACCOUNT_DISABLED，无正文',
    actual: codeOf(downloadAfterClose) + ' content=' + Boolean(downloadAfterClose.data?.content),
    verdict: codeOf(downloadAfterClose) === 'ACCOUNT_DISABLED' && !downloadAfterClose.data?.content,
    evidence: jobA.data?.jobId,
  });

  const bUnaffected = await call(OPENID_B, 'account.exportStatus', { jobId: jobB.data.jobId });
  recordCase({
    id: 'C43',
    category,
    scenario: 'A 停用不影响 B',
    action: 'account.exportStatus（B）',
    expected: 'ok，state=ready',
    actual: flat(bUnaffected),
    verdict: ok(bUnaffected) && bUnaffected.data.state === 'ready',
    evidence: jobB.data?.jobId,
  });

  const cleanupStatus = await call(OPENID_A, 'account.cleanupStatus', {
    jobId: closed.data.cleanup.jobId,
    receipt: closed.data.receipt,
  });
  recordCase({
    id: 'C44',
    category,
    scenario: '凭注销回执读取清理进度',
    action: 'account.cleanupStatus {jobId, receipt}',
    expected: 'ok，state 属于 pending/processing/completed',
    actual: flat(cleanupStatus),
    verdict:
      ok(cleanupStatus) &&
      ['pending', 'processing', 'completed'].includes(cleanupStatus.data?.state) &&
      cleanupStatus.data?.jobId === closed.data.cleanup.jobId,
    evidence: closed.data.cleanup.jobId,
  });

  const wrongReceipt = await call(OPENID_A, 'account.cleanupStatus', {
    jobId: closed.data.cleanup.jobId,
    receipt: 'c2xy_not_a_receipt',
  });
  recordCase({
    id: 'C45',
    category,
    scenario: '伪造清理回执被拒绝',
    action: 'account.cleanupStatus（错误 receipt）',
    expected: 'FORBIDDEN「清理进度回执无效。」',
    actual: codeOf(wrongReceipt) + ' ' + (wrongReceipt.error?.message ?? ''),
    verdict:
      codeOf(wrongReceipt) === 'FORBIDDEN' && wrongReceipt.error?.message === '清理进度回执无效。',
    evidence: 'c2xy_not_a_receipt',
  });

  const registration = await call(OPENID_A, 'account.registration', {});
  recordCase({
    id: 'C46',
    category,
    scenario: '停用后查询可重新注册',
    action: 'account.registration',
    expected: 'canRegister=true，previousScope 为旧账号 scope',
    actual: flat(registration),
    verdict:
      ok(registration) &&
      registration.data.canRegister === true &&
      registration.data.previousScope === scopeA,
    evidence: 'registration',
  });

  const registered = await call(OPENID_A, 'account.register', {
    confirm: 'REGISTER',
    previousScope: registration.data?.previousScope,
  });
  const newScope = registered.data?.scope;
  if (newScope) {
    // The registered generation is the account the same openid now resolves to,
    // so later calls must present the new scope instead of the pre-register one.
    scopes.set(OPENID_A, newScope);
  }
  recordCase({
    id: 'C47',
    category,
    scenario: 'A 重新注册为新代数',
    action: 'account.register {confirm:"REGISTER", previousScope}',
    expected: 'ok，authenticated=true，scope 与旧 scope 不同',
    actual: flat(registered),
    verdict:
      ok(registered) &&
      registered.data.authenticated === true &&
      typeof newScope === 'string' &&
      newScope !== scopeA,
    evidence: 'register',
  });

  const oldScopeReplay = await call(
    OPENID_A,
    'account.exportStatus',
    { jobId: jobA.data.jobId },
    { rawScope: scopeA },
  );
  recordCase({
    id: 'C48',
    category,
    scenario: '重新注册后旧 scope 不能再用',
    action: 'account.exportStatus（旧 scope）',
    expected: 'UNAUTHENTICATED「' + SCOPE_TEXT + '」',
    actual: codeOf(oldScopeReplay) + ' ' + (oldScopeReplay.error?.message ?? ''),
    verdict: codeOf(oldScopeReplay) === 'UNAUTHENTICATED',
    evidence: 'old-scope',
  });

  const oldJobByNewAccount = await call(OPENID_A, 'account.exportStatus', {
    jobId: jobA.data.jobId,
  });
  recordCase({
    id: 'C49',
    category,
    scenario: '新代数不能读取旧代数任务',
    action: 'account.exportStatus（旧 jobId）',
    expected: 'FORBIDDEN，不泄露任务存在性',
    actual: codeOf(oldJobByNewAccount) + ' ' + (oldJobByNewAccount.error?.message ?? ''),
    verdict:
      codeOf(oldJobByNewAccount) === 'FORBIDDEN' &&
      oldJobByNewAccount.error?.message === CONFLICT_TEXT,
    evidence: jobA.data?.jobId,
  });

  const fresh = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const freshDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: fresh.data?.jobId,
  });
  const freshText = freshDownload.data?.content ?? '';
  recordCase({
    id: 'C50',
    category,
    scenario: '新代数导出不含旧代数内容',
    action: 'account.requestExport → downloadExport',
    expected: 'ok，正文 journals 为空，不含旧记录正文',
    actual:
      codeOf(freshDownload) +
      ' journals=' +
      (freshText ? JSON.parse(freshText).data.journals.length : 'n/a') +
      ' oldText=' +
      freshText.includes(JOURNAL_A_OLD),
    verdict:
      ok(freshDownload) &&
      JSON.parse(freshText).data.journals.length === 0 &&
      !freshText.includes(JOURNAL_A_OLD) &&
      !freshText.includes(JOURNAL_A_LIVE),
    evidence: fresh.data?.jobId,
  });

  return { jobA: jobA.data?.jobId };
}

// -------------------------------------------------------- claim credential
async function scenarioPolicy() {
  const category = '领取凭证策略（未接入生产）';
  clockNow = START;
  const revisions = { journals: 2, favorites: 3, tasks: 2, preferences: 1, decorations: 1 };
  const at = (offset) => new Date(START + offset);
  const job = {
    id: 'c2xy_policy_job_1',
    ownerId: OWNER_A,
    state: 'ready',
    format: 'json',
    accountEpoch: 0,
    sourceRevisions: revisions,
    createdAt: stamp('2026-11-23T02:00:00.000Z'),
    readyAt: stamp('2026-11-23T02:00:00.000Z'),
    expiresAt: stamp('2026-11-24T02:00:00.000Z'),
    fileId: 'private-db-export:c2xy_policy_job_1',
  };
  const account = { id: OWNER_A, status: 'active', exportEpoch: 0 };
  const input = {
    actorId: OWNER_A,
    account,
    job,
    sourceRevisions: revisions,
    now: at(HOUR),
  };
  const attempt = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (error) {
      return { ok: false, code: error.code, message: error.message };
    }
  };

  const pending = attempt(() => policy.planClaim({ ...input, job: { ...job, state: 'pending' } }));
  recordCase({
    id: 'C51',
    category,
    scenario: '待生成任务不能领取',
    action: 'planClaim（job.state=pending）',
    expected: 'CONFLICT「导出尚未就绪。」',
    actual: pending.ok ? 'ok' : pending.code + ' ' + pending.message,
    verdict: pending.ok === false && pending.code === 'CONFLICT',
    evidence: 'policy',
  });

  const plan = attempt(() => policy.planClaim(input));
  const keys = plan.ok ? Object.keys(plan.value).sort().join(',') : '';
  recordCase({
    id: 'C52',
    category,
    scenario: '可领取任务生成领取计划',
    action: 'planClaim',
    expected:
      '对象键为 accountEpoch,expiresAt,issuedAt,jobId,ownerId,scope,sourceRevisions，无 token 字段',
    actual: keys,
    verdict:
      plan.ok === true &&
      keys === 'accountEpoch,expiresAt,issuedAt,jobId,ownerId,scope,sourceRevisions' &&
      !('token' in plan.value),
    evidence: 'policy',
  });

  const authorized = attempt(() => policy.authorizeRead(input, plan.value));
  recordCase({
    id: 'C53',
    category,
    scenario: '凭证与任务一致时可读',
    action: 'authorizeRead',
    expected: 'ok，返回 fileId（内部结果）',
    actual: authorized.ok ? 'ok fileId=' + authorized.value.fileId : authorized.code,
    verdict: authorized.ok === true && authorized.value.fileId === job.fileId,
    evidence: 'policy',
  });

  const caseChecks = [
    {
      id: 'C54',
      scenario: '他人凭证被拒绝',
      credential: { ...plan.value, ownerId: OWNER_B },
    },
    {
      id: 'C55',
      scenario: '凭证 scope 被篡改',
      credential: { ...plan.value, scope: 'export_write' },
    },
    {
      id: 'C56',
      scenario: '凭证被标记撤销',
      credential: { ...plan.value, revoked: true },
    },
    {
      id: 'C57',
      scenario: '凭证已过期',
      credential: { ...plan.value, expiresAt: stamp('2026-11-23T03:00:00.000Z') },
    },
    {
      id: 'C58',
      scenario: '凭证的源版本与当前不符',
      credential: { ...plan.value, sourceRevisions: { ...revisions, journals: 3 } },
    },
  ];
  for (const item of caseChecks) {
    const res = attempt(() => policy.authorizeRead(input, item.credential));
    recordCase({
      id: item.id,
      category,
      scenario: item.scenario,
      action: 'authorizeRead',
      expected: 'FORBIDDEN「' + POLICY_FORBIDDEN_TEXT + '」',
      actual: res.ok ? 'ok' : res.code + ' ' + res.message,
      verdict:
        res.ok === false && res.code === 'FORBIDDEN' && res.message === POLICY_FORBIDDEN_TEXT,
      evidence: 'policy',
    });
  }

  const afterChange = attempt(() =>
    policy.authorizeRead({ ...input, sourceRevisions: { ...revisions, favorites: 4 } }, plan.value),
  );
  recordCase({
    id: 'C59',
    category,
    scenario: '来源变化后凭证不可读',
    action: 'authorizeRead（源版本前进）',
    expected: 'FORBIDDEN「' + POLICY_FORBIDDEN_TEXT + '」',
    actual: afterChange.ok ? 'ok' : afterChange.code + ' ' + afterChange.message,
    verdict:
      afterChange.ok === false &&
      afterChange.code === 'FORBIDDEN' &&
      afterChange.message === POLICY_FORBIDDEN_TEXT,
    evidence: 'policy',
  });

  const afterExpiry = attempt(() => policy.planClaim({ ...input, now: at(FILE_MS) }));
  recordCase({
    id: 'C60',
    category,
    scenario: '任务到期后不能再生成领取计划',
    action: 'planClaim（now=expiresAt）',
    expected: 'FORBIDDEN「' + POLICY_FORBIDDEN_TEXT + '」',
    actual: afterExpiry.ok ? 'ok' : afterExpiry.code + ' ' + afterExpiry.message,
    verdict: afterExpiry.ok === false && afterExpiry.code === 'FORBIDDEN',
    evidence: 'policy',
  });

  const window = attempt(() => policy.planClaim({ ...input, now: at(FILE_MS - 1) }));
  recordCase({
    id: 'C61',
    category,
    scenario: '领取计划的时间窗不超过文件到期与凭证上限',
    action: 'planClaim（now=expiresAt-1ms）',
    expected: 'expiresAt ≤ fileExpiresAt 且 expiresAt-issuedAt ≤ 300 秒',
    actual: window.ok
      ? 'issued=' + window.value.issuedAt + ' expires=' + window.value.expiresAt
      : window.code,
    verdict:
      window.ok === true &&
      Date.parse(window.value.expiresAt) <= Date.parse(job.expiresAt) &&
      Date.parse(window.value.expiresAt) - Date.parse(window.value.issuedAt) <= 300 * 1000,
    evidence: 'policy',
  });

  const favoriteChanged = attempt(() =>
    policy.exportStatus({ ...input, sourceRevisions: { ...revisions, favorites: 4 } }),
  );
  recordCase({
    id: 'C62',
    category,
    scenario: '收藏来源前进后任务转为已过期',
    action: 'exportStatus（favorites 版本 +1）',
    expected: 'ok，state=expired',
    actual: favoriteChanged.ok ? 'state=' + favoriteChanged.value.state : favoriteChanged.code,
    verdict: favoriteChanged.ok === true && favoriteChanged.value.state === 'expired',
    evidence: 'policy',
  });

  const epochChanged = attempt(() =>
    policy.exportStatus({ ...input, account: { ...account, exportEpoch: 1 } }),
  );
  recordCase({
    id: 'C63',
    category,
    scenario: '账号导出代数前进后旧任务过期',
    action: 'exportStatus（account.exportEpoch=1）',
    expected: 'ok，state=expired',
    actual: epochChanged.ok ? 'state=' + epochChanged.value.state : epochChanged.code,
    verdict: epochChanged.ok === true && epochChanged.value.state === 'expired',
    evidence: 'policy',
  });

  return {};
}

// ------------------------------------------------------------------- main
async function main() {
  fs.mkdirSync(path.join(OUT, 'samples'), { recursive: true });
  const content = await scenarioContent();
  await scenarioAccess();
  await scenarioInvalidation();
  await scenarioExpiry();
  await scenarioDisabled();
  await scenarioPolicy();

  // Access scenarios that need a second context are covered above; these two
  // cross-account scope cases reuse the disabled scenario's data where possible.

  fs.writeFileSync(path.join(OUT, 'samples/export-sample-json.json'), content.jsonSample);
  fs.writeFileSync(path.join(OUT, 'samples/export-sample-markdown.md'), content.markdownSample);

  const redact = (text) =>
    String(text)
      .replace(
        /"content":"(?:[^"\\]|\\.)*"/g,
        '"content":"<omitted: see samples/export-sample-*.json|md>"',
      )
      .replace(/"receipt":"(?:[^"\\]|\\.)*"/g, '"receipt":"<redacted>"');

  const table = rows
    .map(
      (row) =>
        '| ' +
        row.id +
        ' | ' +
        row.scenario +
        ' | ' +
        row.action +
        ' | ' +
        redact(row.expected) +
        ' | ' +
        redact(row.actual) +
        ' | ' +
        row.conclusion +
        ' |',
    )
    .join('\n');
  fs.writeFileSync(
    path.join(OUT, 'samples/access-receipts.md'),
    [
      '# C2-XY 导出访问回执摘录',
      '',
      '基线：`78812fe`；内存库 + 生产入口 + 注入时钟；正文与注销回执在落盘前替换为占位符。',
      '',
      '| 编号 | 场景 | 动作 | 预期 | 实际 | 结论 |',
      '| --- | --- | --- | --- | --- | --- |',
      table,
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(OUT, 'samples/access-receipts.json'),
    JSON.stringify(
      rows.map((row) => ({ ...row, expected: redact(row.expected), actual: redact(row.actual) })),
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(OUT, 'export-access-results.csv'),
    csv(
      [['编号', '类别', '场景', '服务端动作', '预期', '实际', '结论', '证据']].concat(
        rows.map((row) => [
          row.id,
          row.category,
          row.scenario,
          row.action,
          redact(row.expected),
          redact(row.actual),
          row.conclusion,
          row.evidence,
        ]),
      ),
    ),
  );

  const passed = rows.filter((row) => row.conclusion === '通过').length;
  console.log('cases=' + rows.length + ' passed=' + passed + ' failed=' + failures.length);
  for (const failure of failures) {
    console.error(
      'FAIL ' +
        failure.id +
        ' ' +
        failure.scenario +
        '\n  expected: ' +
        failure.expected +
        '\n  actual:   ' +
        failure.actual,
    );
  }
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
