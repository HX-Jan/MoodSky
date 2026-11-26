// Current-page integration with the accepted JF/YF samples. No real cloud calls.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { withLocalWorld } = require('../week6-qc/local-world.cjs');
const { taskPage, event } = require('./page-world.cjs');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');
const { clientCapabilities } = require('../../miniprogram/modules/system/capabilities');
const jf = require('../../docs/week6/jiawei-fang/task-mode-samples.json');
const yf = require('../../docs/alpha/yf01-c1/synthetic-records.json');
const id = DEFAULT_TASKS[2]._id;
const transitions = (w) => w.calls.filter((x) => x.action === 'tasks.transition');
const stateOf = (p, taskId = id) => p.data.suggestions.find((x) => x.id === taskId)?.state;
const act = (p, action, taskId = id) => p.onTaskAction(event({ taskId, action }));

async function sharedRecord(seed) {
  return withLocalWorld(async (w) => {
    // Fixture business dates preserve the original shared data; execution date is separate.
    w.now = new Date(seed['日期'] + 'T04:00:00Z');
    const f = await taskPage(w, 'enabled');
    try {
      await act(f.page, 'select');
      assert.equal(f.navigations.at(-1), '/pages/record/index?fromTask=1');
      f.page.onHide();
      const child = f.load('record', { fromTask: '1' });
      await f.settled(() => child.data.loaded);
      child.onWeather(event({ code: seed['天气'] }));
      if (seed['天气'] === 'CUSTOM') {
        child.onWeatherName({ detail: { value: seed['自定义名称'] } });
      }
      const tags = seed['标签'].map((tag) => yf['标签id映射'][tag]);
      assert(tags.every(Boolean));
      for (const tag of tags) {
        child.onTag(event({ id: tag }));
      }
      child.onText({ detail: { value: seed['预期内容'] } });
      assert.equal(await child.onSave(), true);
      assert.equal(f.pages.at(-1), f.page);
      child.onUnload();
      f.page.onShow();
      await f.settled(() => f.page.data.taskListLoaded);
      assert.equal(stateOf(f.page), 'selected');
      const reads = w.calls.filter((x) => x.action === 'journal.get').length;
      f.page.onOpenActivity(event({ taskId: id }));
      f.page.onHide();
      const reopened = f.load('record', { fromTask: '1' });
      await f.settled(() => reopened.data.loaded);
      assert.equal(reopened.data.weather, seed['天气']);
      assert.equal(reopened.data.text, seed['预期内容']);
      assert.deepEqual(Array.from(reopened.data.tags), tags);
      if (seed['天气'] === 'CUSTOM') {
        assert.equal(reopened.data.weatherName, seed['自定义名称']);
      }
      assert(w.calls.filter((x) => x.action === 'journal.get').length > reads);
      assert.equal(w.rows('journals').length, 1);
      assert.equal(w.calls.filter((x) => x.action === 'journal.upsert').length, 1);
      reopened.onUnload();
      f.pages.pop();
      f.page.onShow();
      await f.settled(() => f.page.data.taskListLoaded);
      assert.equal(stateOf(f.page), 'selected');
      await act(f.page, 'complete');
      assert.equal(stateOf(f.page), 'completed');
      await f.page.onView(event({ view: 'history' }));
      assert(f.page.data.history.some((row) => row.taskId === id && row.state === 'completed'));
      assert.equal(w.rows('task_history').length, 1);
      assert.equal(w.rows('place_checkins').length, 0);
      return {
        caseId: 'QC-YF-' + seed.id,
        unit: 'AS-QC01',
        fixtureDate: seed['日期'],
        weather: seed['天气'],
        mappedTags: tags,
        savedAndReopenedSameInput: true,
        stateAfterSave: 'selected',
        stateAfterReopen: 'selected',
        explicitComplete: 'completed',
        journalWrites: 1,
        journalRows: 1,
        historyRows: 1,
        campusWrites: 0,
        result: 'PASS',
      };
    } finally {
      for (const page of f.pages.reverse()) {
        page.onUnload?.();
      }
    }
  });
}

