#!/usr/bin/env node
// C1-XY (2026-11-21 and 22): synthetic A/B/public fixture, the baseline data
// coverage table, the two format samples and the request/claim receipts.
//
//   node tools/alpha-xy/c1-baseline.cjs [--out <dir>]
//
// Everything runs against the production entry and the in-memory WX-shaped
// database with an injected clock. Two independent copies are seeded from the
// same deterministic fixture: one is used for the export samples, the other is
// reserved untouched for the C2/C3 cleanup work.
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

const REPO = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = path.resolve(
  outIndex === -1 ? path.join(REPO, 'docs/alpha/xiang-yu/c1-20261121') : args[outIndex + 1],
);

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '44'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '55'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '66'.repeat(32),
  MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'true',
});

const OPENID_A = 'SIMULATED_C1XY_A';
const OPENID_B = 'SIMULATED_C1XY_B';
const OWNER_A = accountId(config, OPENID_A);
const OWNER_B = accountId(config, OPENID_B);
const HOUR = 3600000;
const START = Date.parse('2026-11-21T02:00:00.000Z');
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

const stamp = (iso) => new Date(iso).toISOString();
const JOURNAL_A =
  'SIMULATED-C1XY 记录：上午在图书馆自习，下午沿湖走了一圈。\n第二行用于检查换行与转义是否保留。';
const JOURNAL_A_EDIT = 'SIMULATED-C1XY 记录（编辑后 version=2）：内容已修改，旧导出必须失效。';
const JOURNAL_B = 'SIMULATED-C1XY B 的记录：内容与 A 明显不同，用于检查归属隔离。';

