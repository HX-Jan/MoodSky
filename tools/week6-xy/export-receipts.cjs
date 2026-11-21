#!/usr/bin/env node
// W6XY / DD-07 handoff: emit export samples and the real service receipts that
// the account page consumes (ready, invalidated, expired, disabled, cleanup).
//
//   node tools/week6-xy/export-receipts.cjs [--out <dir>]
//
// Same synthetic fixture as verify-export-cleanup.cjs: production entry, in-memory
// WX-shaped database, injected clock. Prints nothing private: file bodies go to
// the sample files, receipts keep only metadata.
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryDatabase } = require('./memory-database');
const { createProductionEntry } = require('../../cloudfunctions/moodsky/production');
const { createProductionCleanup } = require('../../cloudfunctions/moodsky/production/cleanup');
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
  outIndex === -1 ? path.join(REPO, 'docs/week6/XiangYu/dd07-handoff') : args[outIndex + 1],
);

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'true',
});

const OPENID_A = 'SIMULATED_DD07_A';
const OPENID_B = 'SIMULATED_DD07_B';
const OWNER_A = accountId(config, OPENID_A);
const OWNER_B = accountId(config, OPENID_B);
const HOUR = 3600000;
let clockNow = Date.parse('2026-11-21T02:00:00.000Z');
const clock = () => new Date(clockNow);
let currentOpenid = OPENID_A;
const identity = () => ({
  APPID: APP_ID,
  ENV: ENV_ID,
  SOURCE: 'wx_devtools',
  OPENID: currentOpenid,
  identityFromCurrentInvocation: true,
});

let sequence = 0;
const createRequest = (action, payload) => ({
  apiVersion: '1',
  requestId: 'req_dd07_' + String(++sequence).padStart(4, '0') + '_' + process.pid.toString(36),
  action,
  payload,
});

const JOURNAL_A =
  'SIMULATED-DD07 记录：今天多云，去操场走了两圈，回来把导出样例整理完。\n第二行用来检查换行是否保留。';
const JOURNAL_A_EDIT = 'SIMULATED-DD07 记录（编辑后 version=2）：内容已修改，旧导出应失效。';

const cases = [];
function record(id, event, requestLabel, response, ui, c3) {
  cases.push({ id, event, request: requestLabel, response, ui, c3 });
}

