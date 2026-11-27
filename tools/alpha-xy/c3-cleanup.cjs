#!/usr/bin/env node
/*
 * C3-XY 派生证据：把 verify-export-cleanup 的原始运行结果整理为
 * cleanup-batches.csv / before-after.csv / expiry-residue.csv / receipt-trace.csv。
 *
 * 原始证据来自（只读，不覆盖默认证据路径）：
 *   node tools/week6-xy/verify-export-cleanup.cjs --out <evidence 目录>
 *
 * 用法：
 *   node tools/alpha-xy/c3-cleanup.cjs --evidence <evidence 目录> [--out <输出目录>]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO, 'docs', 'alpha', 'xiang-yu', 'c3-20261127');

function parseArgs(argv) {
  const args = { evidence: null, out: DEFAULT_OUT };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--evidence') {
      args.evidence = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--out') {
      args.out = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`未知参数：${argv[i]}`);
    }
  }
  if (!args.evidence) {
    throw new Error('缺少 --evidence <evidence 目录>');
  }
  args.evidence = path.resolve(args.evidence);
  args.out = path.resolve(args.out);
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readCsv(file) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const parse = (line) =>
    line
      .match(/("([^"]|"")*"|[^,]*)/g)
      .filter((cell) => cell !== '')
      .map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
  const header = parse(lines[0]);
  return {
    header,
    rows: lines.slice(1).map((line) => {
      const cells = parse(line);
      const row = {};
      header.forEach((key, index) => {
        row[key] = cells[index];
      });
      return row;
    }),
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, header, rows) {
  const body = rows.map((row) => header.map((key) => csvCell(row[key])).join(','));
  fs.writeFileSync(file, [header.join(','), ...body].join('\n') + '\n');
}

function maskAccount(id) {
  return typeof id === 'string' && id.startsWith('acct_') ? `${id.slice(0, 13)}…` : id;
}

function checkOf(outcome, label) {
  const found = outcome.checks.find((entry) => entry.label === label);
  if (!found) {
    throw new Error(`${outcome.id} 缺少检查项：${label}`);
  }
  return found;
}

const BATCH_COLLECTIONS = [
  'campus_checkin_states',
  'export_jobs',
  'favorites',
  'journals',
  'month_decorations',
  'place_checkins',
  'preferences',
  'request_receipts',
  'task_history',
];

const PUBLIC_COLLECTIONS = new Set(['places', 'task_templates']);

function main() {
  const args = parseArgs(process.argv);
  const evidence = {
    run: readJson(path.join(args.evidence, 'run.json')),
    progress: readCsv(path.join(args.evidence, 'cleanup-progress.csv')),
    beforeAfter: readCsv(path.join(args.evidence, 'cleanup-before-after.csv')),
  };

  const outcomes = new Map(evidence.run.outcomes.map((item) => [item.id, item]));
  for (const id of ['S8', 'S9', 'S10', 'S12']) {
    if (!outcomes.has(id)) {
      throw new Error(`原始证据缺少场景 ${id}`);
    }
  }
  const failed = evidence.run.outcomes.filter((item) => item.checks.some((check) => !check.ok));
  if (failed.length > 0) {
    throw new Error(`原始证据存在未通过检查：${failed.map((item) => item.id).join(',')}`);
  }

  fs.mkdirSync(args.out, { recursive: true });

  // 1. cleanup-batches.csv：批次、状态、本批删除数、累计删除数与各集合累计进度。
  let previousTotal = 0;
  const batchRows = evidence.progress.rows.map((row) => {
    const counts = {};
    for (const name of BATCH_COLLECTIONS) {
      counts[name] = Number(row[name] ?? 0);
    }
    const total = BATCH_COLLECTIONS.reduce((sum, name) => sum + counts[name], 0);
    const derived = {
      batch: row.batch,
      state: row.state,
      batch_deleted: total - previousTotal,
      cumulative_deleted: total,
    };
    for (const name of BATCH_COLLECTIONS) {
      derived[name] = counts[name];
    }
    previousTotal = total;
    return derived;
  });
  writeCsv(
    path.join(args.out, 'cleanup-batches.csv'),
    ['batch', 'state', 'batch_deleted', 'cumulative_deleted', ...BATCH_COLLECTIONS],
    batchRows,
  );

  // 2. before-after.csv：A/B/公共集合的前后行数与范围判定。
  const beforeAfterRows = evidence.beforeAfter.rows.map((row) => {
    const isPublic = PUBLIC_COLLECTIONS.has(row['集合']);
    const aBefore = Number(row['A清理前']);
    const aAfter = Number(row['A清理后']);
    const bBefore = Number(row['B清理前']);
    const bAfter = Number(row['B清理后']);
    let verdict;
    if (isPublic) {
      verdict = aBefore === aAfter && bBefore === bAfter ? '公共未触碰' : '公共被改动';
    } else if (row['集合'] === 'accounts') {
      verdict = aAfter === 1 && bAfter === 1 ? '墓碑保留' : '账号异常';
    } else if (row['集合'] === 'cleanup_jobs') {
      verdict = aAfter === 1 ? '执行账本保留' : '账本异常';
    } else if (row['集合'] === 'export_jobs') {
      verdict = aAfter === 0 && bAfter === 3 ? 'A 清空、B 新增' : '导出任务异常';
    } else {
      verdict = aAfter === 0 && aBefore > 0 && bBefore === bAfter ? 'A 清空、B 不变' : '范围异常';
    }
    return {
      collection: row['集合'],
      scope: isPublic ? 'public' : 'private',
      a_before: aBefore,
      a_after: aAfter,
      b_before: bBefore,
      b_after: bAfter,
      verdict,
    };
  });
  writeCsv(
    path.join(args.out, 'before-after.csv'),
    ['collection', 'scope', 'a_before', 'a_after', 'b_before', 'b_after', 'verdict'],
    beforeAfterRows,
  );
  const badScope = beforeAfterRows.filter(
    (row) => row.verdict.includes('异常') || row.verdict.includes('被改动'),
  );
  if (badScope.length > 0) {
    throw new Error(`前后对照范围异常：${badScope.map((row) => row.collection).join(',')}`);
  }

  // 3. expiry-residue.csv：到期维护后的残留任务与正文移除情况。
  const s8 = outcomes.get('S8');
  const contentPresent = checkOf(s8, 'expired 行不含 content').actual;
  const shaPresent = checkOf(s8, 'expired 行不含 contentSha256').actual;
  const fileIdNull = checkOf(s8, 'expired 行 fileId 为 null').actual;
  const residueRows = evidence.run.residue.afterMaintenance.map((row) => {
    const keys = row.keys;
    return {
      job_id_tail: row.jobIdTail,
      state: row.state,
      content_present: keys.includes('content'),
      content_sha256_present: keys.includes('contentSha256'),
      file_id_null: fileIdNull,
      kept_fields: keys.filter((key) => key !== 'content' && key !== 'contentSha256').join('|'),
    };
  });
  if (contentPresent !== false || shaPresent !== false || fileIdNull !== true) {
    throw new Error('到期维护未按预期移除正文');
  }
  writeCsv(
    path.join(args.out, 'expiry-residue.csv'),
    [
      'job_id_tail',
      'state',
      'content_present',
      'content_sha256_present',
      'file_id_null',
      'kept_fields',
    ],
    residueRows,
  );

  // 4. receipt-trace.csv：注销回执 → 清理任务 → 最终进度 的可追溯链。
  const s9 = outcomes.get('S9');
  const s12 = outcomes.get('S12');
  const receiptLength = checkOf(s9, '回执长度').actual;
  const cleanupState = checkOf(s9, '清理任务状态').actual;
  const revoked = checkOf(s9, '清理任务 exportAccessRevoked').actual === true;
  const receiptQuery = checkOf(s12, '回执查询结果或错误码').actual;
  const progressTotal = Object.values(receiptQuery.progress).reduce((sum, value) => sum + value, 0);
  const receiptRows = [
    {
      step: 'account.close',
      receipt_length: receiptLength,
      cleanup_state: cleanupState,
      export_access_revoked: revoked,
    },
    {
      step: 'account.cleanupStatus（凭回执）',
      job_id: receiptQuery.jobId,
      state: receiptQuery.state,
      progress_total: progressTotal,
      created_at: receiptQuery.createdAt,
      updated_at: receiptQuery.updatedAt,
    },
  ];
  writeCsv(
    path.join(args.out, 'receipt-trace.csv'),
    [
      'step',
      'receipt_length',
      'cleanup_state',
      'export_access_revoked',
      'job_id',
      'state',
      'progress_total',
      'created_at',
      'updated_at',
    ],
    receiptRows,
  );

  const summary = {
    tool: 'tools/alpha-xy/c3-cleanup.cjs',
    evidence: path.relative(REPO, args.evidence).replace(/\\/g, '/'),
    sourceScenarios: evidence.run.summary,
    actors: {
      A: maskAccount(evidence.run.syntheticActors.A),
      B: maskAccount(evidence.run.syntheticActors.B),
    },
    batches: batchRows.length,
    finalBatchState: batchRows[batchRows.length - 1].state,
    cumulativeDeleted: previousTotal,
    cleanupJobId: receiptQuery.jobId,
    cleanupState: receiptQuery.state,
    expiryResidue: residueRows.length,
  };
  fs.writeFileSync(path.join(args.out, 'c3-summary.json'), JSON.stringify(summary, null, 2) + '\n');

  for (const row of beforeAfterRows) {
    console.log(`${row.verdict}\t${row.collection}`);
  }
  console.log(
    `\n批次 ${batchRows.length}，累计删除 ${previousTotal}，最终 ${summary.finalBatchState}`,
  );
  console.log(`清理任务 ${summary.cleanupJobId}（${summary.cleanupState}）`);
  console.log(`到期残留 ${residueRows.length} 条（正文已移除）`);
  console.log(`输出目录：${path.relative(REPO, args.out)}`);
}

main();