// One deterministic fixture, built twice. Shapes follow domains/export.js
// SOURCES and the formatter's journal/decorations projection rules.
function buildFixture() {
  const collections = [];
  const add = (name, scope, note, rows) => collections.push({ name, scope, note, rows });
  add('journals', 'owner', '记录：A 一条旧日期有效记录 + 一条删除记录；B 一条有效记录。', [
    {
      _id: 'c1xy_a_journal_old',
      ownerId: OWNER_A,
      entryId: 'entry-c1xy-a-2026-11-19',
      date: '2026-11-19',
      weather: 'RAINY',
      tags: ['TIREDNESS'],
      text: 'SIMULATED-C1XY A 较早记录：补交的旧日期。',
      version: 1,
      state: 'active',
      createdAt: stamp('2026-11-19T12:00:00.000Z'),
      updatedAt: stamp('2026-11-19T12:00:00.000Z'),
    },
    {
      _id: 'c1xy_a_journal_deleted',
      ownerId: OWNER_A,
      entryId: 'entry-c1xy-a-2026-11-20',
      date: '2026-11-20',
      weather: 'STORMY',
      tags: [],
      text: 'SIMULATED-C1XY A 已删除记录：正文不得出现在导出中。',
      version: 2,
      state: 'deleted',
      createdAt: stamp('2026-11-20T03:00:00.000Z'),
      updatedAt: stamp('2026-11-20T04:00:00.000Z'),
    },
    {
      _id: 'c1xy_b_journal_1',
      ownerId: OWNER_B,
      entryId: 'entry-c1xy-b-2026-11-17',
      date: '2026-11-17',
      weather: 'SUNNY',
      tags: ['SOCIAL'],
      text: JOURNAL_B,
      version: 1,
      state: 'active',
      createdAt: stamp('2026-11-17T06:00:00.000Z'),
      updatedAt: stamp('2026-11-17T06:00:00.000Z'),
    },
  ]);
  add('favorites', 'owner', 'A 三个收藏（placeId 唯一）；B 一个收藏，公共地点同名不同账号。', [
    {
      _id: 'c1xy_a_fav_01',
      ownerId: OWNER_A,
      placeId: 'place_c1xy_library',
      placeName: 'SIMULATED-C1XY A 收藏-图书馆',
      createdAt: stamp('2026-11-17T01:01:00.000Z'),
    },
    {
      _id: 'c1xy_a_fav_02',
      ownerId: OWNER_A,
      placeId: 'place_c1xy_lake',
      placeName: 'SIMULATED-C1XY A 收藏-湖边',
      createdAt: stamp('2026-11-17T01:02:00.000Z'),
    },
    {
      _id: 'c1xy_a_fav_03',
      ownerId: OWNER_A,
      placeId: 'place_c1xy_hill',
      placeName: 'SIMULATED-C1XY A 收藏-后山',
      createdAt: stamp('2026-11-17T01:03:00.000Z'),
    },
    {
      _id: 'c1xy_b_fav_01',
      ownerId: OWNER_B,
      placeId: 'place_c1xy_lake',
      placeName: 'SIMULATED-C1XY B 收藏-湖边',
      createdAt: stamp('2026-11-17T01:10:00.000Z'),
    },
  ]);
  add('task_history', 'owner', 'A 三种状态各一条；B 一条。用于核对 state 过滤与排序。', [
    {
      _id: 'c1xy_a_task_1',
      ownerId: OWNER_A,
      taskId: 'breathing-3',
      taskTitle: 'SIMULATED-C1XY A 任务-已完成',
      date: '2026-11-17',
      state: 'completed',
      createdAt: stamp('2026-11-17T01:20:00.000Z'),
    },
    {
      _id: 'c1xy_a_task_2',
      ownerId: OWNER_A,
      taskId: 'walk-10',
      taskTitle: 'SIMULATED-C1XY A 任务-已跳过',
      date: '2026-11-16',
      state: 'skipped',
      createdAt: stamp('2026-11-16T02:00:00.000Z'),
    },
    {
      _id: 'c1xy_a_task_3',
      ownerId: OWNER_A,
      taskId: 'stretch-5',
      taskTitle: 'SIMULATED-C1XY A 任务-已选择',
      date: '2026-11-18',
      state: 'selected',
      createdAt: stamp('2026-11-18T02:00:00.000Z'),
    },
    {
      _id: 'c1xy_b_task_1',
      ownerId: OWNER_B,
      taskId: 'breathing-3',
      taskTitle: 'SIMULATED-C1XY B 任务',
      date: '2026-11-17',
      state: 'selected',
      createdAt: stamp('2026-11-17T01:30:00.000Z'),
    },
  ]);
  add('place_checkins', 'owner', 'A 两次地点打卡；B 一次。completedAt 必须落在业务日期内。', [
    {
      _id: 'c1xy_a_checkin_1',
      ownerId: OWNER_A,
      placeId: 'place_c1xy_library',
      date: '2026-11-17',
      completedAt: stamp('2026-11-17T01:45:00.000Z'),
    },
    {
      _id: 'c1xy_a_checkin_2',
      ownerId: OWNER_A,
      placeId: 'place_c1xy_lake',
      date: '2026-11-16',
      completedAt: stamp('2026-11-16T08:20:00.000Z'),
    },
    {
      _id: 'c1xy_b_checkin_1',
      ownerId: OWNER_B,
      placeId: 'place_c1xy_lake',
      date: '2026-11-17',
      completedAt: stamp('2026-11-17T01:50:00.000Z'),
    },
  ]);
  add(
    'campus_checkin_states',
    'owner',
    'A 校园自助打卡保留两次访问（requests/revision 属内部字段，不导出）；B 一次访问。',
    [
      {
        _id: 'campus_state_' + OWNER_A,
        ownerId: OWNER_A,
        owner: OWNER_A,
        revision: 3,
        requests: {},
        visits: [
          {
            placeId: 'place_c1xy_hill',
            placeName: 'SIMULATED-C1XY A 校园-后山',
            date: '2026-11-15',
            selfReported: true,
            completedAt: stamp('2026-11-15T09:00:00.000Z'),
          },
          {
            placeId: 'place_c1xy_canteen',
            placeName: 'SIMULATED-C1XY A 校园-食堂',
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
            placeId: 'place_c1xy_hall',
            placeName: 'SIMULATED-C1XY B 校园-礼堂',
            date: '2026-11-16',
            selfReported: true,
            completedAt: stamp('2026-11-16T10:00:00.000Z'),
          },
        ],
      },
    ],
  );
  add('month_decorations', 'owner', 'A 一个月装饰：有效贴纸+无目标贴纸+悬空 targetEntryId 贴纸。', [
    {
      _id: 'decoration_2026-11',
      ownerId: OWNER_A,
      month: '2026-11',
      version: 2,
      backgroundId: 'BACKGROUND_SKY_NIGHT',
      stickers: [
        { stickerId: 'STICKER_MOON', targetEntryId: 'entry-c1xy-a-2026-11-19' },
        { stickerId: 'STICKER_CAT' },
        { stickerId: 'STICKER_LEAF', targetEntryId: 'entry-c1xy-gone-0001' },
      ],
    },
  ]);
  add('places', 'public', '公共地点：不导出、不清理。A/B 收藏引用同一条。', [
    {
      _id: 'place_c1xy_library',
      name: '图书馆',
      campusId: 'SIMULATED_CAMPUS',
      status: 'active',
    },
    { _id: 'place_c1xy_lake', name: '湖边', campusId: 'SIMULATED_CAMPUS', status: 'active' },
    { _id: 'place_c1xy_hill', name: '后山', campusId: 'SIMULATED_CAMPUS', status: 'active' },
  ]);
  add('task_templates', 'public', '公共任务模板：不导出、不清理。', [
    {
      _id: 'breathing-3',
      title: '三次呼吸',
      enabled: true,
      steps: ['吸气', '呼气'],
      durationMin: 1,
      tags: ['REST'],
    },
    {
      _id: 'walk-10',
      title: '走十分钟',
      enabled: true,
      steps: ['出门', '回来'],
      durationMin: 10,
      tags: ['MOVE'],
    },
  ]);
  return collections;
}