// File bodies are replaced with a marker; the real bytes live in the sample files.
function redactBody(envelope) {
  const copy = JSON.parse(JSON.stringify(envelope));
  if (copy.data && typeof copy.data.content === 'string') {
    copy.data.content =
      '<omitted: see export-sample-' + copy.data.format + '.' + copy.data.extension + '>';
  }
  if (copy.data && typeof copy.data.receipt === 'string') {
    copy.data.receipt = '<redacted:' + copy.data.receipt.length + '-chars>';
  }
  return copy;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const memory = createMemoryDatabase();
  const db = memory.db;
  const entry = createProductionEntry({
    readConfig: () => config,
    openDatabase: () => db,
    now: clock,
    readIdentity: () => identity(),
  });
  const cleanup = createProductionCleanup({ db, now: clock });
  const scopes = new Map();
  async function signIn(openid) {
    currentOpenid = openid;
    const result = await entry(createRequest('account.session', {}));
    if (result.ok) {
      scopes.set(openid, result.data.scope);
    }
    return result;
  }
  async function call(openid, action, payload = {}) {
    currentOpenid = openid;
    const request = createRequest(action, payload);
    const scope = scopes.get(openid);
    return entry(scope ? { ...request, sessionScope: scope } : request);
  }

  await signIn(OPENID_A);
  await signIn(OPENID_B);

  // Synthetic data: one journal through the real API, one saved preference.
  await call(OPENID_A, 'journal.upsert', {
    date: '2026-11-21',
    weather: 'PARTLY_CLOUDY',
    tags: ['REST', 'CALM'],
    text: JOURNAL_A,
    expectedVersion: 0,
  });
  await call(OPENID_A, 'account.preferences', {
    operation: 'set',
    cardTextPreview: true,
    decorationsEnabled: true,
  });
  // A second, older journal row shaped like the repository output so the sample
  // shows date ordering and the deleted row exclusion.
  memory.put('journals', {
    _id: 'dd07_seed_older',
    ownerId: OWNER_A,
    entryId: 'entry-dd07-older',
    date: '2026-11-19',
    weather: 'RAINY',
    tags: ['TIREDNESS'],
    text: 'SIMULATED-DD07 较早记录：补交的旧日期。',
    version: 1,
    state: 'active',
    createdAt: new Date('2026-11-19T12:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-11-19T12:00:00.000Z').toISOString(),
  });
  memory.put('journals', {
    _id: 'dd07_seed_deleted',
    ownerId: OWNER_A,
    entryId: 'entry-dd07-deleted',
    date: '2026-11-20',
    weather: 'STORMY',
    tags: [],
    text: 'SIMULATED-DD07 已删除记录：不应出现在导出里。',
    version: 2,
    state: 'deleted',
    createdAt: new Date('2026-11-20T03:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-11-20T04:00:00.000Z').toISOString(),
  });

  // R1—R3: JSON export, status, claim.
  const jsonRequest = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  record(
    'R1',
    '申请 JSON 导出（state=ready）',
    'account.requestExport {format:"json"}',
    jsonRequest,
    '按钮进入「可领取」，出现保存/预览入口',
  );
  const jsonStatus = await call(OPENID_A, 'account.exportStatus', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R2',
    '查询导出状态（ready）',
    'account.exportStatus {jobId}',
    jsonStatus,
    '状态「可领取」，格式标识 JSON',
  );
  const jsonDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R3',
    '领取 JSON 文件',
    'account.downloadExport {jobId}',
    jsonDownload,
    '保存文件/预览内容，文件名用 extension',
  );
  fs.writeFileSync(path.join(OUT, 'export-sample-json.json'), jsonDownload.data?.content ?? '');

  // R4: Markdown sample.
  const markdownRequest = await call(OPENID_A, 'account.requestExport', { format: 'markdown' });
  const markdownDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R4',
    '申请并领取 Markdown 文件',
    'account.requestExport {format:"markdown"} → account.downloadExport {jobId}',
    markdownDownload,
    '状态「可领取」，格式标识 Markdown，扩展名 md',
  );
  fs.writeFileSync(
    path.join(OUT, 'export-sample-markdown.md'),
    markdownDownload.data?.content ?? '',
  );

  // R5—R6: source change invalidates the ready job.
  await call(OPENID_A, 'journal.upsert', {
    date: '2026-11-21',
    weather: 'PARTLY_CLOUDY',
    tags: ['REST', 'CALM'],
    text: JOURNAL_A_EDIT,
    expectedVersion: 1,
  });
  const invalidated = await call(OPENID_A, 'account.exportStatus', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R5',
    '记录改动后查询旧导出（来源失效）',
    'account.exportStatus {jobId}（旧 jobId）',
    invalidated,
    '状态「已过期」，提示保留格式重新申请；不写旧文件',
  );
  const invalidatedDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: jsonRequest.data.jobId,
  });
  record(
    'R6',
    '记录改动后领取旧导出',
    'account.downloadExport {jobId}（旧 jobId）',
    invalidatedDownload,
    '回查状态为 expired → 「导出已过期，请保留所选格式并重新申请。」；不直接显示服务端文案',
  );

  // R7—R8: 24-hour file expiry.
  clockNow += 24 * HOUR + 1000;
  const expiredStatus = await call(OPENID_A, 'account.exportStatus', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R7',
    '文件到期后查询状态（24 小时整点即过期）',
    'account.exportStatus {jobId}',
    expiredStatus,
    '状态「已过期」，与来源失效同一文案，用户只需重新申请',
  );
  const expiredDownload = await call(OPENID_A, 'account.downloadExport', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R8',
    '文件到期后领取',
    'account.downloadExport {jobId}',
    expiredDownload,
    '同 R6；按回查状态显示过期文案，不得声称「仍在生成」',
  );

  // R9: cross-account claim is refused before any content is returned.
  const crossAccount = await call(OPENID_B, 'account.exportStatus', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R9',
    'B 账号查询 A 的导出',
    'account.exportStatus {jobId}（他人 jobId）',
    crossAccount,
    '按不可见处理：不显示他人任务，也不提示任务是否存在（文案与 CONFLICT 相同）',
  );

  // R10—R12: account disabled, then the private actions are refused.
  const closed = await call(OPENID_A, 'account.close', { confirm: 'CLOSE' });
  record(
    'R10',
    '注销账号（返回清理任务与回执）',
    'account.close {confirm:"CLOSE"}',
    closed,
    '「账号已停用。清理进度以服务器返回为准。」',
  );
  const disabledStatus = await call(OPENID_A, 'account.exportStatus', {
    jobId: markdownRequest.data.jobId,
  });
  record(
    'R11',
    '停用后查询导出状态',
    'account.exportStatus {jobId}',
    disabledStatus,
    '提示「账号已停用。」，不展示导出状态',
  );
  const disabledRequest = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  record(
    'R12',
    '停用后申请新导出',
    'account.requestExport {format:"json"}',
    disabledRequest,
    '禁用申请入口，提示账号已停用',
  );

  // R13—R14: cleanup progress through the receipt-gated read.
  const cleanupJob = closed.data.cleanup.jobId;
  const receipt = closed.data.receipt;
  await cleanup.step(cleanupJob);
  const partial = await call(OPENID_A, 'account.cleanupStatus', { jobId: cleanupJob, receipt });
  record(
    'R13',
    '清理进行中的进度回执',
    'account.cleanupStatus {jobId, receipt}',
    partial,
    '按集合显示已删除计数，处理中可继续刷新',
  );
  for (let step = 0; step < 20; step += 1) {
    const result = await cleanup.step(cleanupJob);
    if (result.state === 'completed') {
      break;
    }
  }
  const done = await call(OPENID_A, 'account.cleanupStatus', { jobId: cleanupJob, receipt });
  record(
    'R14',
    '清理完成回执',
    'account.cleanupStatus {jobId, receipt}',
    done,
    '显示「清理完成」与总量；不显示正文或文件引用',
  );

  // R15: a status refresh that carries an unknown job id must not replace the
  // confirmed task.
  const unknownJob = await call(OPENID_B, 'account.exportStatus', {
    jobId: 'dd07_unknown_job_id_value',
  });
  record(
    'R15',
    '状态刷新携带不匹配的 jobId',
    'account.exportStatus {jobId:"dd07_unknown_job_id_value"}',
    unknownJob,
    '拒绝替换已确认任务，保留当前导出视图，不显示不匹配任务',
  );

  // R16: the cleanup receipt is the only key that unlocks progress.
  const receiptless = await call(OPENID_A, 'account.cleanupStatus', { jobId: cleanupJob });
  record(
    'R16',
    '缺少注销回执读取清理进度',
    'account.cleanupStatus {jobId}（无 receipt）',
    receiptless,
    '提示需要注销回执；不得显示任何进度或分项',
  );

  const c3ByCase = {
    R1: '正常领取（state=ready）',
    R2: '正常领取（state=ready）',
    R3: '正常领取（state=ready）',
    R4: '正常领取（state=ready）',
    R5: '记录改动使旧导出失效',
    R6: '记录改动使旧导出失效；下载冲突但服务端仍可领取',
    R7: '任务到期（time／source）',
    R8: '任务到期（time／source）',
    R9: '状态刷新返回不匹配（他人 jobId 按不可见处理）',
    R10: '清理进度（注销后）',
    R11: '账号停用后新建导出',
    R12: '账号停用后新建导出',
    R13: '清理进度（注销后）',
    R14: '清理进度（注销后）',
    R15: '状态刷新返回不匹配',
    R16: '清理进度（注销后）',
  };
  cases.forEach((item) => {
    item.c3 = c3ByCase[item.id] || '';
  });

  const report = {
    tool: 'tools/week6-xy/export-receipts.cjs',
    purpose: 'DD-07 界面对齐：导出文件样例与服务端回执',
    environment: {
      node: process.version,
      platform: process.platform,
      storage: 'in-memory WX-shaped fixture (SIMULATED)',
      network: 'none',
      buildCommit: process.env.MOODSKY_BUILD_COMMIT || null,
    },
    syntheticActors: { A: OWNER_A, B: OWNER_B },
    clock: {
      startUtc: new Date(Date.parse('2026-11-21T02:00:00.000Z')).toISOString(),
      note: '时钟注入推进：24 小时到期与清理分批均在本地时间轴完成，未等待真实时间',
    },
    cases: cases.map((item) => ({ ...item, response: redactBody(item.response) })),
  };
  fs.writeFileSync(path.join(OUT, 'receipts.json'), JSON.stringify(report, null, 2) + '\n');

  const messageOf = (item) =>
    item.response?.ok ? '—' : item.response?.error?.code + ' / ' + item.response?.error?.message;
  const summary = (item) => {
    if (!item.response?.ok) {
      return '';
    }
    const data = item.response.data || {};
    const fields = ['jobId', 'state', 'format', 'extension', 'byteLength'].filter(
      (key) => data[key] !== undefined,
    );
    if (data.accountStatus) {
      return 'accountStatus=' + data.accountStatus + '；cleanup=' + JSON.stringify(data.cleanup);
    }
    if (data.progress) {
      return 'state=' + data.state + '；progress=' + JSON.stringify(data.progress);
    }
    return fields.map((key) => key + '=' + data[key]).join('；');
  };
  const matrix = [
    ['编号', '事件', '请求', '服务返回', '界面应采用', '对应 C3 行'],
    ...cases.map((item) => [
      item.id,
      item.event,
      item.request,
      item.response?.ok ? 'ok: ' + summary(item) : messageOf(item),
      item.ui,
      item.c3,
    ]),
  ];
  fs.writeFileSync(
    path.join(OUT, 'receipt-matrix.csv'),
    matrix
      .map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
      .join('\n') + '\n',
  );
  console.log('cases=' + cases.length + ' -> ' + path.relative(REPO, OUT));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
