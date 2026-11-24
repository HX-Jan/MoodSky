const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { withLocalWorld } = require('../week6-qc/local-world.cjs');
const { taskPage, event } = require('./page-world.cjs');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');
const clock = new Date('2026-11-20T04:00:00Z');
const taskId = DEFAULT_TASKS[0]._id;
const actions = ['select', 'complete', 'replace', 'skip'];
const finalState = {
  select: 'selected',
  complete: 'completed',
  replace: 'replaced',
  skip: 'skipped',
};
const stateOf = (page) => page.data.suggestions.find((x) => x.id === taskId)?.state;
const writes = (w) => w.calls.filter((x) => x.action === 'tasks.transition');
const act = (page, action) => page.onTaskAction(event({ taskId, action }));
async function withPage(mode, work, options) {
  return withLocalWorld(async (w) => {
    w.now = clock;
    const f = await taskPage(w, mode, options);
    try {
      return await work(w, f);
    } finally {
      f.page.onUnload();
    }
  });
}
async function modes() {
  const rows = [];
  for (const mode of ['closed', 'readOnly', 'enabled']) {
    for (const action of actions) {
      await withPage(mode, async (w, { page }) => {
        if (mode === 'enabled' && action !== 'select') {
          await act(page, 'select');
        }
        const before = stateOf(page) || (mode === 'closed' ? 'closed' : 'available');
        await act(page, action);
        const actual = stateOf(page) || 'closed';
        if (mode === 'enabled') {
          assert.equal(actual, finalState[action]);
        } else {
          assert.equal(w.rows('task_history').length, 0);
          assert.equal(writes(w).length, 0);
        }
        const serviceRows = w.rows('task_history').map((row) => ({
          taskId: row.taskId,
          date: row.date,
          state: row.state,
        }));
        rows.push({
          unit: 'AS-QC01',
          mode,
          action,
          before,
          actual,
          historyRows: w.rows('task_history').length,
          writes: writes(w).length,
          serviceRows,
          result: 'PASS',
        });
        await page.onView(event({ view: 'history' }));
        if (mode === 'enabled') {
          assert(
            page.data.history.some((x) => x.taskId === taskId && x.state === finalState[action]),
          );
        } else {
          assert(!w.calls.some((x) => x.action === 'tasks.history'));
        }
        rows.push({
          unit: 'AS-QC01',
          mode,
          action: 'history after ' + action,
          actual: mode === 'enabled' ? finalState[action] : 'not offered',
          result: 'PASS',
        });
      });
    }
  }
  return rows;
}
async function lostAcknowledgement(transition) {
  return withPage('enabled', async (w, { page, navigations, settled }) => {
    if (transition !== 'select') {
      await act(page, 'select');
    }
    navigations.length = 0;
    const before = stateOf(page);
    let release;
    w.hold = {
      action: 'tasks.transition',
      wait: new Promise((r) => {
        release = r;
      }),
    };
    w.fault = { action: 'tasks.transition', kind: 'after' };
    const countBefore = writes(w).length;
    const pending = act(page, transition);
    await act(page, transition);
    assert.equal(writes(w).length, countBefore + 1, 'A double tap must send only one request');
    assert.equal(stateOf(page), before, 'An unconfirmed operation must not show its final state');
    assert.equal(navigations.length, 0);
    release();
    await pending;
    w.hold = null;
    assert.equal(page.data.retryPending, true);
    assert.equal(navigations.length, 0);
    const original = writes(w).at(-1);
    const rowsCommitted = w.rows('task_history').length;
    page.onHide();
    page.onShow();
    await settled(() => page.data.retryPending);
    assert.equal(writes(w).length, countBefore + 1, 'Returning must not automatically retry');
    await page.onRetry();
    assert.deepEqual(writes(w).at(-1), original, 'Retry must preserve the full original input');
    assert.equal(stateOf(page), finalState[transition]);
    assert.equal(w.rows('task_history').length, rowsCommitted, 'Replay must not add history rows');
    assert.equal(navigations.length, 0);
    return {
      unit: 'AS-QC02',
      transition,
      before,
      after: stateOf(page),
      writesAfterDoubleTap: 1,
      retryIdentical: true,
      rowsCommitted,
      rowsAfterRetry: rowsCommitted,
      automaticNavigations: 0,
      originalRequest: original,
      result: 'PASS',
    };
  });
}
async function lateSelection(removeVisitGuard) {
  return withPage(
    'enabled',
    async (w, { page, navigations }) => {
      let release;
      w.hold = {
        action: 'tasks.transition',
        wait: new Promise((r) => {
          release = r;
        }),
      };
      const pending = act(page, 'select');
      page.onHide();
      page.onShow();
      release();
      await pending;
      assert.equal(stateOf(page), 'selected');
      const automaticNavigations = navigations.length;
      assert.equal(automaticNavigations, removeVisitGuard ? 1 : 0);
      if (!removeVisitGuard) {
        page.onOpenActivity(event({ taskId }));
        assert.equal(navigations.length, 1);
      }
      return {
        variant: removeVisitGuard ? 'counterexample: guard removed in VM only' : 'current source',
        automaticNavigations,
        retainedState: 'selected',
        explicitOpenWorks: removeVisitGuard ? null : true,
      };
    },
    { removeVisitGuard },
  );
}
async function run(output) {
  const matrix = await modes();
  const abnormal = [];
  for (const action of actions) {
    abnormal.push(await lostAcknowledgement(action));
  }
  const counterexample = await lateSelection(true),
    current = await lateSelection(false);
  const root = path.resolve(__dirname, '../..');
  const files = [
    'miniprogram/pages/tasks/index.js',
    'miniprogram/pages/tasks/index.wxml',
    'miniprogram/pages/tasks/index.wxss',
    'miniprogram/pages/campus/index.wxml',
    'miniprogram/pages/campus/index.wxss',
    'miniprogram/modules/tasks/cloud.js',
    'tools/alpha-qc/page-world.cjs',
    'tools/alpha-qc/verify.cjs',
  ];
  const sourceHashes = {};
  for (const file of files) {
    sourceHashes[file] = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(root, file)))
      .digest('hex');
  }
  const result = {
    units: ['AS-QC01', 'AS-QC02'],
    sprintBaseline: '5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c',
    baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceWorktreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    ),
    executedAt: new Date().toISOString(),
    fixtureClock: clock.toISOString(),
    layer: 'ACTUAL_PAGE_CONTROLLER_PRODUCTION_ENTRY_OFFLINE_SDK',
    matrix,
    abnormal,
    lateNavigation: { counterexample, current },
    sourceHashes,
    realCloud: false,
    phone: false,
    independentAcceptance: false,
  };
  if (output) {
    assert(path.isAbsolute(output));
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, 'local-results.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    const columns = [
      'unit',
      'mode',
      'action',
      'before',
      'actual',
      'historyRows',
      'writes',
      'result',
    ];
    const csv =
      [
        columns.join(','),
        ...matrix.map((row) => columns.map((key) => JSON.stringify(row[key] ?? '')).join(',')),
      ].join('\n') + '\n';
    await fs.writeFile(path.join(output, 'mode-action-state.csv'), csv);
  }
  return result;
}
if (require.main === module) {
  run(process.argv[2])
    .then((r) =>
      console.log(
        JSON.stringify(
          {
            matrixRows: r.matrix.length,
            lostAcknowledgementCases: r.abnormal.length,
            lateNavigation: r.lateNavigation,
            result: 'PASS',
          },
          null,
          2,
        ),
      ),
    )
    .catch((error) => {
      console.error(error.stack);
      process.exitCode = 1;
    });
}
module.exports = { lostAcknowledgement, run };
