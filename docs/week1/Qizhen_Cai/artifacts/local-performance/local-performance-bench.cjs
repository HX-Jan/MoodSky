// Usage: node local-performance-bench.cjs <MoodSky repo root> <output directory>
// Offline only. Executes actual Page and demo-service source with synthetic D30.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createRequire } = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const childMode = process.argv[2] === '--child';
const repo = path.resolve(process.argv[childMode ? 3 : 2]);
const outDir = childMode ? null : path.resolve(process.argv[3]);
const fixedISO = '2026-10-17T04:00:00.000Z';
const fixedNow = () => new Date(fixedISO);
const fromRepo = (name) => require(path.join(repo, name));
const { createJournalController } = fromRepo('miniprogram/modules/journal/controller');
const { createMemoryJournalService } = fromRepo('miniprogram/modules/journal/demo-service');
const { createLocalStore } = fromRepo('miniprogram/modules/review/demo-store');
const { createReviewDemoService } = fromRepo('miniprogram/modules/review/demo-service');
const { WEATHER_TYPES } = fromRepo('miniprogram/shared/constants');

function dataset() {
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.parse('2026-09-18T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const text = (`TEST_PERF_D30_${String(i + 1).padStart(2, '0')}_` + 'x'.repeat(200)).slice(0, 200);
    return { id: `synthetic_perf_${i + 1}`, date, weather: WEATHER_TYPES[i % 5].code,
      tags: ['REST'], text, version: 1, createdAt: `${date}T04:00:00.000Z`, updatedAt: `${date}T04:00:00.000Z` };
  });
}
function fixture() {
  const seed = dataset();
  const journal = createMemoryJournalService({ now: fixedNow, seedEntries: seed });
  const store = createLocalStore(seed);
  const review = createReviewDemoService({ now: fixedNow, store });
  return { seed, journal, store, review };
}

async function measurePage(pageName) {
  // D30 fixture setup is deliberately outside the page logic timing.
  const f = fixture();
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  let definition;
  let page;
  let seenCalendar = false;
  let seenDecoration = false;
  let readyAt = null;
  const requestCounts = { journal_get: 0, calendar: 0, decorations: 0 };
  const journal = { ...f.journal, get: (...args) => { requestCounts.journal_get++; return f.journal.get(...args); } };
  const review = { ...f.review,
    calendar: (...args) => { requestCounts.calendar++; return f.review.calendar(...args); },
    decorations: (...args) => { requestCounts.decorations++; return f.review.decorations(...args); } };
  const filename = path.join(repo, 'miniprogram/pages', pageName, 'index.js');
  const localRequire = createRequire(filename);
  const t0 = performance.now();
  const source = fs.readFileSync(filename, 'utf8');
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx: { navigateTo() {}, navigateBack() {}, switchTab() {}, showToast() {} },
    getCurrentPages: () => page ? [page] : [],
    require(id) {
      if (id.endsWith('/config/environment.local')) return { journalDemo: true, cloudEnabled: false };
      if (id.endsWith('/journal/demo-session')) return { getSharedDemoService: () => journal, clearSharedDemoService: () => journal.clear() };
      if (id.endsWith('/journal/controller')) return { createJournalController: (options) => createJournalController({ ...options, now: fixedNow }) };
      if (id.endsWith('/review/demo-store')) return { reviewStore: f.store, createLocalStore };
      if (id.endsWith('/review/demo-service')) return { reviewDemoService: review, createReviewDemoService };
      if (id.endsWith('/shared/date')) return { ...fromRepo('miniprogram/shared/date'), businessDate: () => '2026-10-17' };
      return localRequire(id);
    },
  }, { filename });
  page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      Object.assign(this.data, values);
      if (Object.hasOwn(values, 'month') && values.calendarBusy === false) seenCalendar = true;
      if (Object.hasOwn(values, 'decorationBackground')) seenDecoration = true;
      const usable = pageName === 'today'
        ? this.data.loaded === true && this.data.phase === 'idle'
        : seenCalendar && seenDecoration && this.data.calendarBusy === false && !this.data.calendarError;
      if (usable && readyAt === null) { readyAt = performance.now(); resolveReady(); }
    } };
  page.onLoad();
  let timeout;
  try {
    await Promise.race([ready, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('local page not ready within 10 seconds')), 10000);
    })]);
    const checks = pageName === 'today'
      ? { loaded: page.data.loaded, phase: page.data.phase, date: page.data.date, entry_id: page.data.entry?.id, input_locked: page.data.inputLocked }
      : { month: page.data.month, month_record_count: page.data.monthRecordCount, calendar_ready: seenCalendar, decoration_ready: seenDecoration, week_count: page.data.weeks.length };
    if (pageName === 'today') {
      assert.equal(page.data.entry.id, 'synthetic_perf_30');
      assert.equal(page.data.inputLocked, false);
      assert.equal(typeof page.onWeather, 'function');
      assert.equal(typeof page.onSave, 'function');
    } else {
      assert.equal(page.data.month, '2026-10');
      assert.equal(page.data.monthRecordCount, 17);
      assert.equal(page.data.weeks.flat().filter((d) => d.recorded).length, 17);
    }
    return { status: 'success', page: pageName, page_logic_ms: readyAt - t0, request_counts: requestCounts, checks };
  } finally { clearTimeout(timeout); page.onUnload?.(); }
}

