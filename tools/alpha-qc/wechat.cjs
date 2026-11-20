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
    output = process.env.QC_SIMULATOR_OUTPUT;
  assert(output && path.isAbsolute(output));
  // Re-execute the existing navigation/record-save runner on this checkout.
  // Preserve its W6 tool label and explicitly identify it as a fresh Alpha rerun.
  const roundTrips = path.join(output, 'round-trips');
  await promisify(execFile)(process.execPath, ['tools/week6-qc/wechat-task-flows.cjs'], {
    cwd: root,
    env: { ...process.env, QC_SIMULATOR_OUTPUT: roundTrips },
    timeout: 180000,
  });
  const previous = JSON.parse(await fs.readFile(path.join(roundTrips, 'simulator.json'), 'utf8'));
  assert.equal(previous.checks.length, 11);
  assert.equal(previous.restoredCloudDisabled, true);
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
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
        async () => (await data('checkinPlaces'))?.length === 5 && !(await data('checkinLoading')),
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
      assert.deepEqual((await data('history')).map((x) => x.state).sort(), ['replaced', 'skipped']);
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
  ]) {
    sourceHashes[file] = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(root, file)))
      .digest('hex');
  }
  const result = {
    units: ['AS-QC01', 'AS-QC02'],
    executedAt: new Date().toISOString(),
    baseline: '5b2775393a4adbf5d9a77ff2a3c61b3c3bb3958c',
    layer: previous.layer,
    reusedRunner: 'Fresh run of tools/week6-qc/wechat-task-flows.cjs at this baseline',
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
