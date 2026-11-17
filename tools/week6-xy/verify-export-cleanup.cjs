#!/usr/bin/env node
// W6XY local verification: export content/format, lifecycle, deactivation and
// batched account cleanup. Synthetic A/B data only; no SDK, network or real user.
//
//   node tools/week6-xy/verify-export-cleanup.cjs [--out <dir>]
//
// Writes machine evidence (run.json), desensitised samples and the per-batch
// cleanup log. Exit code 1 if any scenario fails its checks.
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryDatabase } = require('./memory-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const { createProductionCleanup } = require('../../cloudfunctions/moodsky/production/cleanup');
const { createExportMaintenance } = require('../../cloudfunctions/moodsky/production/maintenance');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../../cloudfunctions/moodsky/production/config');
// Same envelope the client builds (apiVersion/requestId/action/payload). The real
// miniprogram/services/api.js needs a generated environment file, so this tool
// constructs the reviewed shape directly instead of faking that module.
let requestSequence = 0;
const createRequest = (action, payload) => ({
  apiVersion: '1',
  requestId:
    'req_w6xy_' +
    (++requestSequence).toString(36).padStart(6, '0') +
    '_' +
    process.pid.toString(36),
  action,
  payload,
});

const REPO = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = path.resolve(
  outIndex === -1 ? path.join(REPO, 'docs/week6/XiangYu/evidence') : args[outIndex + 1],
);

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  // Candidate package default: new campus check-ins stay paused.
  MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'true',
});

const OPENID_A = 'SIMULATED_XY_W6_A';
const OPENID_B = 'SIMULATED_XY_W6_B';
const OWNER_A = accountId(config, OPENID_A);
const OWNER_B = accountId(config, OPENID_B);
const T0 = Date.parse('2026-11-17T02:00:00.000Z');
const HOUR = 3600000;

let clockNow = T0;
const clock = () => new Date(clockNow);
const advanceTo = (iso) => {
  clockNow = Date.parse(iso);
};

const scenarios = [];
function scenario(id, title, expected) {
  const record = { id, title, expected, checks: [], pass: true };
  scenarios.push(record);
  return {
    record,
    check(label, actual, expectedValue) {
      const ok =
        typeof expectedValue === 'function' ? expectedValue(actual) : actual === expectedValue;
      record.checks.push({
        label,
        actual,
        expected: typeof expectedValue === 'function' ? 'predicate' : expectedValue,
        ok,
      });
      if (!ok) {
        record.pass = false;
      }
      return ok;
    },
    fact(label, value) {
      record.checks.push({ label, actual: value, expected: 'recorded', ok: true });
    },
    fail(label, actual) {
      record.checks.push({ label, actual, expected: 'pass', ok: false });
      record.pass = false;
    },
  };
}

function buildEntry(db) {
  return createProductionEntry({
    readConfig: () => config,
    openDatabase: () => db,
    now: clock,
    readIdentity: () => identity(),
  });
}

let currentOpenid = OPENID_A;
const identity = () => ({
  APPID: APP_ID,
  ENV: ENV_ID,
  SOURCE: 'wx_devtools',
  OPENID: currentOpenid,
  identityFromCurrentInvocation: true,
});

function makeClient(entry) {
  return async function call(action, payload = {}, { requestId } = {}) {
    const request = createRequest(action, payload);
    const scope = scopes.get(currentOpenid);
    const envelope = requestId ? { ...request, requestId } : { ...request };
    if (scope) {
      envelope.sessionScope = scope;
    }
    return entry(envelope);
  };
}

