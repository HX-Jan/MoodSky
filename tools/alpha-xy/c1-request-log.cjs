#!/usr/bin/env node
// C1-XY: redacted request/response log for export and account operations.
//
//   node tools/alpha-xy/c1-request-log.cjs [--out <dir>] [--build-sha <sha>]
//
// This runs the production business entry (cloudfunctions/moodsky/production)
// against an in-memory WX-shaped database inside one Node process. It does not
// call the WeChat cloud, does not deploy a cloud function and never touches a
// real account, so every line is labelled environmentLabel="local-simulated".
//
// Only the fields listed below are written per entry. Values that could carry
// personal data or credentials (openid, accountId, jobId, receipt, artifact
// content, journal text) are never serialised: ids are used internally only,
// payloads are reduced to key names and responses to key names.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
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
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const OUT = path.resolve(
  valueOf('--out') || path.join(REPO, 'docs/alpha/xiang-yu/c1-20261121/request-log'),
);

// Resolve both ordinary checkouts and linked worktrees without invoking Git.
function readGitHead(repo) {
  const gitPath = path.join(repo, '.git');
  if (!fs.existsSync(gitPath)) {
    return null;
  }
  const gitDir = fs.statSync(gitPath).isDirectory()
    ? gitPath
    : path.resolve(
        repo,
        fs
          .readFileSync(gitPath, 'utf8')
          .trim()
          .replace(/^gitdir:\s*/, ''),
      );
  const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  if (!head.startsWith('ref: ')) {
    return head;
  }
  const ref = head.slice(5).trim();
  const commonFile = path.join(gitDir, 'commondir');
  const commonDir = fs.existsSync(commonFile)
    ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim())
    : gitDir;
  const refFile = path.join(commonDir, ref);
  if (fs.existsSync(refFile)) {
    return fs.readFileSync(refFile, 'utf8').trim();
  }
  const packedFile = path.join(commonDir, 'packed-refs');
  if (fs.existsSync(packedFile)) {
    for (const line of fs.readFileSync(packedFile, 'utf8').split('\n')) {
      const match = /^([0-9a-f]{40})\s+(.+)$/.exec(line.trim());
      if (match && match[2] === ref) {
        return match[1];
      }
    }
  }
  return null;
}

const BUILD_SHA = valueOf('--build-sha') || readGitHead(REPO);
if (!BUILD_SHA || !/^[0-9a-f]{40}$/.test(BUILD_SHA)) {
  throw new Error('无法确定完整构建 SHA；请传入 --build-sha <40 位 SHA>。');
}

const ENVIRONMENT_LABEL = 'local-simulated';
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '44'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '55'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '66'.repeat(32),
  MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED: 'true',
});

// Synthetic identities. These strings exist only inside this process; they are
// listed as forbidden tokens in the self-check and never reach the log.
const OPENID_A = 'SIMULATED_C1LOG_A';
const OPENID_B = 'SIMULATED_C1LOG_B';
const OWNER_A = accountId(config, OPENID_A);
const OWNER_B = accountId(config, OPENID_B);
const START = Date.parse('2026-11-24T02:00:00.000Z');
const STEP = 1000;

const TEXT_A_OLD = 'SIMULATED-C1LOG A 较早记录：上午在图书馆自习。';
const TEXT_A_NEW = 'SIMULATED-C1LOG A 修改后的记录：内容已变化，旧导出必须失效。';
const TEXT_B = 'SIMULATED-C1LOG B 的记录：与 A 无关。';

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