async function campus(taskId, writable = false) {
  return withLocalWorld(
    async (w) => {
      w.now = new Date('2026-11-24T04:00:00Z');
      const f = await taskPage(w, 'enabled');
      try {
        await act(f.page, 'select', taskId);
        assert.equal(f.navigations.at(-1), '/pages/campus/index?fromTask=1');
        f.page.onHide();
        const child = f.load('campus', { fromTask: '1' });
        await f.settled(
          () => child.data.checkinPlaces?.length === PLACES.length && !child.data.checkinLoading,
        );
        assert.deepEqual(
          Array.from(child.data.checkinPlaces, (row) => row.placeId).sort(),
          PLACES.map((row) => row.placeId).sort(),
        );
        const placeId = PLACES[0].placeId;
        const before = w.calls.length;
        child.onChooseTaskPlace(event({ placeId }));
        assert.equal(child.data.chosenTaskPlaceId, placeId);
        assert.equal(w.calls.length, before, 'Choosing a place is not a check-in');
        assert.equal(child.data.checkinWritesUnavailable, !writable);
        await child.onCheckinTap(event({ placeId }));
        await f.settled(() => !child.data.checkinBusy && !child.data.checkinLoading);
        assert.equal(w.rows('place_checkins').length, writable ? 1 : 0);
        if (writable) {
          assert.equal(
            child.data.checkinPlaces.find((row) => row.placeId === placeId).completed,
            true,
          );
          await child.onCheckinTap(event({ placeId }));
          await f.settled(() => !child.data.checkinBusy && !child.data.checkinLoading);
          assert.equal(w.rows('place_checkins').length, 1);
        } else {
          assert.match(child.data.checkinError, /暂停/);
        }
        assert.equal(w.rows('task_history')[0].state, 'selected');
        child.onUnload();
        f.pages.pop();
        f.page.onShow();
        await f.settled(() => f.page.data.taskListLoaded);
        assert.equal(stateOf(f.page, taskId), 'selected');
        await act(f.page, 'complete', taskId);
        assert.equal(stateOf(f.page, taskId), 'completed');
        return {
          caseId: 'QC-CAMPUS-' + taskId + (writable ? '-writable-local-only' : '-paused'),
          unit: 'AS-QC01',
          placeId,
          placeCount: PLACES.length,
          chooseRequests: 0,
          campusWrites: writable ? 1 : 0,
          pauseVisible: !writable,
          returnedState: 'selected',
          explicitComplete: 'completed',
          result: 'PASS',
        };
      } finally {
        for (const page of f.pages.reverse()) {
          page.onUnload?.();
        }
      }
    },
    { campusWritesPaused: !writable },
  );
}

async function modeSamples() {
  const results = [];
  for (const mode of ['closed', 'readOnly', 'enabled']) {
    await withLocalWorld(async (w) => {
      w.now = new Date('2026-11-24T04:00:00Z');
      w.taskWrites = mode === 'enabled';
      const f = await taskPage(w, mode);
      try {
        assert.deepEqual(
          clientCapabilities({
            releaseProfile: 'production',
            taskMode: mode,
            cloudEnabled: true,
            cloudEnvId: 'synthetic-alpha-qc',
            trustedSessionEnabled: true,
          }).tasks,
          jf.modes[mode].clientCapability,
        );
        if (mode === 'closed') {
          assert.equal(w.calls.length, 0);
        } else {
          assert.deepEqual(
            Array.from(f.page.data.suggestions, (row) => row.id),
            DEFAULT_TASKS.map((row) => row._id),
          );
        }
        await act(f.page, 'select');
        if (mode === 'enabled') {
          assert.equal(stateOf(f.page), jf.modes.enabled.select.data.state);
          await act(f.page, 'complete');
          assert.equal(stateOf(f.page), jf.modes.enabled.complete.data.state);
        } else {
          assert.equal(transitions(w).length, 0);
        }
        results.push({
          caseId: 'QC-JF-' + mode,
          mode,
          unit: 'AS-QC01',
          capability: jf.modes[mode].clientCapability.state,
          requests: transitions(w).length,
          historyRows: w.rows('task_history').length,
          result: 'PASS',
        });
      } finally {
        f.page.onUnload();
      }
    });
  }
  return results;
}