const scopes = new Map();
async function signIn(call, openid) {
  currentOpenid = openid;
  const result = await call('account.session');
  if (!result.ok) {
    return result;
  }
  scopes.set(openid, result.data.scope);
  return result;
}
function as(openid) {
  currentOpenid = openid;
  return scopes.get(openid);
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'samples'), { recursive: true });
  const memory = createMemoryDatabase();
  const db = memory.db;
  const entry = buildEntry(db);
  const call = makeClient(entry);
  const cleanup = createProductionCleanup({ db, now: clock });
  const maintenance = createExportMaintenance({ db, now: clock });

  // ---------------------------------------------------------------- S0: actors
  const s0 = scenario('S0', 'A/B 合成账号建立（真实登录路径）', '两个账号各自拿到可信 scope');
  const signedA = await signIn(call, OPENID_A);
  s0.check('A account.session ok', signedA.ok, true);
  s0.fact('A ownerId', OWNER_A);
  const signedB = await signIn(call, OPENID_B);
  s0.check('B account.session ok', signedB.ok, true);
  s0.fact('B ownerId', OWNER_B);
  s0.check('A 与 B 账号 ID 不同', OWNER_A !== OWNER_B, true);
  const provisions = memory.inspect();
  s0.check('A 账号初始 status', provisions['accounts:' + OWNER_A].status, 'active');
  s0.fact('A 初始 sourceRevisions', provisions['accounts:' + OWNER_A].sourceRevisions);
  s0.fact('A 初始 exportEpoch/operationFence', {
    exportEpoch: provisions['accounts:' + OWNER_A].exportEpoch,
    operationFence: provisions['accounts:' + OWNER_A].operationFence,
  });

  // ------------------------------------------------------- S1: create A/B data
  const s1 = scenario(
    'S1',
    '合成数据：A/B 可辨识，覆盖记录、任务、偏好、打卡',
    '各来源均有可区分数据',
  );
  const A_TEXT_1 = 'SIMULATED-A-记录一：今天天晴，去图书馆坐了一下午。';
  const A_TEXT_2 = 'SIMULATED-A-记录二：下雨，改了计划，早睡。';
  const A_TEXT_EDIT = 'SIMULATED-A-记录一（已编辑 version=2）。';
  const B_TEXT_1 = 'SIMULATED-B-记录一：只有 B 知道的内容。';

  as(OPENID_A);
  const aUpsert1 = await call('journal.upsert', {
    date: '2026-11-17',
    weather: 'SUNNY',
    tags: ['STUDY', 'CALM'],
    text: A_TEXT_1,
    expectedVersion: 0,
  });
  s1.check('A 记录一保存', aUpsert1.ok, true);
  const aUpsert2 = await call('journal.upsert', {
    date: '2026-11-16',
    weather: 'CUSTOM',
    weatherName: '梅雨',
    tags: ['REST'],
    text: A_TEXT_2,
    expectedVersion: 0,
  });
  s1.check('A 记录二保存（自定义天气）', aUpsert2.ok, true);
  const aPrefs = await call('account.preferences', {
    operation: 'set',
    cardTextPreview: true,
    decorationsEnabled: true,
  });
  s1.check('A 偏好保存', aPrefs.ok, true);

  as(OPENID_B);
  const bUpsert1 = await call('journal.upsert', {
    date: '2026-11-17',
    weather: 'CLOUDY',
    tags: ['ALONE_TIME'],
    text: B_TEXT_1,
    expectedVersion: 0,
  });
  s1.check('B 记录一保存', bUpsert1.ok, true);
  const bPrefs = await call('account.preferences', {
    operation: 'set',
    cardTextPreview: false,
    decorationsEnabled: false,
  });
  s1.check('B 偏好保存', bPrefs.ok, true);

  const seeded = memory.inspect();
  const aDay17 =
    seeded['journals:journal_' + OWNER_A + '_2026-11-17'] ??
    Object.entries(seeded).find(
      ([key, row]) =>
        key.startsWith('journals:') && row.ownerId === OWNER_A && row.date === '2026-11-17',
    )?.[1];
  const aDay16 = Object.entries(seeded).find(
    ([key, row]) =>
      key.startsWith('journals:') && row.ownerId === OWNER_A && row.date === '2026-11-16',
  )?.[1];
  s1.check('A 2026-11-17 行存在', Boolean(aDay17), true);
  s1.fact('A 2026-11-17 行字段', aDay17 ? Object.keys(aDay17).sort() : null);
  s1.fact('A 2026-11-17 version', aDay17?.version);
  s1.fact('A 2026-11-16 自定义天气', {
    weather: aDay16?.weather,
    weatherName: aDay16?.weatherName,
  });
  const entryA = aDay17?.entryId || aDay17?._id;

  // Seeded rows keep the same projection the repositories write. Shapes follow
  // domains/export.js SOURCES and the formatter's projection rules.
  const stamp = (iso) => new Date(iso).toISOString();
  const seed = [];
  const put = (collectionName, row) => {
    memory.put(collectionName, row);
    seed.push(collectionName + ':' + row._id);
  };
  // A: 一条更早的有效记录 + 一条删除记录（用于排除检查）
  put('journals', {
    _id: 'seed_a_old_row',
    ownerId: OWNER_A,
    entryId: 'entry-a-2026-11-03',
    date: '2026-11-03',
    weather: 'RAINY',
    tags: ['TIREDNESS'],
    text: 'SIMULATED-A-较早记录：补交的旧日期。',
    version: 1,
    state: 'active',
    createdAt: stamp('2026-11-03T12:00:00.000Z'),
    updatedAt: stamp('2026-11-03T12:00:00.000Z'),
  });
  put('journals', {
    _id: 'seed_a_deleted_row',
    ownerId: OWNER_A,
    entryId: 'entry-a-2026-11-10',
    date: '2026-11-10',
    weather: 'STORMY',
    tags: [],
    text: 'SIMULATED-A-已删除记录，正文不应出现在导出中。',
    version: 2,
    state: 'deleted',
    createdAt: stamp('2026-11-10T03:00:00.000Z'),
    updatedAt: stamp('2026-11-10T04:00:00.000Z'),
  });
  // A: 11 个收藏，用来产生两批清理（10 + 1）；placeId 必须唯一
  for (let index = 1; index <= 11; index += 1) {
    put('favorites', {
      _id: 'seed_a_fav_' + String(index).padStart(2, '0'),
      ownerId: OWNER_A,
      placeId: 'place_campus_library_' + String(index).padStart(2, '0'),
      placeName: 'SIMULATED-A-收藏-' + index,
      createdAt: stamp('2026-11-17T01:0' + (index % 10) + ':00.000Z'),
    });
  }
  put('task_history', {
    _id: 'seed_a_task_1',
    ownerId: OWNER_A,
    taskId: 'breathing-3',
    taskTitle: 'SIMULATED-A-任务（已完成）',
    date: '2026-11-17',
    state: 'completed',
    createdAt: stamp('2026-11-17T01:30:00.000Z'),
  });
  put('task_history', {
    _id: 'seed_a_task_2',
    ownerId: OWNER_A,
    taskId: 'walk-10',
    taskTitle: 'SIMULATED-A-任务（已跳过）',
    date: '2026-11-16',
    state: 'skipped',
    createdAt: stamp('2026-11-16T02:00:00.000Z'),
  });
  put('place_checkins', {
    _id: 'seed_a_checkin_1',
    ownerId: OWNER_A,
    placeId: 'place_campus_library',
    date: '2026-11-17',
    completedAt: stamp('2026-11-17T01:45:00.000Z'),
  });
  put('place_checkins', {
    _id: 'seed_a_checkin_2',
    ownerId: OWNER_A,
    placeId: 'place_campus_lake',
    date: '2026-11-16',
    completedAt: stamp('2026-11-16T08:20:00.000Z'),
  });
  put('campus_checkin_states', {
    _id: 'campus_state_' + OWNER_A,
    ownerId: OWNER_A,
    owner: OWNER_A,
    revision: 3,
    requests: {},
    visits: [
      {
        placeId: 'place_campus_hill',
        placeName: 'SIMULATED-A-旧访问',
        date: '2026-11-15',
        selfReported: true,
        completedAt: stamp('2026-11-15T09:00:00.000Z'),
      },
    ],
  });
  put('month_decorations', {
    _id: 'decoration_2026-11',
    ownerId: OWNER_A,
    month: '2026-11',
    version: 2,
    backgroundId: 'BACKGROUND_SKY_NIGHT',
    stickers: [
      { stickerId: 'STICKER_MOON', targetEntryId: entryA },
      { stickerId: 'STICKER_CAT' },
      { stickerId: 'STICKER_LEAF', targetEntryId: 'entry-gone-0001' },
    ],
  });
  // B: 少量数据，用于切号隔离与清理后完整性
  put('journals', {
    _id: 'seed_b_old_row',
    ownerId: OWNER_B,
    entryId: 'entry-b-2026-11-05',
    date: '2026-11-05',
    weather: 'SUNNY',
    tags: ['SOCIAL'],
    text: 'SIMULATED-B-较早记录：B 的数据。',
    version: 1,
    state: 'active',
    createdAt: stamp('2026-11-05T06:00:00.000Z'),
    updatedAt: stamp('2026-11-05T06:00:00.000Z'),
  });
  put('favorites', {
    _id: 'seed_b_fav_01',
    ownerId: OWNER_B,
    placeId: 'place_campus_lake',
    placeName: 'SIMULATED-B-收藏',
    createdAt: stamp('2026-11-17T01:10:00.000Z'),
  });
  put('task_history', {
    _id: 'seed_b_task_1',
    ownerId: OWNER_B,
    taskId: 'breathing-3',
    taskTitle: 'SIMULATED-B-任务',
    date: '2026-11-17',
    state: 'selected',
    createdAt: stamp('2026-11-17T01:20:00.000Z'),
  });
  put('place_checkins', {
    _id: 'seed_b_checkin_1',
    ownerId: OWNER_B,
    placeId: 'place_campus_lake',
    date: '2026-11-17',
    completedAt: stamp('2026-11-17T01:50:00.000Z'),
  });
  // 公共集合：清理不得触碰
  put('places', {
    _id: 'place_campus_library',
    name: '图书馆',
    campusId: 'SIMULATED_CAMPUS',
    status: 'active',
  });
  put('task_templates', {
    _id: 'breathing-3',
    title: '三次呼吸',
    enabled: true,
    steps: ['吸气', '呼气'],
    durationMin: 1,
    tags: ['REST'],
  });
  s1.fact('A 收藏条数', 11);
  s1.check('合成数据写入完成', memory.inspect()['places:place_campus_library']?.status, 'active');
  const aJournalId = 'journal_' + OWNER_A + '_2026-11-17';
  s1.fact('A 记录 _id', aJournalId);

  // --------------------------------------------------------- S2: A JSON export
  as(OPENID_A);
  const s2 = scenario(
    'S2',
    'A 申请 JSON 导出并领取',
    '导出成功、字段与排除规则正确、只有 A 的数据',
  );
  const reqA1 = await call('account.requestExport', { format: 'json' });
  s2.check('A requestExport ok', reqA1.ok, true);
  if (!reqA1.ok) {
    console.error('DEBUG requestExport A:', JSON.stringify(reqA1));
  }
  const jobA1 = reqA1.data?.jobId;
  s2.check('A job 状态 ready', reqA1.data?.state, 'ready');
  const dlA1 = await call('account.downloadExport', { jobId: jobA1 });
  s2.check('A 领取成功', dlA1.ok, true);
  if (!dlA1.ok) {
    console.error('DEBUG downloadExport A:', JSON.stringify(dlA1));
  }
  s2.check('MIME', dlA1.data?.extension, 'json');
  const parsedA = dlA1.ok ? JSON.parse(dlA1.data.content) : null;
  fs.writeFileSync(path.join(OUT, 'samples', 'A-export.json'), dlA1.data?.content ?? '');
  s2.check('exportVersion', parsedA?.exportVersion, '1.0-candidate');
  s2.check('A 记录条数（3 条有效）', parsedA?.data.journals.length, 3);
  s2.check('已删除记录被排除', JSON.stringify(parsedA).includes('已删除记录'), false);
  s2.check('导出不含 B 的内容', JSON.stringify(parsedA).includes('SIMULATED-B'), false);
  s2.check('导出不含 ownerId 字段', Object.hasOwn(parsedA.data, 'ownerId'), false);
  s2.check(
    '记录条目不含内部 _id',
    parsedA.data.journals.some((row) => Object.hasOwn(row, '_id')),
    false,
  );
  s2.check(
    '记录条目不含 ownerId',
    parsedA.data.journals.some((row) => Object.hasOwn(row, 'ownerId')),
    false,
  );
  s2.check('任务历史 2 条', parsedA.data.taskHistory.length, 2);
  s2.check('收藏 11 个', parsedA.data.favorites.length, 11);
  s2.check('偏好为 A 写入值', parsedA.data.preferences?.cardTextPreview, true);
  s2.check('打卡 3 条（含旧 visits）', parsedA.data.checkins?.length, 3);
  s2.fact('月份装饰转换 targetDate', parsedA.data.monthDecorations?.[0]?.stickers);
  s2.check('悬空贴纸目标被过滤', parsedA.data.monthDecorations?.[0]?.stickers.length, 2);
  s2.fact('顶层键', Object.keys(parsedA).sort());
  s2.fact('领取字节数', dlA1.data?.byteLength);

  // ------------------------------------------------------ S3: A Markdown export
  const s3 = scenario('S3', 'A 申请 Markdown 导出并领取', 'Markdown 可读、正文围栏、元数据转义');
  const reqA2 = await call('account.requestExport', { format: 'markdown' });
  s3.check('A markdown ready', reqA2.data?.state, 'ready');
  const dlA2 = await call('account.downloadExport', { jobId: reqA2.data?.jobId });
  s3.check('A markdown 领取成功', dlA2.ok, true);
  const markdownA = dlA2.ok ? dlA2.data.content : '';
  fs.writeFileSync(path.join(OUT, 'samples', 'A-export.md'), markdownA);
  s3.check('含标题', markdownA.includes('# MoodSky 数据导出（格式候选）'), true);
  s3.check('含围栏正文', markdownA.includes('SIMULATED-A-记录一'), true);
  s3.check('不含 B 内容', markdownA.includes('SIMULATED-B'), false);
  s3.check('扩展名 md', dlA2.data?.extension, 'md');
  s3.fact('Markdown 字节数', dlA2.data?.byteLength);

  // --------------------------------------------------------- S4: B JSON export
  as(OPENID_B);
  const s4 = scenario('S4', 'B 申请 JSON 与 Markdown 导出', 'B 文件只含 B 数据，与 A 不混淆');
  const reqB1 = await call('account.requestExport', { format: 'json' });
  s4.check('B requestExport ok', reqB1.ok, true);
  const dlB1 = await call('account.downloadExport', { jobId: reqB1.data?.jobId });
  s4.check('B 领取成功', dlB1.ok, true);
  const parsedB = dlB1.ok ? JSON.parse(dlB1.data.content) : null;
  fs.writeFileSync(path.join(OUT, 'samples', 'B-export.json'), dlB1.data?.content ?? '');
  s4.check('B 记录 2 条', parsedB?.data.journals.length, 2);
  s4.check('B 文件不含 A 内容', JSON.stringify(parsedB).includes('SIMULATED-A'), false);
  s4.check('B 偏好为 B 写入值', parsedB?.data.preferences?.cardTextPreview, false);
  const reqB1md = await call('account.requestExport', { format: 'markdown' });
  s4.check('B markdown ready', reqB1md.data?.state, 'ready');
  const dlB1md = await call('account.downloadExport', { jobId: reqB1md.data?.jobId });
  s4.check('B markdown 领取成功', dlB1md.ok, true);
  s4.check('B markdown 含本人正文', (dlB1md.data?.content || '').includes(B_TEXT_1), true);
  s4.check('B markdown 不含 A 内容', (dlB1md.data?.content || '').includes('SIMULATED-A'), false);
  fs.writeFileSync(path.join(OUT, 'samples', 'B-export.md'), dlB1md.data?.content ?? '');
  s4.fact('B jobId', reqB1.data?.jobId);
  s4.fact('A jobId', jobA1);

  // ------------------------------------------------- S5: cross-account refusal
  const s5 = scenario('S5', '跨账号领取拒绝', 'B 取 A 的文件与 A 取 B 的文件都被拒');
  as(OPENID_B);
  const crossB = await call('account.downloadExport', { jobId: jobA1 });
  s5.check('B 领取 A 的导出被拒', crossB.ok, false);
  s5.fact('B→A 错误码', crossB.error?.code);
  as(OPENID_A);
  const crossA = await call('account.downloadExport', { jobId: reqB1.data.jobId });
  s5.check('A 领取 B 的导出被拒', crossA.ok, false);
  s5.fact('A→B 错误码', crossA.error?.code);
  as(OPENID_B);
  const crossStatus = await call('account.exportStatus', { jobId: jobA1 });
  s5.check('B 查询 A 的导出状态被拒', crossStatus.ok, false);
  s5.fact('B 查询 A 状态错误码', crossStatus.error?.code);

  // ------------------------------------------- S6: 24h file expiry boundary
  const s6 = scenario(
    'S6',
    '文件到期边界与到期后拒绝领取',
    '到期前 1 秒可领取；到达期即过期并拒领',
  );
  advanceTo(new Date(T0 + 24 * HOUR - 1000).toISOString());
  as(OPENID_A);
  const statusBefore = await call('account.exportStatus', { jobId: jobA1 });
  s6.check('到期前状态 ready', statusBefore.data?.state, 'ready');
  const dlBefore = await call('account.downloadExport', { jobId: jobA1 });
  s6.check('到期前仍可领取', dlBefore.ok, true);
  advanceTo(new Date(T0 + 24 * HOUR).toISOString());
  const statusAt = await call('account.exportStatus', { jobId: jobA1 });
  s6.check('到期时刻状态 expired', statusAt.data?.state, 'expired');
  const dlAt = await call('account.downloadExport', { jobId: jobA1 });
  s6.check('到期后拒绝领取', dlAt.ok, false);
  s6.fact('到期后错误码', dlAt.error?.code);
  s6.fact('到期后错误文案', dlAt.error?.message);

  // ------------------------------------- S7: source change invalidates job
  const s7 = scenario(
    'S7',
    '记录改动使旧导出失效，重新申请拿到新内容',
    '旧任务 expired 且拒领；新任务含编辑后正文',
  );
  as(OPENID_A);
  const reqA3 = await call('account.requestExport', { format: 'json' });
  s7.check('A 新任务 ready', reqA3.data?.state, 'ready');
  const dlA3 = await call('account.downloadExport', { jobId: reqA3.data?.jobId });
  s7.check('改动前可领取', dlA3.ok, true);
  const edit = await call('journal.upsert', {
    date: '2026-11-17',
    weather: 'SUNNY',
    tags: ['STUDY', 'CALM'],
    text: A_TEXT_EDIT,
    expectedVersion: 1,
  });
  s7.check('A 编辑记录成功', edit.ok, true);
  const statusAfterEdit = await call('account.exportStatus', { jobId: reqA3.data?.jobId });
  s7.check('来源变化后状态 expired', statusAfterEdit.data?.state, 'expired');
  const dlAfterEdit = await call('account.downloadExport', { jobId: reqA3.data?.jobId });
  s7.check('来源变化后拒领', dlAfterEdit.ok, false);
  s7.fact('拒领错误码', dlAfterEdit.error?.code);
  const reqA5 = await call('account.requestExport', { format: 'markdown' });
  const dlA5 = await call('account.downloadExport', { jobId: reqA5.data?.jobId });
  s7.check('重新申请可领取', dlA5.ok, true);
  s7.check('新内容包含编辑后正文', (dlA5.data?.content || '').includes(A_TEXT_EDIT), true);
  s7.check('新内容不再含旧正文', (dlA5.data?.content || '').includes(A_TEXT_1), false);

  // ------------------------------------------- S7b: stored body integrity check
  const s7b = scenario('S7b', '库内正文被改动后拒绝领取', '哈希/字节不符即拒，不返回被篡改内容');
  const tamperedKey = 'export_jobs:' + reqA5.data.jobId;
  const originalRow = memory.inspect()[tamperedKey];
  memory.put('export_jobs', {
    ...originalRow,
    content: originalRow.content + '\nSIMULATED-TAMPER',
  });
  const tampered = await call('account.downloadExport', { jobId: reqA5.data.jobId });
  s7b.check('被篡改正文拒绝领取', tampered.ok, false);
  s7b.fact('篡改后错误码', tampered.error?.code);
  memory.put('export_jobs', originalRow);
  const restored = await call('account.downloadExport', { jobId: reqA5.data.jobId });
  s7b.check('恢复原文后可领取', restored.ok, true);

  // ------------------------------------------ S8: maintenance expires bodies
  const s8 = scenario(
    'S8',
    '维护任务清理到期导出正文',
    '正文/哈希/字节/文件引用移除，任务元数据保留，重跑幂等',
  );
  const readyBeforeMaintenance = Object.entries(memory.inspect()).filter(
    ([key, row]) => key.startsWith('export_jobs:') && row.state === 'ready',
  );
  s8.fact('维护前 ready 任务数', readyBeforeMaintenance.length);
  advanceTo(new Date(T0 + 49 * HOUR).toISOString());
  const firstRun = await maintenance();
  s8.check('首次维护过期数量', firstRun, readyBeforeMaintenance.length);
  const secondRun = await maintenance();
  s8.check('二次维护幂等（0）', secondRun, 0);
  const afterMaintenance = memory.inspect();
  const expiredJobs = Object.entries(afterMaintenance).filter(
    ([key, row]) => key.startsWith('export_jobs:') && row.state === 'expired',
  );
  s8.check('全部转 expired', expiredJobs.length, readyBeforeMaintenance.length);
  s8.check(
    'expired 行不含 content',
    expiredJobs.some(([, row]) => Object.hasOwn(row, 'content')),
    false,
  );
  s8.check(
    'expired 行 fileId 为 null',
    expiredJobs.every(([, row]) => row.fileId === null),
    true,
  );
  s8.check(
    'expired 行保留 ownerId/format',
    expiredJobs.every(
      ([, row]) => typeof row.ownerId === 'string' && typeof row.format === 'string',
    ),
    true,
  );
  s8.check(
    'expired 行不含 contentSha256',
    expiredJobs.some(([, row]) => Object.hasOwn(row, 'contentSha256')),
    false,
  );
  s8.fact(
    'A 任务示例（脱敏）',
    expiredJobs.map(([, row]) => ({
      state: row.state,
      format: row.format,
      hasContent: Object.hasOwn(row, 'content'),
    })),
  );

  // ------------------------------ S9: ready file then deactivation (residue)
  const s9 = scenario(
    'S9',
    '停用后领取拒绝，正文成为待清理残留',
    '停用后 ACCOUNT_DISABLED；文件正文仍在库内待清理',
  );
  as(OPENID_A);
  const reqA6 = await call('account.requestExport', { format: 'json' });
  s9.check('停用前 A 仍可生成导出', reqA6.data?.state, 'ready');
  const jobA6 = reqA6.data?.jobId;
  const beforeClose = memory.inspect();
  s9.check('停用前正文已入库', typeof beforeClose['export_jobs:' + jobA6]?.content, 'string');
  const closeA = await call('account.close', { confirm: 'CLOSE' });
  s9.check('A 注销成功', closeA.ok, true);
  s9.check('账号状态', closeA.data?.accountStatus, 'disabled');
  s9.check('私有动作被拒标记', closeA.data?.privateActionsDenied, true);
  s9.check('返回清理任务', typeof closeA.data?.cleanup?.jobId, 'string');
  s9.fact('清理任务状态', closeA.data?.cleanup?.state);
  s9.fact('回执长度', closeA.data?.receipt?.length ?? 0);
  const closedState = memory.inspect();
  s9.check('账号已停用', closedState['accounts:' + OWNER_A].status, 'disabled');
  s9.check(
    '清理任务 exportAccessRevoked',
    closedState['cleanup_jobs:' + closeA.data.cleanup.jobId]?.exportAccessRevoked,
    true,
  );
  s9.check('停用后正文仍在（残留）', typeof closedState['export_jobs:' + jobA6]?.content, 'string');
  const statusAfterClose = await call('account.exportStatus', { jobId: jobA6 });
  s9.check('停用后查询导出被拒', statusAfterClose.ok, false);
  s9.fact('停用后导出查询错误码', statusAfterClose.error?.code);
  const dlAfterClose = await call('account.downloadExport', { jobId: jobA6 });
  s9.check('停用后领取被拒', dlAfterClose.ok, false);
  s9.fact('停用后领取错误码', dlAfterClose.error?.code);
  const privateAfterClose = await call('journal.get', { date: '2026-11-17' });
  s9.check('停用后私人记录读取被拒', privateAfterClose.ok, false);
  s9.fact('停用后记录读取错误码', privateAfterClose.error?.code);
  const newExportAfterClose = await call('account.requestExport', { format: 'json' });
  s9.check('停用后不能再申请导出', newExportAfterClose.ok, false);
  s9.fact('停用后申请导出错误码', newExportAfterClose.error?.code);

  // --------------------------------------------- S10: batched cleanup by worker
  const s10 = scenario(
    'S10',
    '分批清理：每批进度与最终回执',
    '逐批推进、总数等于实际删除数、B 与公共数据完整',
  );
  const cleanupJob = closeA.data.cleanup.jobId;
  const beforeCleanup = memory.inspect();
  const countFor = (state, ownerId) =>
    Object.entries(state).filter(
      ([key, row]) =>
        !key.startsWith('places:') &&
        !key.startsWith('task_templates:') &&
        // The cleanup job is the executor ledger, not owner business data.
        !key.startsWith('cleanup_jobs:') &&
        row &&
        row.ownerId === ownerId,
    ).length;
  const aRowsBefore = countFor(beforeCleanup, OWNER_A);
  const bRowsBefore = countFor(beforeCleanup, OWNER_B);
  s10.fact('清理前 A 业务行总数（不含公共集合）', aRowsBefore);
  s10.fact('清理前 B 业务行总数', bRowsBefore);
  as(OPENID_B);
  const bBefore = await call('account.requestExport', { format: 'json' });
  const bBeforeContent = (await call('account.downloadExport', { jobId: bBefore.data?.jobId })).data
    ?.content;
  s10.check('清理前 B 导出可取', typeof bBeforeContent, 'string');
  const progressLog = [];
  let lastProgress = {};
  let steps = 0;
  for (; steps < 40; steps += 1) {
    const result = await cleanup.step(cleanupJob);
    progressLog.push({ step: steps + 1, state: result.state, progress: result.progress });
    lastProgress = result.progress;
    if (result.state === 'completed') {
      break;
    }
  }
  s10.check(
    '清理在有限步内完成',
    lastProgress && Object.values(lastProgress).reduce((a, b) => a + b, 0) > 0,
    true,
  );
  const jobFinal = memory.inspect()['cleanup_jobs:' + cleanupJob];
  s10.check('最终状态 completed', jobFinal.state, 'completed');
  s10.fact('完成所用批次数', steps + 1);
  s10.fact('各集合进度', jobFinal.progress);
  const total = Object.values(jobFinal.progress).reduce((a, b) => a + b, 0);
  s10.check('进度总数等于清理前 A 行数', total, aRowsBefore);
  s10.check('收藏分两批（10+1）', jobFinal.progress.favorites, 11);
  const afterCleanup = memory.inspect();
  s10.check('A 业务行已清空', countFor(afterCleanup, OWNER_A), 0);
  const businessIds = (state, ownerId) =>
    Object.entries(state)
      .filter(([key, row]) => !key.startsWith('export_jobs:') && row && row.ownerId === ownerId)
      .map(([key]) => key)
      .sort();
  s10.check(
    'B 业务行逐行保持（键集合一致）',
    JSON.stringify(businessIds(afterCleanup, OWNER_B)),
    JSON.stringify(businessIds(beforeCleanup, OWNER_B)),
  );
  s10.check('公共地点未被删除', Boolean(afterCleanup['places:place_campus_library']), true);
  s10.check('任务模板未被删除', Boolean(afterCleanup['task_templates:breathing-3']), true);
  s10.check('A 的导出正文已随清理删除', Boolean(afterCleanup['export_jobs:' + jobA6]), false);
  s10.check('A 账号墓碑保留', afterCleanup['accounts:' + OWNER_A]?.status, 'disabled');
  s10.fact('墓碑字段', Object.keys(afterCleanup['accounts:' + OWNER_A]).sort());
  const repeat = await cleanup.step(cleanupJob);
  s10.check('清理任务重放幂等', repeat.state, 'completed');
  const bAfter = await call('account.requestExport', { format: 'json' });
  const bAfterContent = (await call('account.downloadExport', { jobId: bAfter.data?.jobId })).data
    ?.content;
  s10.check('A 清理后 B 导出内容逐字节不变', bAfterContent === bBeforeContent, true);
  fs.writeFileSync(
    path.join(OUT, 'cleanup-progress.csv'),
    ['batch,state,' + Object.keys(lastProgress).sort().join(',')]
      .concat(
        progressLog.map((entry) =>
          [entry.step, entry.state]
            .concat(
              Object.keys(lastProgress)
                .sort()
                .map((key) => entry.progress[key] ?? 0),
            )
            .join(','),
        ),
      )
      .join('\n') + '\n',
  );

  // ---------------------------------------- S11: after cleanup, recovery checks
  const s11 = scenario(
    'S11',
    '清理后恢复验证：A 不可复活，B 仍可用',
    'A 登录/导出被拒；B 状态查询与领取正常',
  );
  as(OPENID_A);
  const sessionA = await call('account.session');
  s11.check('A 重新登录被拒', sessionA.ok, false);
  s11.fact('A 登录错误码', sessionA.error?.code);
  as(OPENID_B);
  const sessionB = await call('account.session');
  s11.check('B 仍可登录', sessionB.ok, true);
  const reqB2 = await call('account.requestExport', { format: 'json' });
  s11.check('B 仍可申请导出', reqB2.data?.state, 'ready');
  const dlB2 = await call('account.downloadExport', { jobId: reqB2.data?.jobId });
  s11.check('B 仍可领取', dlB2.ok, true);
  const afterAll = memory.inspect();
  s11.fact(
    'A 残留键（不含公共集合）',
    Object.keys(afterAll).filter((key) => {
      const row = afterAll[key];
      return row && row.ownerId === OWNER_A;
    }),
  );
  s11.fact(
    '清理后 A 相关非业务文档',
    Object.keys(afterAll).filter((key) => key.includes(OWNER_A)),
  );

  // ------------------------------------- S12: cleanup progress receipt attempt
  const s12 = scenario(
    'S12',
    '凭回执查询清理进度（生产路径实测）',
    '记录回执路径的实际结果：可用或明确阻塞',
  );
  as(OPENID_A);
  const receiptQuery = await call('account.cleanupStatus', {
    jobId: cleanupJob,
    receipt: closeA.data.receipt,
  });
  s12.fact('回执查询是否成功', receiptQuery.ok);
  s12.fact('回执查询结果或错误码', receiptQuery.ok ? receiptQuery.data : receiptQuery.error?.code);
  s12.fact('回执查询错误文案', receiptQuery.ok ? null : receiptQuery.error?.message);

  // ---------------------------------------------------------------- evidence
  // Coverage table: what the exporter projects per collection, and what it must not.
  const countBy = (state, name, ownerId) => {
    if (name === 'accounts') {
      return state['accounts:' + ownerId] ? 1 : 0;
    }
    if (name === 'places' || name === 'task_templates') {
      // Public catalogue material: never owner-scoped, must survive untouched.
      return Object.keys(state).filter((key) => key.startsWith(name + ':')).length;
    }
    return Object.entries(state).filter(
      ([key, row]) => key.startsWith(name + ':') && row && row.ownerId === ownerId,
    ).length;
  };
  const coverageRows = [
    [
      'journals',
      'date,weather,weatherName,tags,text,version,createdAt,updatedAt',
      'ownerId,_id,entryId,state,layout,存储元数据；state=deleted 的行整行排除',
      parsedA.data.journals.length,
      parsedB.data.journals.length,
    ],
    [
      'favorites',
      'placeId,placeName,createdAt',
      'ownerId,_id',
      parsedA.data.favorites.length,
      parsedB.data.favorites.length,
    ],
    [
      'task_history',
      'taskId,taskTitle,date,state,createdAt',
      'ownerId,_id',
      parsedA.data.taskHistory.length,
      parsedB.data.taskHistory.length,
    ],
    [
      'preferences',
      'cardTextPreview,decorationsEnabled,updatedAt,profile(nickname/avatar)',
      'ownerId,_id,openid',
      parsedA.data.preferences ? 1 : 0,
      parsedB.data.preferences ? 1 : 0,
    ],
    [
      'month_decorations',
      'month,version,stickers(stickerId,targetDate),backgroundId',
      'ownerId,_id,targetEntryId；丢失/跨月目标被过滤',
      parsedA.data.monthDecorations.length,
      parsedB.data.monthDecorations.length,
    ],
    [
      'place_checkins + campus_checkin_states.visits',
      'placeId,date,completedAt(,placeName,selfReported)',
      'ownerId,_id,owner,requests,revision',
      parsedA.data.checkins?.length ?? 0,
      parsedB.data.checkins?.length ?? 0,
    ],
    [
      '(顶层)',
      'exportVersion,exportedAt,data',
      'ownerId,accountStatus,accountEpoch,sourceRevisions,fileId,contentSha256',
      1,
      1,
    ],
  ];
  fs.writeFileSync(
    path.join(OUT, 'coverage.csv'),
    ['集合,导出字段,排除字段,A条数,B条数']
      .concat(
        coverageRows.map((row) =>
          row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','),
        ),
      )
      .join('\n') + '\n',
  );
  const cleanupCollections = Array.from(
    new Set(
      Object.keys(beforeCleanup)
        .map((key) => key.split(':')[0])
        .concat(Object.keys(afterCleanup).map((key) => key.split(':')[0])),
    ),
  ).sort();
  fs.writeFileSync(
    path.join(OUT, 'cleanup-before-after.csv'),
    ['集合,A清理前,A清理后,B清理前,B清理后,公共']
      .concat(
        cleanupCollections.map((collectionName) =>
          [
            collectionName,
            countBy(beforeCleanup, collectionName, OWNER_A),
            countBy(afterCleanup, collectionName, OWNER_A),
            countBy(beforeCleanup, collectionName, OWNER_B),
            countBy(afterCleanup, collectionName, OWNER_B),
            ['places', 'task_templates'].includes(collectionName) ? '是（未触碰）' : '否',
          ].join(','),
        ),
      )
      .join('\n') + '\n',
  );
  const failures = scenarios.filter((item) => !item.pass);
  const report = {
    tool: 'tools/week6-xy/verify-export-cleanup.cjs',
    environment: {
      node: process.version,
      platform: process.platform,
      storage: 'in-memory WX-shaped fixture (SIMULATED)',
      network: 'none',
      sdk: 'none',
      buildCommit: process.env.MOODSKY_BUILD_COMMIT || null,
    },
    syntheticActors: { A: OWNER_A, B: OWNER_B },
    startedAtUtc: new Date(T0).toISOString(),
    outcomes: scenarios.map((item) => ({
      id: item.id,
      title: item.title,
      expected: item.expected,
      pass: item.pass,
      checks: item.checks,
    })),
    summary: {
      scenarios: scenarios.length,
      passed: scenarios.length - failures.length,
      failed: failures.length,
    },
    residue: {
      afterMaintenance: Object.entries(afterMaintenance)
        .filter(([key]) => key.startsWith('export_jobs:'))
        .map(([key, row]) => ({
          jobIdTail: key.slice(-6),
          state: row.state,
          keys: Object.keys(row).sort(),
        })),
      afterCleanupA: Object.keys(afterCleanup)
        .filter((key) => key.includes(OWNER_A) || afterCleanup[key]?.ownerId === OWNER_A)
        .sort(),
    },
  };
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(report, null, 2) + '\n');
  for (const item of scenarios) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.id} ${item.title}`);
    for (const check of item.checks.filter((entry) => !entry.ok)) {
      console.log(
        `  - ${check.label}: actual=${JSON.stringify(check.actual)} expected=${JSON.stringify(check.expected)}`,
      );
    }
  }
  console.log(
    `\n${report.summary.passed}/${report.summary.scenarios} scenarios passed; evidence -> ${path.relative(REPO, OUT)}`,
  );
  return failures.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(2);
  });