// Minimal fixture: two active journals for A, one for B, one favorite and one
// preferences row (preferences are created by the real account.preferences
// action below, not seeded, so the revision counter advances through code).
function buildFixture() {
  return [
    {
      name: 'journals',
      rows: [
        {
          _id: 'c1log_a_journal_1',
          ownerId: OWNER_A,
          entryId: 'entry-c1log-a-2026-11-19',
          date: '2026-11-19',
          weather: 'RAINY',
          tags: ['TIREDNESS'],
          text: TEXT_A_OLD,
          version: 1,
          state: 'active',
          createdAt: new Date('2026-11-19T12:00:00.000Z').toISOString(),
          updatedAt: new Date('2026-11-19T12:00:00.000Z').toISOString(),
        },
        {
          _id: 'c1log_a_journal_2',
          ownerId: OWNER_A,
          entryId: 'entry-c1log-a-2026-11-20',
          date: '2026-11-20',
          weather: 'SUNNY',
          tags: ['REST'],
          text: 'SIMULATED-C1LOG A 第二条记录。',
          version: 1,
          state: 'active',
          createdAt: new Date('2026-11-20T12:00:00.000Z').toISOString(),
          updatedAt: new Date('2026-11-20T12:00:00.000Z').toISOString(),
        },
        {
          _id: 'c1log_b_journal_1',
          ownerId: OWNER_B,
          entryId: 'entry-c1log-b-2026-11-18',
          date: '2026-11-18',
          weather: 'CLOUDY',
          tags: [],
          text: TEXT_B,
          version: 1,
          state: 'active',
          createdAt: new Date('2026-11-18T09:00:00.000Z').toISOString(),
          updatedAt: new Date('2026-11-18T09:00:00.000Z').toISOString(),
        },
      ],
    },
    {
      name: 'favorites',
      rows: [
        {
          _id: 'c1log_a_fav_1',
          ownerId: OWNER_A,
          placeId: 'place_c1log_library',
          placeName: 'SIMULATED-C1LOG 收藏-图书馆',
          createdAt: new Date('2026-11-17T01:01:00.000Z').toISOString(),
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
const nextRequest = (action, payload) => ({
  apiVersion: '1',
  requestId: 'req_c1log_' + String(++sequence).padStart(4, '0'),
  action,
  payload,
});

const entries = [];
const checks = [];
const redactRequestId = (requestId) =>
  'req_****' + createHash('sha256').update(requestId, 'utf8').digest('hex').slice(-4);

function resultStateOf(action, response) {
  const data = response.data || {};
  if (action === 'account.session') {
    return 'authenticated';
  }
  if (action === 'account.close') {
    return data.accountStatus || 'closed';
  }
  if (action === 'account.downloadExport') {
    return 'delivered';
  }
  if (action === 'journal.upsert') {
    return 'saved';
  }
  return data.state || 'ok';
}

function record({ action, requestId, payload, actorRole, targetRelation, response }) {
  const ok = response.ok === true;
  const entry = {
    timestamp: new Date(clockNow).toISOString(),
    buildSha: BUILD_SHA,
    environmentLabel: ENVIRONMENT_LABEL,
    action,
    requestIdRedacted: redactRequestId(requestId),
    payloadKeys: Object.keys(payload || {}).sort(),
    actorRole,
    targetRelation,
    ok,
    // Success lists the result-body keys; a refusal lists the envelope keys,
    // matching the sample line in the handover request.
    responseKeyNames: ok ? Object.keys(response.data || {}).sort() : Object.keys(response).sort(),
  };
  if (ok) {
    entry.resultState = resultStateOf(action, response);
  } else {
    entry.errorCode = response.error.code;
  }
  entries.push(entry);
  lastEntry = entry;
  return entry;
}

let lastEntry = null;
const expect = (label, expected, actual) => {
  const match = String(expected) === String(actual);
  checks.push({
    label,
    expected,
    actual,
    match,
    action: lastEntry ? lastEntry.action : '',
    actorRole: lastEntry ? lastEntry.actorRole : '',
    targetRelation: lastEntry ? lastEntry.targetRelation : '',
    timestamp: lastEntry ? lastEntry.timestamp : '',
    requestIdRedacted: lastEntry ? lastEntry.requestIdRedacted : '',
  });
  return match;
};

async function main() {
  const memory = createMemoryDatabase();
  seed(memory);
  const entry = createProductionEntry({
    readConfig: () => config,
    openDatabase: () => memory.db,
    now: clock,
    readIdentity: () => identity(),
  });
  const scopes = new Map();

  async function call(openid, action, payload = {}) {
    currentOpenid = openid;
    clockNow += STEP;
    const request = nextRequest(action, payload);
    const scope = scopes.get(openid);
    if (scope && action !== 'account.session') {
      request.sessionScope = scope;
    }
    return { request, response: await entry(request) };
  }

  async function signIn(openid) {
    const { request, response } = await call(openid, 'account.session', {});
    if (!response.ok) {
      throw new Error('synthetic sign-in failed: ' + JSON.stringify(response));
    }
    scopes.set(openid, response.data.scope);
    return { request, response };
  }

  // 0) Session context for both synthetic actors.
  let result = await signIn(OPENID_A);
  record({
    action: 'account.session',
    requestId: result.request.requestId,
    payload: {},
    actorRole: 'A',
    targetRelation: 'self',
    response: result.response,
  });
  expect('A 会话可用', true, result.response.data.authenticated === true);

  result = await signIn(OPENID_B);
  record({
    action: 'account.session',
    requestId: result.request.requestId,
    payload: {},
    actorRole: 'B',
    targetRelation: 'self',
    response: result.response,
  });
  expect('B 会话可用', true, result.response.data.authenticated === true);

  // 1) A requests its own export.
  const requested = await call(OPENID_A, 'account.requestExport', { format: 'json' });
  const jobId = requested.response.data?.jobId;
  record({
    action: 'account.requestExport',
    requestId: requested.request.requestId,
    payload: { format: 'json' },
    actorRole: 'A',
    targetRelation: 'self',
    response: requested.response,
  });
  expect('A 申请导出成功且就绪', 'ready', requested.response.data?.state);

  // 2) A reads status and claims its own export.
  const statusSelf = await call(OPENID_A, 'account.exportStatus', { jobId });
  record({
    action: 'account.exportStatus',
    requestId: statusSelf.request.requestId,
    payload: { jobId },
    actorRole: 'A',
    targetRelation: 'self',
    response: statusSelf.response,
  });
  expect('A 查询本人导出为可领取', 'ready', statusSelf.response.data?.state);

  const downloadSelf = await call(OPENID_A, 'account.downloadExport', { jobId });
  record({
    action: 'account.downloadExport',
    requestId: downloadSelf.request.requestId,
    payload: { jobId },
    actorRole: 'A',
    targetRelation: 'self',
    response: downloadSelf.response,
  });
  expect(
    'A 领取本人导出成功',
    'delivered',
    resultStateOf('account.downloadExport', downloadSelf.response),
  );

  // 3) B targets A's synthetic job id.
  const statusCross = await call(OPENID_B, 'account.exportStatus', { jobId });
  record({
    action: 'account.exportStatus',
    requestId: statusCross.request.requestId,
    payload: { jobId },
    actorRole: 'B',
    targetRelation: 'cross-account',
    response: statusCross.response,
  });
  expect('B 查询 A 的导出被拒', 'FORBIDDEN', statusCross.response.error?.code);

  const downloadCross = await call(OPENID_B, 'account.downloadExport', { jobId });
  record({
    action: 'account.downloadExport',
    requestId: downloadCross.request.requestId,
    payload: { jobId },
    actorRole: 'B',
    targetRelation: 'cross-account',
    response: downloadCross.response,
  });
  expect('B 领取 A 的导出被拒', 'FORBIDDEN', downloadCross.response.error?.code);

  // 3b) B probes an id that never existed: same refusal, no enumeration oracle.
  const probe = await call(OPENID_B, 'account.exportStatus', { jobId: 'c1log_unknown_job_id' });
  record({
    action: 'account.exportStatus',
    requestId: probe.request.requestId,
    payload: { jobId: 'c1log_unknown_job_id' },
    actorRole: 'B',
    targetRelation: 'cross-account',
    response: probe.response,
  });
  expect('未知 jobId 与跨账号同拒', 'FORBIDDEN', probe.response.error?.code);

  // 4) A edits a source record; the old export must stop being claimable.
  const editPayload = {
    date: '2026-11-21',
    weather: 'RAINY',
    tags: ['TIREDNESS'],
    text: TEXT_A_NEW,
    expectedVersion: 0,
  };
  const edited = await call(OPENID_A, 'journal.upsert', editPayload);
  record({
    action: 'journal.upsert',
    requestId: edited.request.requestId,
    payload: editPayload,
    actorRole: 'A',
    targetRelation: 'self',
    response: edited.response,
  });
  expect('A 修改记录成功', 'saved', resultStateOf('journal.upsert', edited.response));

  const statusStale = await call(OPENID_A, 'account.exportStatus', { jobId });
  record({
    action: 'account.exportStatus',
    requestId: statusStale.request.requestId,
    payload: { jobId },
    actorRole: 'A',
    targetRelation: 'self',
    response: statusStale.response,
  });
  expect('记录改动后旧导出转 expired', 'expired', statusStale.response.data?.state);

  const downloadStale = await call(OPENID_A, 'account.downloadExport', { jobId });
  record({
    action: 'account.downloadExport',
    requestId: downloadStale.request.requestId,
    payload: { jobId },
    actorRole: 'A',
    targetRelation: 'self',
    response: downloadStale.response,
  });
  expect('旧导出领取返回 CONFLICT', 'CONFLICT', downloadStale.response.error?.code);

  // 5) A closes the synthetic account, then retries export operations.
  const closed = await call(OPENID_A, 'account.close', { confirm: 'CLOSE' });
  record({
    action: 'account.close',
    requestId: closed.request.requestId,
    payload: { confirm: 'CLOSE' },
    actorRole: 'A',
    targetRelation: 'self',
    response: closed.response,
  });
  expect('A 注销成功', 'disabled', closed.response.data?.accountStatus);

  const statusAfterClose = await call(OPENID_A, 'account.exportStatus', { jobId });
  record({
    action: 'account.exportStatus',
    requestId: statusAfterClose.request.requestId,
    payload: { jobId },
    actorRole: 'A',
    targetRelation: 'self',
    response: statusAfterClose.response,
  });
  expect('注销后查询导出被拒', 'ACCOUNT_DISABLED', statusAfterClose.response.error?.code);

  const downloadAfterClose = await call(OPENID_A, 'account.downloadExport', { jobId });
  record({
    action: 'account.downloadExport',
    requestId: downloadAfterClose.request.requestId,
    payload: { jobId },
    actorRole: 'A',
    targetRelation: 'self',
    response: downloadAfterClose.response,
  });
  expect('注销后领取导出被拒', 'ACCOUNT_DISABLED', downloadAfterClose.response.error?.code);

  const requestAfterClose = await call(OPENID_A, 'account.requestExport', { format: 'markdown' });
  record({
    action: 'account.requestExport',
    requestId: requestAfterClose.request.requestId,
    payload: { format: 'markdown' },
    actorRole: 'A',
    targetRelation: 'self',
    response: requestAfterClose.response,
  });
  expect('注销后新建导出被拒', 'ACCOUNT_DISABLED', requestAfterClose.response.error?.code);

  // B's own account is untouched by A's close.
  const statusSelfB = await call(OPENID_B, 'account.requestExport', { format: 'json' });
  record({
    action: 'account.requestExport',
    requestId: statusSelfB.request.requestId,
    payload: { format: 'json' },
    actorRole: 'B',
    targetRelation: 'self',
    response: statusSelfB.response,
  });
  expect('B 不受 A 注销影响', 'ready', statusSelfB.response.data?.state);

  writeOutputs({ jobId });
}

function writeOutputs({ jobId }) {
  const allowed = [
    'timestamp',
    'buildSha',
    'environmentLabel',
    'action',
    'requestIdRedacted',
    'payloadKeys',
    'actorRole',
    'targetRelation',
    'ok',
    'resultState',
    'errorCode',
    'responseKeyNames',
  ];
  const forbidden = [
    OPENID_A,
    OPENID_B,
    OWNER_A,
    OWNER_B,
    jobId,
    'c1log_unknown_job_id',
    'v1.',
    TEXT_A_OLD,
    TEXT_A_NEW,
    TEXT_B,
    'SIMULATED-C1LOG 收藏',
    'acct_',
  ].filter(Boolean);
  const ndjson = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

  for (const [index, entry] of entries.entries()) {
    const keys = Object.keys(entry);
    const extra = keys.filter((key) => !allowed.includes(key));
    if (extra.length) {
      throw new Error(`日志字段越界（第 ${index + 1} 条）：${extra.join(', ')}`);
    }
    if ((entry.ok && !entry.resultState) || (!entry.ok && !entry.errorCode)) {
      throw new Error(`日志缺少结果字段（第 ${index + 1} 条）`);
    }
    for (const token of forbidden) {
      if (ndjson.includes(token)) {
        throw new Error(`日志包含禁止值：${token}`);
      }
    }
  }

  const failed = checks.filter((check) => !check.match);
  const summary = {
    generatedAt: new Date().toISOString(),
    buildSha: BUILD_SHA,
    environmentLabel: ENVIRONMENT_LABEL,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      clock: '脚本注入的确定性时钟（2026-11-24T02:00:00Z 起，每条 +1s）',
    },
    environmentNote:
      '本地 Node 进程直接调用生产业务入口 cloudfunctions/moodsky/production，数据库为 WX 形态内存库；未连接微信云、未部署云函数、未使用真实账号或真实设备。',
    dataset: {
      accounts: {
        A: { journals: 2, favorites: 1, preferences: 0 },
        B: { journals: 1, favorites: 0 },
      },
      publicData: '未使用公共地点/模板；本轮只覆盖导出与账号操作。',
      syntheticMarkers: '账号与记录均带 SIMULATED 前缀；真实标识不写入交付文件。',
    },
    entries: entries.length,
    checks: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
    checksDetail: checks,
    redaction: {
      requestId: 'req_**** + sha256(requestId) 末 4 位',
      excluded: [
        'openid',
        'unionid',
        'token',
        'cookie',
        '账号 ID',
        '原始 jobId',
        '原始 receipt',
        '文件引用',
        '正文',
        '昵称',
      ],
    },
    boundaries: [
      '本日志为 local-simulated，不是真实云环境结果；云函数部署、真实触发器、设备送达与备份恢复仍待补验。',
      'planClaim/authorizeRead 300 秒领取凭证仍未接入生产领取路径，本轮未验证。',
      '记录改动只覆盖 journal.upsert；收藏写入入口（campus.favorites）当前返回 NOT_IMPLEMENTED，见 C2 报告。',
    ],
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'request-log.ndjson'), ndjson);
  fs.writeFileSync(path.join(OUT, 'request-log.json'), JSON.stringify(entries, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'run-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const csvRows = [
    [
      '序号',
      'timestamp',
      'requestIdRedacted',
      'action',
      'actorRole',
      'targetRelation',
      '预期',
      '实际',
      '结论',
    ],
  ];
  checks.forEach((check, index) => {
    csvRows.push([
      String(index + 1),
      check.timestamp,
      check.requestIdRedacted,
      check.action,
      check.actorRole,
      check.targetRelation,
      String(check.expected),
      String(check.actual),
      check.match ? '一致' : '不一致',
    ]);
  });
  const csv =
    csvRows
      .map((row) => row.map((cell) => '"' + cell.replace(/"/g, '""') + '"').join(','))
      .join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, 'expected-vs-actual.csv'), csv);

  console.log(
    `entries=${entries.length} checks=${checks.length} passed=${checks.length - failed.length} failed=${failed.length}`,
  );
  console.log(`out=${OUT}`);
  if (failed.length) {
    for (const check of failed) {
      console.error(`FAIL ${check.label}: expected=${check.expected} actual=${check.actual}`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
module.exports = { readGitHead };