function seed(memory, collections) {
  for (const collection of collections) {
    for (const row of collection.rows) {
      memory.put(collection.name, row);
    }
  }
}

const countOwner = (inspect, ownerId) =>
  Object.values(inspect).filter((row) => row && row.ownerId === ownerId).length;

let sequence = 0;
// Request ids are deterministic so a rerun reproduces the same job ids and the
// same receipt bytes; each run gets a fresh in-memory database.
const createRequest = (action, payload) => ({
  apiVersion: '1',
  requestId: 'req_c1xy_' + String(++sequence).padStart(4, '0'),
  action,
  payload,
});

function csv(rows) {
  return (
    rows
      .map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
      .join('\n') + '\n'
  );
}

async function main() {
  const collections = buildFixture();
  fs.mkdirSync(path.join(OUT, 'samples'), { recursive: true });

  // Copy 1: export samples. Copy 2: reserved cleanup copy, never written here.
  const exportMemory = createMemoryDatabase();
  const cleanupMemory = createMemoryDatabase();
  seed(exportMemory, collections);
  seed(cleanupMemory, collections);
  const seeded = exportMemory.inspect();
  const cleanupSeeded = cleanupMemory.inspect();
  if (Object.keys(seeded).length !== Object.keys(cleanupSeeded).length) {
    throw new Error('the two fixture copies differ');
  }
  const beforeExport = countOwner(seeded, OWNER_A);

  const entry = createProductionEntry({
    readConfig: () => config,
    openDatabase: () => exportMemory.db,
    now: clock,
    readIdentity: () => identity(),
  });
  const scopes = new Map();
  async function signIn(openid) {
    currentOpenid = openid;
    const result = await entry(createRequest('account.session', {}));
    if (result.ok) {
      scopes.set(openid, result.data.scope);
    } else {
      throw new Error('sign-in failed: ' + JSON.stringify(result));
    }
  }
  async function call(openid, action, payload = {}) {
    currentOpenid = openid;
    const request = createRequest(action, payload);
    const scope = scopes.get(openid);
    return entry(scope ? { ...request, sessionScope: scope } : request);
  }

  await signIn(OPENID_A);
  await signIn(OPENID_B);

  // A's current-day journal and preferences pass through the real write APIs so
  // the sample shows live rows, not only seeded ones.
  const upserted = await call(OPENID_A, 'journal.upsert', {
    date: '2026-11-21',
    weather: 'PARTLY_CLOUDY',
    tags: ['REST', 'CALM'],
    text: JOURNAL_A,
    expectedVersion: 0,
  });
  if (!upserted.ok) {
    throw new Error('journal.upsert failed: ' + JSON.stringify(upserted));
  }
  const preference = await call(OPENID_A, 'account.preferences', {
    operation: 'set',
    cardTextPreview: true,
    decorationsEnabled: true,
  });
  if (!preference.ok) {
    throw new Error('account.preferences failed: ' + JSON.stringify(preference));
  }

  const cases = [];
  const record = (id, event, request, response, note) =>
    cases.push({ id, event, request, response, note });

  const jsonRequest = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  record(
    'R1',
    '申请 JSON 导出',
    'account.requestExport {format:"json"}',
    jsonRequest,
    '同步完成，state=ready',
  );
  const jsonDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R2',
    '领取 JSON 文件',
    'account.downloadExport {jobId}',
    jsonDownload,
    '返回正文、扩展名与字节数',
  );
  const jsonContent = jsonDownload.data?.content ?? '';
  fs.writeFileSync(path.join(OUT, 'samples/export-sample-json.json'), jsonContent);

  const markdownRequest = await call(OPENID_A, 'account.requestExport', { format: 'markdown' });
  const markdownDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R3',
    '申请并领取 Markdown 文件',
    'account.requestExport {format:"markdown"} → account.downloadExport {jobId}',
    markdownDownload,
    '扩展名 md，内容同样只含本人业务字段',
  );
  const markdownContent = markdownDownload.data?.content ?? '';
  fs.writeFileSync(path.join(OUT, 'samples/export-sample-markdown.md'), markdownContent);

  // Parse and privacy checks on the files themselves.
  const parsed = JSON.parse(jsonContent);
  const data = parsed.data;
  const journalTexts = data.journals.map((row) => row.text);
  const checks = [
    ['JSON 可解析', parsed.exportVersion === '1.0-candidate'],
    ['JSON 记录只含 active 行', journalTexts.length === 2],
    ['删除记录正文未出现', !jsonContent.includes('已删除记录')],
    ['导出不含 ownerId', !jsonContent.includes(OWNER_A) && !jsonContent.includes('ownerId')],
    ['导出不含 openid', !jsonContent.includes(OPENID_A) && !jsonContent.includes(OPENID_B)],
    ['收藏按 placeId 去重', new Set(data.favorites.map((row) => row.placeId)).size === 3],
    [
      '任务状态均在允许集合',
      data.taskHistory.every((row) =>
        ['selected', 'completed', 'replaced', 'skipped'].includes(row.state),
      ),
    ],
    [
      '悬空贴纸被丢弃',
      JSON.stringify(data.monthDecorations[0].stickers).indexOf('entry-c1xy-gone-0001') === -1,
    ],
    ['贴纸改为 targetDate', data.monthDecorations[0].stickers[0].targetDate === '2026-11-19'],
    ['打卡含地点与日期', Array.isArray(data.checkins) && data.checkins.length === 4],
    [
      '校园打卡 selfReported',
      data.checkins.filter((row) => row.selfReported === true).length === 2,
    ],
    ['Markdown 含标题', markdownContent.startsWith('# ')],
    ['Markdown 含记录正文', markdownContent.includes('SIMULATED-C1XY 记录')],
    ['Markdown 不含 B 的正文', !markdownContent.includes('B 的记录')],
    [
      'Markdown 不含账号标识',
      !markdownContent.includes(OPENID_A) && !markdownContent.includes(OWNER_A),
    ],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    throw new Error('sample checks failed: ' + failed.map(([name]) => name).join(', '));
  }

  // R4: another account never sees or claims this job.
  const crossAccount = await call(OPENID_B, 'account.exportStatus', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R4',
    'B 查询 A 的导出',
    'account.exportStatus {他人 jobId}',
    crossAccount,
    '按不可见处理，文案与 CONFLICT 相同',
  );

  // R5: changing the source invalidates the older ready job.
  const edited = await call(OPENID_A, 'journal.upsert', {
    date: '2026-11-21',
    weather: 'PARTLY_CLOUDY',
    tags: ['REST', 'CALM'],
    text: JOURNAL_A_EDIT,
    expectedVersion: 1,
  });
  if (!edited.ok) {
    throw new Error('journal.upsert edit failed: ' + JSON.stringify(edited));
  }
  const invalidated = await call(OPENID_A, 'account.exportStatus', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R5',
    '记录改动后查询旧导出',
    'account.exportStatus {旧 jobId}',
    invalidated,
    'state=expired，旧文件不可再领取',
  );
  const invalidatedClaim = await call(OPENID_A, 'account.downloadExport', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R6',
    '记录改动后领取旧导出',
    'account.downloadExport {旧 jobId}',
    invalidatedClaim,
    'CONFLICT，服务端不返回正文',
  );

  // R7: the 24-hour file deadline.
  clockNow += 24 * HOUR + 1000;
  const expiredClaim = await call(OPENID_A, 'account.downloadExport', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R7',
    '到期后领取',
    'account.downloadExport {jobId}（+24h+1s）',
    expiredClaim,
    'CONFLICT，与来源失效同一文案',
  );

  // R8: disabled account refuses every private action.
  const closed = await call(OPENID_A, 'account.close', { confirm: 'CLOSE' });
  record(
    'R8',
    '注销账号',
    'account.close {confirm:"CLOSE"}',
    closed,
    '返回清理任务与一次性回执（样例中不落盘）',
  );
  const disabledRequest = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  record(
    'R9',
    '停用后申请导出',
    'account.requestExport {format:"json"}',
    disabledRequest,
    'ACCOUNT_DISABLED',
  );

  const afterExport = exportMemory.inspect();
  // The export copy only grows through real writes and the close call; the
  // reserved copy must be byte-identical to its seed.
  if (countOwner(afterExport, OWNER_A) < beforeExport) {
    throw new Error('the export run lost rows that no case removed');
  }
  const cleanupAfter = cleanupMemory.inspect();
  const cleanupIntact =
    Object.keys(cleanupAfter).length === Object.keys(cleanupSeeded).length &&
    Object.values(cleanupSeeded).every((row) => {
      const key = Object.keys(cleanupAfter).find((item) => cleanupAfter[item]._id === row._id);
      return key && JSON.stringify(cleanupAfter[key]) === JSON.stringify(row);
    });
  if (!cleanupIntact) {
    throw new Error('the reserved cleanup copy changed during the export run');
  }

  const ownerCounts = (inspect) => {
    const counts = { A: 0, B: 0, other: 0 };
    for (const row of Object.values(inspect)) {
      if (!row || typeof row.ownerId !== 'string') {
        continue;
      }
      const key = row.ownerId === OWNER_A ? 'A' : row.ownerId === OWNER_B ? 'B' : 'other';
      counts[key] += 1;
    }
    return counts;
  };

  const synthetic = {
    purpose: 'C1-XY 合成数据集（A/B/公共）与两份独立副本',
    generatedAt: clock().toISOString(),
    clockStartUtc: new Date(START).toISOString(),
    repositoryBaseline: process.env.MOODSKY_BUILD_COMMIT || null,
    accounts: {
      A: { openid: OPENID_A, accountId: OWNER_A, role: '导出与领取样例的主账号' },
      B: { openid: OPENID_B, accountId: OWNER_B, role: '归属隔离的对账号' },
    },
    copies: {
      exportCopy: '本脚本内用于生成样例；跑完后仅供本次进程使用，不落盘',
      cleanupCopy: '同一夹具的独立副本，C1 不写入、不清理，留给 C2/C3 到期与分批清理',
      reset: '重跑本脚本即按同一 _id、同一注入时钟重建两份副本；不使用真实账号、真实时钟或云环境',
    },
    counts: {
      seededRows: Object.keys(seeded).length,
      seededByCollection: Object.fromEntries(
        collections.map((item) => [item.name, item.rows.length]),
      ),
      seededByOwner: ownerCounts(seeded),
      afterExportRun: ownerCounts(afterExport),
      cleanupCopyRows: Object.keys(cleanupSeeded).length,
    },
    collections: collections.map((item) => ({
      name: item.name,
      scope: item.scope,
      note: item.note,
      rows: item.rows,
    })),
  };
  fs.writeFileSync(
    path.join(OUT, 'synthetic-data.json'),
    JSON.stringify(synthetic, null, 2) + '\n',
  );

  const coverage = [
    [
      '数据集合',
      '数据归属',
      'JSON 是否导出',
      'Markdown 是否导出',
      '导出字段',
      '排除/禁止字段',
      '清理范围',
      '依据',
    ],
    [
      'journals',
      '本人（A/B 分属）',
      '是',
      '是（天气记录）',
      'date,weather,weatherName,tags,text,version,createdAt,updatedAt',
      '_id,entryId,ownerId 不落盘；state=deleted 整行排除；layout 与存储元数据不导出',
      '是（第 1 批）',
      'cloudfunctions/moodsky/domains/export.js:18-30；tools/export-candidate/formatter.js:145-194',
    ],
    [
      'favorites',
      '本人（A/B 分属）',
      '是',
      '是（收藏地点）',
      'placeId,placeName,createdAt',
      '_id,ownerId；同一 placeId 重复收藏只保留一条',
      '是（第 2 批）',
      'domains/export.js:33；formatter.js:196-210',
    ],
    [
      'task_history',
      '本人（A/B 分属）',
      '是',
      '是（任务历史）',
      'taskId,taskTitle,date,state,createdAt',
      '_id,ownerId；state 仅 selected/completed/replaced/skipped',
      '是（第 5 批）',
      'domains/export.js:34；formatter.js:211-229',
    ],
    [
      'preferences',
      '本人（A/B 分属）',
      '是',
      '是（偏好）',
      'cardTextPreview,decorationsEnabled,updatedAt,profile(view)',
      '_id,ownerId；profile 走 profileView 白名单，不透传原始资料',
      '是（第 6 批）',
      'domains/export.js:35；formatter.js:230-243',
    ],
    [
      'month_decorations',
      '本人（A/B 分属）',
      '是',
      '是（月历装饰）',
      'month,version,stickers(stickerId,targetDate),backgroundId',
      '_id,ownerId；悬空 targetEntryId 直接丢弃，不可导出为失效引用',
      '是（第 7 批）',
      'domains/export.js:36；formatter.js:244-290',
    ],
    [
      'place_checkins',
      '本人（A/B 分属）',
      '是',
      '是（地点打卡）',
      'placeId,date,completedAt',
      '_id,ownerId；completedAt 必须落在同一业务日期内，否则整体拒绝',
      '是（第 3 批）',
      'domains/export.js:32,247-257；formatter.js:44-87',
    ],
    [
      'campus_checkin_states',
      '本人（A/B 分属）',
      '是（visits 平铺为 checkins）',
      '是（校园打卡）',
      'visits[].placeId,placeName,date,selfReported,completedAt',
      'ownerId,owner,requests,revision；非 selfReported=true 的访问不导出',
      '是（第 4 批）',
      'domains/export.js:31,248-257；formatter.js:44-87',
    ],
    [
      'accounts',
      '本人',
      '否',
      '否',
      '—',
      '账号文档只用于鉴权与状态判断，不进入导出正文',
      '不删除；注销后保留墓碑（openid,identityKind,status,journalLayout,closedAt）',
      'production/cleanup.js:119-141',
    ],
    [
      'export_jobs',
      '本人',
      '否',
      '否',
      '—',
      '正文仅存于此集合，领取时校验 sha256 与字节数；不进入导出正文',
      '是（第 9 批）',
      'production/exports.js:76-95,117-137',
    ],
    [
      'request_receipts',
      '本人',
      '否',
      '否',
      '—',
      '请求回执为一次性凭证，不导出、不落样例',
      '是（第 8 批）',
      'production/cleanup.js:3-15',
    ],
    [
      'cleanup_jobs',
      '本人（服务端持有）',
      '否',
      '否',
      '—',
      '清理任务与进度由回执鉴权读取，不导出',
      '否；完成记录保留作追溯',
      'production/cleanup.js:19-53',
    ],
    [
      'deletion_markers',
      '本人',
      '否',
      '否',
      '—',
      '删除标记不导出',
      '是（第 10 批）',
      'production/cleanup.js:3-15',
    ],
    [
      'place_corrections',
      '本人',
      '否',
      '否',
      '—',
      '地点纠错记录不导出',
      '是（第 11 批）',
      'production/cleanup.js:3-15',
    ],
    [
      'places',
      '公共',
      '否',
      '否',
      '—',
      '公共地点不属于任何账号，不导出个人副本',
      '否，公共数据在清理后必须完整',
      'docs/week6/XiangYu/W6XY-导出与清理本地验收报告.md',
    ],
    [
      'task_templates',
      '公共',
      '否',
      '否',
      '—',
      '公共任务模板不导出',
      '否，公共数据在清理后必须完整',
      'docs/week6/XiangYu/W6XY-导出与清理本地验收报告.md',
    ],
    [
      'task_checkin_links',
      '本人（候选来源）',
      '否（默认路径不读）',
      '否',
      '—',
      '仅 includeCandidateSources:true 时读取，集合未部署；默认生产路径不查询',
      '不在 cleanup.js COLLECTIONS 内，需在 C2/C3 单独确认',
      'domains/export.js:38-43；database/collections.json',
    ],
  ];
  fs.writeFileSync(path.join(OUT, 'data-coverage-baseline.csv'), csv(coverage));

  const cell = (item) => {
    if (!item.response?.ok) {
      return item.response?.error?.code + ' / ' + item.response?.error?.message;
    }
    const payload = item.response.data || {};
    const parts = [];
    for (const key of ['jobId', 'state', 'format', 'extension', 'byteLength']) {
      if (payload[key] !== undefined) {
        parts.push(key + '=' + payload[key]);
      }
    }
    if (payload.accountStatus) {
      parts.push('accountStatus=' + payload.accountStatus);
    }
    if (payload.receipt) {
      parts.push('receipt=<redacted:' + payload.receipt.length + '-chars>');
    }
    return parts.join('；');
  };
  const receipts = [
    '# C1-XY 导出请求与领取回执',
    '',
    '本文件由 `tools/alpha-xy/c1-baseline.cjs` 在内存库上生成，注入时钟起点为 ' +
      new Date(START).toISOString() +
      '，Node ' +
      process.version +
      '／' +
      process.platform +
      '。样例正文见同目录 `samples/`，均只含 SIMULATED 合成数据，不含真实账号、openid 或凭证。',
    '',
    '| 编号 | 事件 | 请求 | 服务返回 | 说明 |',
    '| ---- | ---- | ---- | -------- | ---- |',
  ];
  for (const item of cases) {
    receipts.push(
      '| ' +
        [item.id, item.event, '`' + item.request + '`', '`' + cell(item) + '`', item.note]
          .map((value) => String(value).replace(/\|/g, '\\|'))
          .join(' | ') +
        ' |',
    );
  }
  receipts.push(
    '',
    '## 样例自检',
    '',
    '| 检查 | 结果 |',
    '| ---- | ---- |',
    ...checks.map(([name, ok]) => '| ' + name + ' | ' + (ok ? '通过' : '失败') + ' |'),
    '',
    '## 边界',
    '',
    '- 生产入口是同步生成：本机取不到 pending/processing 中间态，界面需要按 state 兼容这两值。',
    '- 领取凭证 `planClaim`/`authorizeRead`（300 秒）尚未接入生产领取路径，当前领取=会话范围＋库内哈希校验。',
    '- 结论只覆盖内存库与生产业务入口；真实云端、真机、自然到期与备份恢复不在本期证明范围（见 `../progress.md`）。',
    '',
  );
  fs.writeFileSync(path.join(OUT, 'samples/format-receipts.md'), receipts.join('\n'));

  const summary = cases.map(
    (item) => item.id + ' ' + (item.response?.ok ? 'ok' : item.response?.error?.code),
  );
  console.log(
    'cases=' + cases.length + ' checks=' + checks.length + ' -> ' + path.relative(REPO, OUT),
  );
  console.log(summary.join(' | '));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