async function freshProcess(pageName) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename, '--child', repo, pageName], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let reply = null;
    let replyAt = null;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (reply === null && stdout.includes('\n')) {
        replyAt = performance.now();
        try { reply = JSON.parse(stdout.slice(0, stdout.indexOf('\n'))); } catch (_error) { /* captured on close */ }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => resolve({ status: 'failure', page: pageName, error: error.message }));
    child.on('close', (code) => {
      if (code !== 0 || !reply || reply.status !== 'success') {
        resolve({ status: 'failure', page: pageName, error: stderr || stdout || `child exit ${code}` });
      } else resolve({ ...reply, process_to_reply_ms: replyAt - t0 });
    });
  });
}
function summarize(rows, field) {
  const xs = rows.filter((r) => r.status === 'success').map((r) => r[field]).filter(Number.isFinite).sort((a, b) => a - b);
  return { attempts: rows.length, success: xs.length, failure: rows.filter((r) => r.status !== 'success').length,
    minimum_ms: xs.length ? xs[0] : null, median_ms: xs.length ? xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2 : null,
    mean_ms: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, maximum_ms: xs.length ? xs.at(-1) : null };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const start = new Date().toISOString();
  const rows = [];
  const warmupCounts = {};
  // Same-process groups get five explicit uncounted warmups before measured rows.
  for (const name of ['today', 'universe']) {
    for (let i = 0; i < 5; i++) await measurePage(name);
    warmupCounts[name] = 5;
  }
  let ordinal = 0;
  // Fixed, interleaved order: each condition appears once per round.
  for (let round = 1; round <= 5; round++) {
    for (const [group, name, mode] of [['L-T-C', 'today', 'fresh-process'], ['L-T-W', 'today', 'same-process'], ['L-U-C', 'universe', 'fresh-process'], ['L-U-W', 'universe', 'same-process']]) {
      const when = new Date().toISOString();
      let result;
      try { result = mode === 'fresh-process' ? await freshProcess(name) : await measurePage(name); }
      catch (error) { result = { status: 'failure', page: name, error: error.message }; }
      rows.push({ id: `LOCAL-${String(++ordinal).padStart(3, '0')}`, round, group, mode, actual_time_utc: when, dataset: 'D30', record_count: 30, ...result });
    }
  }
  const f = fixture();
  const batches = [];
  const operations = [
    ['Q-GET30', () => Promise.all(f.seed.map((entry) => f.journal.get(entry.date))), (r) => { assert.equal(r.length, 30); assert.equal(r.filter((x) => x.data.entry).length, 30); }],
    ['Q-CALENDAR', () => Promise.all(['2026-09','2026-10'].map((month) => f.review.calendar(month))), (r) => assert.equal(r.reduce((n, x) => n + x.data.recordCount, 0), 30)],
    ['Q-ARCHIVE', () => Promise.all(['2026-09','2026-10'].map((month) => f.review.monthArchive(month))), (r) => { assert.equal(r.reduce((n, x) => n + x.data.recordCount, 0), 30); assert.equal(r.some((x) => x.data.cards.some((c) => Object.hasOwn(c, 'text'))), false); }],
    ['Q-ANALYSIS', () => Promise.all([f.review.distribution(30), f.review.timeline(30)]), (r) => { assert.equal(r[0].data.recordCount, 30); assert.equal(r[1].data.recordCount, 30); assert.equal(r[0].data.bins.reduce((n, b) => n + b.count, 0), 30); }],
  ];
  for (const [group, operation, validate] of operations) {
    for (let i = 0; i < 100; i++) validate(await operation());
    for (let batch = 1; batch <= 20; batch++) {
      const at = new Date().toISOString();
      const t0 = performance.now();
      let last;
      let row;
      try {
        for (let i = 0; i < 100; i++) last = await operation();
        const duration = performance.now() - t0;
        validate(last); // correctness check outside the timed operation loop
        row = { status: 'success', total_ms: duration, per_operation_mean_ms: duration / 100 };
      } catch (error) { row = { status: 'failure', error: error.message }; }
      batches.push({ group, batch, actual_time_utc: at, iterations: 100, dataset: 'D30', record_count: 30, ...row });
    }
  }
  const environment = { node: process.version, platform: process.platform, arch: process.arch, os_release: os.release(),
    cpu_model: os.cpus()[0]?.model, logical_cpus: os.cpus().length, total_memory_bytes: os.totalmem(),
    timezone: 'Asia/Shanghai', measurement_clock: 'node:perf_hooks performance.now()',
    business_clock: fixedISO, cloud_enabled: false, renderer: 'Node VM + synchronous setData substitute; no WXML/native rendering',
    dataset: { count: 30, start_date: f.seed[0].date, end_date: f.seed.at(-1).date, text_codepoints_per_record: 200,
      weather_codes: WEATHER_TYPES.map((w) => w.code), tags: ['REST'], decorations: 'no saved decorations',
      preparation: 'controlled in-memory seed injection before page timer; no cloud/import writes' },
    source_commit: execFileSync('git', ['rev-parse','HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim() };
  const pageSummary = ['L-T-C','L-T-W','L-U-C','L-U-W'].map((group) => ({ group, ...summarize(rows.filter((r) => r.group === group), 'page_logic_ms'),
    process_to_reply: group.endsWith('C') ? summarize(rows.filter((r) => r.group === group), 'process_to_reply_ms') : null }));
  const operationSummary = operations.map(([group]) => ({ group, iterations_per_batch: 100, warmup_operations: 100,
    measured_operations: 2000, ...summarize(batches.filter((r) => r.group === group), 'per_operation_mean_ms') }));
  const result = { kind: 'measured-local-performance', started_at_utc: start, finished_at_utc: new Date().toISOString(),
    environment, page_warmups_not_included: warmupCounts, page_samples: rows, page_summary: pageSummary,
    operation_batches: batches, operation_summary: operationSummary,
    limitations: ['not Android/iOS or WeChat TTI', 'no network/cloud calls or true database latency',
      'page VM source load through data-state readiness; dependencies and fixture setup excluded from page_logic_ms',
      'fresh-process process_to_reply_ms additionally includes Node startup/imports/fixtures/IPC; same-process has no comparable startup metric',
      'operation timings are batch means, not single-request percentiles', 'no human usability responses or step/time measurements'] };
  fs.writeFileSync(path.join(outDir, 'local-performance-results.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'D30-fixture.json'), JSON.stringify(f.seed, null, 2));
  fs.writeFileSync(path.join(outDir, 'source-hashes.json'), JSON.stringify(['miniprogram/pages/today/index.js','miniprogram/pages/universe/index.js',
    'miniprogram/modules/journal/demo-service.js','miniprogram/modules/review/demo-service.js'].map((name) => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, name))).digest('hex') })), null, 2));
  console.log(JSON.stringify({ page_summary: pageSummary, operation_summary: operationSummary }, null, 2));
  if (rows.some((r) => r.status !== 'success') || batches.some((r) => r.status !== 'success')) process.exitCode = 1;
}

if (childMode) {
  measurePage(process.argv[4]).then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error) => { console.error(error.stack); process.exitCode = 1; });
} else main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
