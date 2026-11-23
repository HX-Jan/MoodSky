/* global getApp, getCurrentPages, __alphaSend */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { withLocalWorld } = require('../week6-qc/local-world.cjs');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_MODULE || 'miniprogram-automator');
async function main() {
  const root = path.resolve(__dirname, '../..'),
    output = process.env.QC_SIMULATOR_OUTPUT,
    recordOnly = process.argv[2] === '--record-reopen';
  const campusTaskId = process.argv[2] === '--campus-task' ? process.argv[3] : null;
  assert(
    !process.argv[2] || recordOnly || ['moodsky_01_walk', 'moodsky_02_read'].includes(campusTaskId),
    'Expected --campus-task with the walk or read task ID',
  );
  assert(output && path.isAbsolute(output));
  // Re-execute the existing navigation/record-save runner on this checkout.
  // Preserve its W6 tool label and explicitly identify it as a fresh Alpha rerun.
  await fs.mkdir(output, { recursive: true });
  const sourceCommit = (
    await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  const sourceWorktreeDirty = Boolean(
    (await promisify(execFile)('git', ['status', '--porcelain'], { cwd: root })).stdout.trim(),
  );
  let previous = {
    checks: [],
    sourceHashes: {},
    layer: 'OFFICIAL_WECHAT_SIMULATOR_LOCAL_PRODUCTION_ENTRY_OFFLINE_SDK',
  };
  if (!recordOnly && !campusTaskId) {
    const roundTrips = path.join(output, 'round-trips');
    await promisify(execFile)(process.execPath, ['tools/week6-qc/wechat-task-flows.cjs'], {
      cwd: root,
      env: { ...process.env, QC_SIMULATOR_OUTPUT: roundTrips },
      timeout: 180000,
    });
    previous = JSON.parse(await fs.readFile(path.join(roundTrips, 'simulator.json'), 'utf8'));
    assert.equal(previous.checks.length, 11);
    assert.equal(previous.restoredCloudDisabled, true);
  }
  if (campusTaskId) {
    console.log('Connecting to native simulator on 9420');
  }
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  if (campusTaskId) {
    console.log('Native simulator connected');
  }
  const data = async (key) => (await mini.currentPage()).data(key);
  const tap = async (selector) => {
    const button = await (await mini.currentPage()).$(selector);
    assert(button, 'Missing rendered control: ' + selector);
    await button.tap();
  };
  const method = (name, dataset) =>
    mini.evaluate(
      (name, dataset) => getCurrentPages().at(-1)[name]({ currentTarget: { dataset } }),
      name,
      dataset,
    );
  async function wait(predicate) {
    for (let n = 0; n < 120; n++) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Native Alpha state did not settle');
  }
  const layouts = [],
    actions = [];
  const shot = (name) => mini.screenshot({ path: path.join(output, name + '.png') });
  let restored = false;
  try {
    await withLocalWorld(async (w) => {
      w.now = new Date();
      await mini.exposeFunction('__alphaSend', async (id, request) => {
        let response, error;
        try {
          response = await w.call(request);
        } catch (failure) {
          error = { code: failure.code || 'INTERNAL_ERROR' };
        }
        await mini.evaluate(
          (id, response, error) => {
            const pending = getApp().__alphaQC?.pending[id];
            if (!pending) {
              return;
            }
            delete getApp().__alphaQC.pending[id];
            if (error) {
              pending.reject(error);
            } else {
              pending.resolve(response);
            }
          },
          id,
          response || null,
          error || null,
        );
      });
      await mini.evaluate(() => {
        const env = require('config/environment.local.js'),
          api = require('services/api.js');
        if (env.cloudEnabled !== false) {
          throw new Error('Start with real cloud disabled');
        }
        getApp().__alphaQC = {
          env,
          api,
          originalEnv: { ...env },
          originalCall: api.call,
          serial: 0,
          pending: {},
        };
        require('services/session-state.js').cloudSessionState.clear();
        Object.assign(env, {
          cloudEnabled: true,
          cloudEnvId: 'synthetic-alpha-local',
          cloudFunctionName: 'synthetic-alpha-local',
          releaseProfile: 'production',
          trustedSessionEnabled: true,
          explicitWechatLogin: false,
          taskMode: 'enabled',
        });
        api.call = (request) =>
          new Promise((resolve, reject) => {
            const s = getApp().__alphaQC,
              id = ++s.serial;
            s.pending[id] = { resolve, reject };
            __alphaSend(id, request);
          });
      });
      if (campusTaskId) {
        const id = campusTaskId;
        const taskButton = '.task-choice[data-task-id="' + id + '"]';
        await mini.reLaunch('/pages/tasks/index');
        await wait(async () => await data('taskListLoaded'));
        await shot('01-task-entry');
        assert.equal(w.rows('place_checkins').length, 0);
        await tap(taskButton);
        await wait(async () => (await mini.currentPage()).path === 'pages/campus/index');
        await wait(
          async () =>
            (await data('checkinPlaces'))?.length === 5 && !(await data('checkinLoading')),
        );
        const page = await mini.currentPage();
        const renderedPlaces = await page.$$('.manual-campus-place');
        assert.equal(renderedPlaces.length, 5);
        const names = [];
        for (const card of renderedPlaces) {
          names.push(await (await card.$('.manual-campus-name')).text());
          assert(await (await card.$('.manual-campus-directions')).text());
        }
        const placeId = (await data('checkinPlaces'))[0].placeId;
        const businessDate = await data('checkinDate');
        assert.match(businessDate, /^\d{4}-\d{2}-\d{2}$/);
        const row = await page.$('.manual-campus-choice-row');
        const choose = await row.$('.manual-campus-choice');
        const parent = { ...(await row.offset()), ...(await row.size()) };
        const button = { ...(await choose.offset()), ...(await choose.size()) };
        const rightGap = parent.left + parent.width - button.left - button.width;
        assert(rightGap >= -2 && rightGap <= 8 && button.width < parent.width / 2);
        layouts.push({ parent, button, rightGap });
        await shot('02-campus-before-choice');
        const writesBeforeChoice = w.rows('place_checkins').length;
        const requestsBeforeChoice = w.calls.length;
        await choose.tap();
        await wait(async () => (await data('chosenTaskPlaceId')) === placeId);
        const writesAfterChoice = w.rows('place_checkins').length;
        assert.equal(writesBeforeChoice, 0);
        assert.equal(writesAfterChoice, 0);
        assert.equal(w.calls.length, requestsBeforeChoice);
        await shot('03-campus-after-choice');
        const complete = await page.$('.manual-campus-complete[data-place-id="' + placeId + '"]');
        assert(complete);
        assert.equal(await data('checkinWritesUnavailable'), true);
        assert.equal(await (await complete.$('.manual-campus-button-label')).text(), '暂不可打卡');
        await shot('04-campus-paused-disabled');
        const pauseRequest = w.request('campus.checkIn', { placeId });
        const receipt = await w.raw(pauseRequest);
        assert.equal(receipt.ok, false);
        assert.equal(receipt.error.code, 'NOT_IMPLEMENTED');
        assert.equal(w.rows('place_checkins').length, 0);
        assert.equal(
          (await data('checkinPlaces')).some((place) => place.completed),
          false,
        );
        await mini.navigateBack();
        await wait(async () => await data('taskListLoaded'));
        const taskState = (await data('suggestions')).find((item) => item.id === id).state;
        assert.equal(taskState, 'selected');
        const taskHistoryStates = w.rows('task_history').map((row) => row.state);
        assert.equal(taskHistoryStates.includes('completed'), false);
        await shot('05-return-selected');
        actions.push({
          taskId: id,
          names,
          placeId,
          businessDate,
          writesBeforeChoice,
          writesAfterChoice,
          writesAfterPause: w.rows('place_checkins').length,
          taskState,
          taskHistoryStates,
          guiCompletionDisabled: true,
          guiRequests: w.calls.map(({ action }) => action),
          separateServiceProbe: { action: pauseRequest.action, placeId, code: receipt.error.code },
        });
      } else if (recordOnly) {
        const id = DEFAULT_TASKS[2]._id;
        await mini.reLaunch('/pages/tasks/index');
        await wait(async () => await data('taskListLoaded'));
        await tap('.task-choice[data-task-id="' + id + '"]');
        await wait(async () => (await mini.currentPage()).path === 'pages/record/index');
        await wait(async () => await data('loaded'));
        await tap('[data-code="SUNNY"]');
        await tap('.primary-button');
        await wait(async () => (await mini.currentPage()).path === 'pages/tasks/index');
        await wait(async () => await data('taskListLoaded'));
        assert.equal(w.rows('journals').length, 1);
        assert.equal((await data('suggestions')).find((x) => x.id === id).state, 'selected');
        await shot('01-saved-return-selected');
        const reads = w.calls.filter((x) => x.action === 'journal.get').length;
        await tap('.task-button--primary[data-task-id="' + id + '"]');
        await wait(async () => (await mini.currentPage()).path === 'pages/record/index');
        await wait(async () => await data('loaded'));
        const entry = await data('entry');
        assert(entry, 'Reopening must read the saved record');
        assert.equal(entry.weather, 'SUNNY');
        assert.equal(await data('weather'), 'SUNNY');
        assert.equal(await data('text'), '');
        assert(w.calls.filter((x) => x.action === 'journal.get').length > reads);
        assert.equal(w.rows('journals').length, 1);
        assert.equal(w.calls.filter((x) => x.action === 'journal.upsert').length, 1);
        await shot('02-reopened-saved-record');
        await mini.navigateBack();
        await wait(async () => await data('taskListLoaded'));
        assert.equal((await data('suggestions')).find((x) => x.id === id).state, 'selected');
        await tap('[data-task-id="' + id + '"][data-action="complete"]');
        await wait(
          async () => (await data('suggestions')).find((x) => x.id === id).state === 'completed',
        );
        assert.equal(w.rows('task_history').length, 1);
        assert.equal(w.rows('task_history')[0].state, 'completed');
        assert.equal(w.rows('place_checkins').length, 0);
        await shot('03-explicit-complete');
        actions.push({
          action:
            'select journal -> save -> return selected -> reopen saved -> return selected -> explicit complete',
          reopenedWeather: 'SUNNY',
          reopenedText: 'empty synthetic body',
          journalWrites: 1,
          journalRows: 1,
          taskHistoryRows: 1,
          stateAfterSave: 'selected',
          stateAfterReopen: 'selected',
          finalState: 'completed',
          result: 'PASS',
        });
      } else {
        const id = DEFAULT_TASKS[0]._id;
        await mini.reLaunch('/pages/tasks/index');
        await wait(async () => await data('taskListLoaded'));
        async function rightAligned(parentSelector, buttonSelector, label) {
          const page = await mini.currentPage(),
            parent = await page.$(parentSelector),
            button = await page.$(buttonSelector);
          assert(parent && button);
          const p = await parent.offset(),
            ps = await parent.size(),
            b = await button.offset(),
            bs = await button.size();
          const gap = p.left + ps.width - b.left - bs.width;
          assert(gap >= -2 && gap <= 8, label + ' must retain its right edge');
          assert(bs.width < ps.width / 2, label + ' must remain a compact button');
          layouts.push({
            label,
            parent: { ...p, ...ps },
            button: { ...b, ...bs },
            rightGap: gap,
            result: 'PASS',
          });
        }
        await rightAligned('.task-footer', '.task-choice', 'task choice (#182)');
        await shot('10-task-right-button');
        await tap('.task-choice[data-task-id="' + id + '"]');
        await wait(async () => (await mini.currentPage()).path === 'pages/campus/index');
        await wait(
          async () =>
            (await data('checkinPlaces'))?.length === 5 && !(await data('checkinLoading')),
        );
        await rightAligned(
          '.manual-campus-choice-row',
          '.manual-campus-choice',
          'campus choose-here (#194)',
        );
        await shot('11-campus-right-button');
        await tap('.manual-campus-choice');
        await shot('12-campus-chosen-paused');
        await mini.navigateBack();
        await wait(async () => await data('taskListLoaded'));
        assert.equal((await data('suggestions')).find((x) => x.id === id).state, 'selected');
        await tap('[data-task-id="' + id + '"][data-action="replace"]');
        await wait(
          async () => (await data('suggestions')).find((x) => x.id === id).state === 'replaced',
        );
        const replacement = (await data('suggestions')).find((x) => x.state === 'selected');
        assert(replacement);
        await shot('13-replaced');
        await tap('[data-task-id="' + replacement.id + '"][data-action="skip"]');
        await wait(
          async () =>
            (await data('suggestions')).find((x) => x.id === replacement.id).state === 'skipped',
        );
        await shot('14-skipped');
        await method('onView', { view: 'history' });
        await wait(async () => await data('historyLoaded'));
        assert.deepEqual((await data('history')).map((x) => x.state).sort(), [
          'replaced',
          'skipped',
        ]);
        assert.equal(w.rows('task_history').length, 2);
        assert.equal(w.rows('place_checkins').length, 0);
        actions.push({
          action: 'replace -> skip -> history',
          original: 'replaced',
          replacement: 'skipped',
          historyRows: 2,
          campusWrites: 0,
          result: 'PASS',
        });
        await shot('15-replace-skip-history');
      }
    });
  } finally {
    if (await mini.evaluate(() => Boolean(getApp().__alphaQC))) {
      await mini.evaluate(() => {
        const s = getApp().__alphaQC;
        require('services/session-state.js').cloudSessionState.clear();
        Object.keys(s.env).forEach((key) => {
          delete s.env[key];
        });
        Object.assign(s.env, s.originalEnv);
        s.api.call = s.originalCall;
        delete getApp().__alphaQC;
      });
      restored = await mini.evaluate(
        () => require('config/environment.local.js').cloudEnabled === false,
      );
      await mini.reLaunch('/pages/today/index');
    }
    await mini.disconnect();
  }
  assert(restored);
  const sourceHashes = { ...previous.sourceHashes };
  for (const file of [
    'tools/alpha-qc/wechat.cjs',
    'miniprogram/pages/campus/index.wxml',
    'miniprogram/pages/campus/index.wxss',
    'miniprogram/pages/tasks/index.js',
    'miniprogram/pages/tasks/index.wxml',
    'miniprogram/pages/record/index.js',
    'miniprogram/pages/record/index.wxml',
    'miniprogram/modules/journal/controller.js',
    'miniprogram/modules/journal/service.js',
    'tools/week6-qc/local-world.cjs',
  ]) {
    sourceHashes[file] = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(root, file)))
      .digest('hex');
  }
  const result = {
    units: campusTaskId ? ['AS-QH01'] : recordOnly ? ['AS-QC01'] : ['AS-QC01', 'AS-QC02'],
    executedAt: new Date().toISOString(),
    baseline: sourceCommit,
    sourceWorktreeDirty,
    scenario: campusTaskId || (recordOnly ? 'record-reopen' : 'modes-campus-and-actions'),
    layer: previous.layer,
    reusedRunner:
      recordOnly || campusTaskId
        ? null
        : 'Fresh run of tools/week6-qc/wechat-task-flows.cjs at this baseline',
    roundTripChecks: previous.checks,
    layouts,
    actions,
    sourceHashes,
    restoredCloudDisabled: restored,
    realCloud: false,
    realPhone: false,
    independentAcceptance: false,
  };
  await fs.writeFile(
    path.join(output, 'native-results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({ checks: previous.checks.length, layouts, actions, restored }, null, 2),
  );
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
