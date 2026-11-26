// Derive C2-JF CSVs from the sample JSON. No product code or network.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dir = process.argv[2] || path.resolve(__dirname, '../../docs/week6/jiawei-fang');
const samples = JSON.parse(fs.readFileSync(path.join(dir, 'task-mode-samples.json'), 'utf8'));
const account = JSON.parse(fs.readFileSync(path.join(dir, 'account-boundaries.json'), 'utf8'));
const esc = (value) => {
  const text =
    value === undefined || value === null
      ? ''
      : value && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return /[",\n]/.test(text) ? '"' + text.split('"').join('""') + '"' : text;
};
const emit = (name, headers, rows) => {
  fs.writeFileSync(
    path.join(dir, name),
    [headers.join(','), ...rows.map((item) => headers.map((h) => esc(item[h])).join(','))].join(
      String.fromCharCode(10),
    ) + String.fromCharCode(10),
  );
};
const state = new Map();
const stateKey = (taskId, date) => taskId + '@' + date;
const preOf = (taskId, date) =>
  state.has(stateKey(taskId, date)) ? state.get(stateKey(taskId, date)) : '(none)';
const apply = (response) => {
  if (!response.ok) {
    return;
  }
  const data = response.data;
  state.set(stateKey(data.taskId, data.date), data.state);
  if (data.replacementTaskId && data.replacementState) {
    state.set(stateKey(data.replacementTaskId, data.date), data.replacementState);
  }
};
const transitions = [];
let lastDate = '';
samples.transitions.steps.forEach((step, index) => {
  const payload = step.request.payload || {};
  const response = step.response;
  const data = response.ok ? response.data : null;
  const date = data ? data.date : lastDate || payload.expectedDate || '';
  const taskId = payload.taskId || '';
  const pre = preOf(taskId, date);
  const after = data ? data.state : pre;
  transitions.push({
    caseId: 'transition-' + String(index + 1).padStart(2, '0'),
    requestId: step.request.requestId || '',
    businessDate: date,
    expectedDate: payload.expectedDate || '',
    action: payload.transition || step.request.action,
    taskId,
    replacementTaskId: payload.replacementTaskId || '',
    preState: pre,
    afterState: after,
    replayed: data && data.replayed ? 'true' : 'false',
    taskHistoryRows: step.countsAfter ? step.countsAfter.task_history : '',
    receiptRows: step.countsAfter ? step.countsAfter.request_receipts : '',
    errorCode: response.ok ? '' : response.error.code,
    notes: response.ok ? '' : 'rejected; no write',
  });
  apply(response);
  if (data) {
    lastDate = data.date;
  }
});
const midnight = samples.transitions.replayAfterMidnight;
transitions.push({
  caseId: 'transition-replay-midnight',
  requestId: midnight.requestId,
  businessDate: midnight.data ? midnight.data.date : '',
  expectedDate: '2026-11-18',
  action: 'select (replay after midnight)',
  taskId: 'synthetic_one',
  replacementTaskId: '',
  preState: 'completed',
  afterState: midnight.data ? midnight.data.state : '(error)',
  replayed: midnight.data && midnight.data.replayed ? 'true' : 'false',
  taskHistoryRows: 1,
  receiptRows: 2,
  errorCode: midnight.ok ? '' : midnight.error.code,
  notes: 'returns first committed result/date; no new write',
});
const terminal = samples.terminalReplay;
[
  ['select', terminal.select, '(none)', 1, 1],
  ['complete', terminal.complete, 'completed', 1, 2],
  ['complete (new requestId)', terminal.replay, 'completed', 1, 3],
].forEach(([label, response, pre, history, receipts], index) => {
  transitions.push({
    caseId: 'terminal-' + String(index + 1),
    requestId: response.requestId,
    businessDate: response.data ? response.data.date : '2026-11-18',
    expectedDate: '2026-11-18',
    action: label,
    taskId: 'synthetic_one',
    replacementTaskId: '',
    preState: pre,
    afterState: response.data ? response.data.state : '(error)',
    replayed: response.data && response.data.replayed ? 'true' : 'false',
    taskHistoryRows: history,
    receiptRows: receipts,
    errorCode: response.ok ? '' : response.error.code,
    notes: index === 2 ? 'new requestId: history unchanged, receipt +1' : '',
  });
});
transitions.push({
  caseId: 'empty-catalogue-select',
  requestId: samples.emptyCatalogueWrite.request.requestId,
  businessDate: '2026-11-18',
  expectedDate: '2026-11-18',
  action: 'select',
  taskId: 'moodsky_01_walk',
  replacementTaskId: '',
  preState: '(none)',
  afterState: samples.emptyCatalogueWrite.select.data
    ? samples.emptyCatalogueWrite.select.data.state
    : '(error)',
  replayed: 'false',
  taskHistoryRows: samples.emptyCatalogueWrite.writeCounts.task_history,
  receiptRows: samples.emptyCatalogueWrite.writeCounts.request_receipts,
  errorCode: samples.emptyCatalogueWrite.select.ok
    ? ''
    : samples.emptyCatalogueWrite.select.error.code,
  notes: 'empty catalogue falls back to built-in task and accepts it',
});
const failures = samples.failureRetry;
transitions.push({
  caseId: 'failure-first',
  requestId: failures.firstAttempt.requestId,
  businessDate: '2026-11-18',
  expectedDate: '2026-11-18',
  action: 'select',
  taskId: 'synthetic_one',
  replacementTaskId: '',
  preState: '(none)',
  afterState: '(none)',
  replayed: 'false',
  taskHistoryRows: failures.countsAfterFailure.task_history,
  receiptRows: failures.countsAfterFailure.request_receipts,
  errorCode: failures.firstAttempt.error ? failures.firstAttempt.error.code : '',
  notes: 'injected commit failure; zero write',
});
transitions.push({
  caseId: 'failure-retry',
  requestId: failures.retrySameRequest.requestId,
  businessDate: '2026-11-18',
  expectedDate: '2026-11-18',
  action: 'select',
  taskId: 'synthetic_one',
  replacementTaskId: '',
  preState: '(none)',
  afterState: failures.retrySameRequest.data.state,
  replayed: String(failures.retrySameRequest.data.replayed),
  taskHistoryRows: failures.countsAfterRetry.task_history,
  receiptRows: failures.countsAfterRetry.request_receipts,
  errorCode: '',
  notes: 'same requestId/payload/date retried; one history, one receipt',
});
emit(
  'task-transition-results.csv',
  [
    'caseId',
    'requestId',
    'businessDate',
    'expectedDate',
    'action',
    'taskId',
    'replacementTaskId',
    'preState',
    'afterState',
    'replayed',
    'taskHistoryRows',
    'receiptRows',
    'errorCode',
    'notes',
  ],
  transitions,
);
const accountRows = [];
const add = (
  caseId,
  actor,
  action,
  request,
  businessState,
  outcome,
  code,
  ownerA,
  ownerB,
  notes,
) => {
  accountRows.push({
    caseId,
    actor,
    action,
    request,
    businessState,
    outcome,
    code,
    ownerARows: ownerA,
    ownerBRows: ownerB,
    notes,
  });
};
const prefs = account.preferences;
add(
  'pref-defaults-a',
  'A',
  'account.preferences',
  'get',
  prefs.aDefaults.data,
  'ok',
  '',
  '',
  '',
  'defaults',
);
add(
  'pref-set-a',
  'A',
  'account.preferences',
  'set cardTextPreview=true',
  prefs.aSet.data,
  'ok',
  '',
  '',
  '',
  'partial write; other field unchanged',
);
add(
  'pref-read-a',
  'A',
  'account.preferences',
  'get',
  prefs.aReread.data,
  'ok',
  '',
  '',
  '',
  'reads committed value',
);
add(
  'pref-defaults-b',
  'B',
  'account.preferences',
  'get',
  prefs.bDefaults.data,
  'ok',
  '',
  '',
  '',
  'A preference does not leak to B',
);
add(
  'account-close-a',
  'A',
  'account.close',
  "confirm='CLOSE'",
  account.close.response.data,
  'ok',
  '',
  '',
  '',
  'disable + one pending job + exportAccessRevoked',
);
for (const denied of account.privateDenied) {
  add(
    'denied-' + denied.action,
    'A',
    denied.action,
    'after close',
    'account=disabled',
    denied.ok ? 'unexpected-ok' : 'denied',
    denied.code || '',
    '',
    '',
    'refused before domain storage',
  );
}
add(
  'public-suggestions-after-close',
  'A',
  'tasks.suggestions',
  'after close',
  'account=disabled',
  account.publicSuggestions.ok ? 'ok' : 'error',
  account.publicSuggestions.error ? account.publicSuggestions.error.code : '',
  '',
  '',
  'public catalogue remains readable',
);
for (const [key, code] of Object.entries(account.receiptGuards)) {
  add(
    'receipt-' + key,
    'A/B',
    'account.cleanupStatus',
    key,
    'disabled job',
    code ? 'denied' : 'ok',
    code || '',
    '',
    '',
    'receipt only reads its bound job',
  );
}
account.cleanup.steps.forEach((step, index) => {
  const total = step.progress
    ? Object.values(step.progress).reduce((sum, count) => sum + count, 0)
    : '';
  add(
    'cleanup-step-' + String(index + 1),
    'A',
    'account.cleanupStatus',
    'jobId + receipt',
    step.state || '(error)',
    step.ok ? 'ok' : 'error',
    step.code || '',
    '',
    '',
    'progress total=' + total,
  );
});
const sumRows = (value) =>
  value ? Object.values(value).reduce((sum, count) => sum + count, 0) : '';
add(
  'cleanup-complete',
  'A',
  'account.cleanupStatus',
  'jobId + receipt',
  account.cleanup.completedState,
  'ok',
  '',
  sumRows(account.cleanup.residualAfter),
  sumRows(account.cleanup.bRowsAfter),
  'A business rows=0; B rows and public template preserved',
);
add(
  'repeat-close-pending',
  'A',
  'account.close',
  "confirm='CLOSE'",
  'pending',
  account.close.repeatPending.ok ? 'ok' : 'error',
  account.close.repeatPending.code || '',
  '',
  '',
  'same job before cleanup',
);
add(
  'repeat-close-after',
  'A',
  'account.close',
  "confirm='CLOSE'",
  account.close.repeatAfterCleanup.state,
  account.close.repeatAfterCleanup.ok ? 'ok' : 'error',
  account.close.repeatAfterCleanup.code || '',
  '',
  '',
  'same job after cleanup',
);
add(
  'second-account-private',
  'B',
  'account.preferences',
  'get',
  account.secondAccount.privateRead.data,
  account.secondAccount.privateRead.ok ? 'ok' : 'error',
  account.secondAccount.privateRead.error ? account.secondAccount.privateRead.error.code : '',
  '',
  '',
  'B keeps its own private access',
);
emit(
  'account-boundaries.csv',
  [
    'caseId',
    'actor',
    'action',
    'request',
    'businessState',
    'outcome',
    'code',
    'ownerARows',
    'ownerBRows',
    'notes',
  ],
  accountRows,
);
const root = path.resolve(__dirname, '../..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sha256 = (file) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(dir, file)))
    .digest('hex');
console.log(
  JSON.stringify({
    dir,
    head,
    generatedAt: new Date().toISOString(),
    transitionRows: transitions.length,
    accountRows: accountRows.length,
    transitionSha256: sha256('task-transition-results.csv'),
    accountSha256: sha256('account-boundaries.csv'),
  }),
);