async function crossDay(failure) {
  return withLocalWorld(async (w) => {
    w.now = new Date('2026-11-24T15:59:00Z');
    const f = await taskPage(w, 'enabled');
    try {
      w.fault = { action: 'tasks.transition', kind: failure };
      await act(f.page, 'select');
      const original = transitions(w)[0];
      assert.equal(f.page.data.retryPending, true);
      assert.notEqual(stateOf(f.page), 'selected');
      const rowsBefore = w.rows('task_history').length;
      assert.equal(rowsBefore, failure === 'after' ? 1 : 0);
      f.page.onHide();
      w.now = new Date('2026-11-24T16:01:00Z');
      f.page.onShow();
      await f.settled(() => f.page.data.retryPending);
      assert.equal(transitions(w).length, 1, 'Returning does not submit');
      await f.page.onRetry();
      assert.deepEqual(transitions(w)[1], original);
      assert.equal(original.payload.expectedDate, '2026-11-24');
      assert.equal(w.rows('task_history').length, rowsBefore);
      assert(w.rows('task_history').every((row) => row.date === '2026-11-24'));
      assert.equal(f.navigations.length, 0);
      if (failure === 'before') {
        assert.equal(f.page.data.errorCode, 'CONFLICT');
        assert.match(f.page.data.notice, /跨日/);
        assert.equal(f.page.data.retryPending, false);
        await act(f.page, 'select');
        assert.equal(transitions(w).length, 2, 'New-day choice requires a new read');
      } else {
        assert.equal(f.page.data.retryPending, false);
      }
      return {
        caseId: 'QC-CROSSDAY-' + failure,
        unit: 'AS-QC02',
        fault: failure === 'after' ? 'committed response lost' : 'never reached service',
        originalDate: original.payload.expectedDate,
        retryAt: w.now.toISOString(),
        identicalRequest: true,
        rowsBefore,
        rowsAfter: w.rows('task_history').length,
        newDayWrites: 0,
        automaticNavigations: 0,
        expiredConflict: failure === 'before',
        result: 'PASS',
      };
    } finally {
      f.page.onUnload();
    }
  });
}

async function run(output) {
  assert(output && path.isAbsolute(output), 'Use a new absolute evidence directory');
  const results = [...(await modeSamples())];
  for (const seed of yf['记录']) {
    results.push(await sharedRecord(seed));
  }
  for (const row of DEFAULT_TASKS.slice(0, 2)) {
    results.push(await campus(row._id));
    results.push(await campus(row._id, true));
  }
  for (const failure of ['before', 'after']) {
    results.push(await crossDay(failure));
  }
  const root = path.resolve(__dirname, '../..');
  const files = [
    'tools/alpha-qc/followup.cjs',
    'tools/alpha-qc/page-world.cjs',
    'tools/week6-qc/local-world.cjs',
    'docs/week6/jiawei-fang/task-mode-samples.json',
    'docs/alpha/yf01-c1/synthetic-records.json',
    'docs/alpha/c1/qinghan-zhang/source.json',
    'miniprogram/pages/tasks/index.js',
    'miniprogram/pages/record/index.js',
    'miniprogram/pages/campus/index.js',
    'miniprogram/modules/tasks/cloud.js',
    'miniprogram/shared/campus-checkins.js',
  ];
  const sourceHashes = {};
  for (const file of files) {
    sourceHashes[file] = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(root, file)))
      .digest('hex');
  }
  const report = {
    executedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceWorktreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    ),
    layer: 'ACTUAL_PAGE_CONTROLLER_PRODUCTION_ENTRY_OFFLINE_SDK',
    results,
    sourceHashes,
    realCloud: false,
    realPhone: false,
    independentAcceptance: false,
  };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, 'shared-flows.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ cases: results.length, result: 'PASS', sourceCommit: report.sourceCommit }),
  );
  return report;
}
if (require.main === module) {
  run(process.argv[2]).catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}
module.exports = { run };
