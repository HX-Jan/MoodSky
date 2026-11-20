/* global getApp, getCurrentPages, __w6QcSend */
// Official simulator + local production entry + existing offline SDK fixture.
// No deployed cloud function, account credentials or phone connection is used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { withLocalWorld } = require('./local-world.cjs');
const { DEFAULT_TASKS } = require('../../miniprogram/shared/task-catalogue');
const { PLACES } = require('../../miniprogram/shared/campus-checkins');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_MODULE || 'miniprogram-automator');
async function main() {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const root = path.resolve(__dirname, '../..');
  const output = process.env.QC_SIMULATOR_OUTPUT;
  assert(output && path.isAbsolute(output), 'Set an absolute synthetic evidence output directory');
  await fs.mkdir(output, { recursive: true });
  const checks = [];
  const ids = DEFAULT_TASKS.map((x) => x._id);
  const data = async (key) => (await mini.currentPage()).data(key);
  async function wait(predicate) {
    for (let n = 0; n < 100; n++) {
      if (await predicate()) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Simulator state did not settle');
  }
  const method = (name, dataset) =>
    mini.evaluate(
      (method, dataset) => getCurrentPages().at(-1)[method]({ currentTarget: { dataset } }),
      name,
      dataset,
    );
  const shot = (name) => mini.screenshot({ path: path.join(output, name + '.png') });
  let stage = 'setup',
    restored = false;
  try {
    await withLocalWorld(async (w) => {
      w.now = new Date();
      await mini.exposeFunction('__w6QcSend', async (id, request) => {
        let response, error;
        try {
          response = await w.call(request);
        } catch (failure) {
          error = { code: failure.code || 'INTERNAL_ERROR' };
        }
        await mini.evaluate(
          (id, response, error) => {
            const s = getApp().__w6QC;
            const operation = s?.pending[id];
            if (!operation) {
              return;
            }
            delete s.pending[id];
            if (error) {
              operation.reject(error);
            } else {
              operation.resolve(response);
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
          throw new Error('Start with cloud disabled');
        }
        const s = {
          env,
          originalEnv: { ...env },
          api,
          originalCall: api.call,
          pending: {},
          serial: 0,
        };
        getApp().__w6QC = s;
        require('services/session-state.js').cloudSessionState.clear();
        Object.assign(env, {
          cloudEnabled: true,
          cloudEnvId: 'synthetic-w6-only',
          cloudFunctionName: 'moodsky-synthetic-w6',
          releaseProfile: 'production',
          trustedSessionEnabled: true,
          explicitWechatLogin: false,
          taskMode: 'closed',
        });
        api.call = (request) =>
          new Promise((resolve, reject) => {
            const id = ++s.serial;
            s.pending[id] = { resolve, reject };
            __w6QcSend(id, request);
          });
      });
      stage = 'closed';
      console.log(stage);
      // Recreate the first page after changing the synthetic capability mode.
      // switchTab can retain a controller initialized by an earlier preview run.
      await mini.reLaunch('/pages/tasks/index');
      await wait(async () => await data('tasksClosed'));
      assert.equal(w.calls.filter((x) => x.action.startsWith('tasks.')).length, 0);
      assert.equal((await (await mini.currentPage()).$$('.task-choice')).length, 0);
      checks.push('closed: task tab shows closed state and sends no task requests');
      await shot('01-closed');

      stage = 'readOnly';
      console.log(stage);
      await mini.evaluate(() => {
        getApp().__w6QC.env.taskMode = 'readOnly';
      });
      await mini.reLaunch('/pages/tasks/index');
      await wait(async () => await data('taskListLoaded'));
      assert.equal(await data('tasksReadOnly'), true);
      assert.equal((await (await mini.currentPage()).$$('.task-button')).length, 0);
      await method('onTaskAction', { taskId: ids[0], action: 'select' });
      assert.equal(w.rows('task_history').length, 0);
      checks.push(
        'readOnly: public production suggestions render without private actions or writes',
      );
      await shot('02-readonly');
      w.fault = { action: 'tasks.suggestions', kind: 'before' };
      await method('onRetry', {});
      assert.equal(await data('taskListLoaded'), false);
      assert.match(await data('notice'), /读取失败/);
      checks.push('failed read: retry is visible and no confirmed empty history is shown');
      await shot('03-read-failure');

      stage = 'enabled-campus';
      console.log(stage);
      await mini.evaluate(() => {
        getApp().__w6QC.env.taskMode = 'enabled';
      });
      await mini.reLaunch('/pages/tasks/index');
      await wait(async () => await data('taskListLoaded'));
      let releaseSelection;
      w.hold = {
        action: 'tasks.transition',
        wait: new Promise((r) => {
          releaseSelection = r;
        }),
      };
      await (
        await (await mini.currentPage()).$('.task-choice[data-task-id="' + ids[0] + '"]')
      ).tap();
      await wait(async () => await data('busy'));
      await mini.switchTab('/pages/today/index');
      await mini.switchTab('/pages/tasks/index');
      w.hold = null;
      releaseSelection();
      await wait(async () =>
        (await data('suggestions'))?.some((x) => x.id === ids[0] && x.state === 'selected'),
      );
      assert.equal((await mini.currentPage()).path, 'pages/tasks/index');
      checks.push(
        'late selection: leaving and returning invalidates automatic activity navigation, while retaining the confirmed selection',
      );
      await shot('04-late-selection-stays');
      await method('onOpenActivity', { taskId: ids[0] });
      await wait(async () => (await mini.currentPage()).path === 'pages/campus/index');
      await wait(
        async () => (await data('checkinPlaces'))?.length === 5 && !(await data('checkinLoading')),
      );
      await method('onChooseTaskPlace', { placeId: PLACES[0].placeId });
      await method('onCheckinTap', { placeId: PLACES[0].placeId });
      assert.match(await data('checkinError'), /暂停/);
      assert.equal(w.rows('place_checkins').length, 0);
      checks.push(
        'campus: a confirmed selection opens campus; choosing a place never bypasses the paused checkin entry',
      );
      await shot('04-campus-paused');
      await mini.navigateBack();
      await wait(async () => await data('taskListLoaded'));
      assert.equal((await data('suggestions')).find((x) => x.id === ids[0]).state, 'selected');
      checks.push('campus return: task remains selected and requires explicit completion');
      await shot('05-campus-return-selected');
      await method('onTaskAction', { taskId: ids[0], action: 'complete' });
      assert.equal((await data('suggestions')).find((x) => x.id === ids[0]).state, 'completed');

      stage = 'enabled-journal';
      console.log(stage);
      await (
        await (await mini.currentPage()).$('.task-choice[data-task-id="' + ids[2] + '"]')
      ).tap();
      await wait(async () => (await mini.currentPage()).path === 'pages/record/index');
      await wait(async () => await data('loaded'));
      await method('onWeather', { code: 'SUNNY' });
      await shot('06-task-record');
      await method('onSave', {});
      await wait(async () => (await mini.currentPage()).path === 'pages/tasks/index');
      await wait(async () => await data('taskListLoaded'));
      assert.equal(w.rows('journals').length, 1);
      assert.equal((await data('suggestions')).find((x) => x.id === ids[2]).state, 'selected');
      checks.push(
        'journal: a real local save returns to the task tab and leaves the task selected',
      );
      await shot('07-record-return-selected');
      await method('onTaskAction', { taskId: ids[2], action: 'complete' });
      assert.equal((await data('suggestions')).find((x) => x.id === ids[2]).state, 'completed');
      checks.push(
        'complete: only an explicit task action with the matching service receipt displays completed',
      );

      stage = 'unknown-retry';
      console.log(stage);
      w.fault = { action: 'tasks.transition', kind: 'after' };
      await method('onTaskAction', { taskId: ids[1], action: 'select' });
      assert.equal(await data('retryPending'), true);
      assert.equal((await mini.currentPage()).path, 'pages/tasks/index');
      const original = w.calls.filter((x) => x.action === 'tasks.transition').at(-1);
      checks.push(
        'lost acknowledgement: remains on tasks, shows pending and never displays a false completion',
      );
      await shot('08-pending');
      const count = w.calls.filter((x) => x.action === 'tasks.transition').length;
      await mini.reLaunch('/pages/tasks/index');
      await wait(async () => await data('retryPending'));
      assert.equal(w.calls.filter((x) => x.action === 'tasks.transition').length, count);
      await method('onRetry', {});
      assert.deepEqual(w.calls.filter((x) => x.action === 'tasks.transition').at(-1), original);
      assert.equal(w.rows('task_history').filter((x) => x.taskId === ids[1]).length, 1);
      checks.push(
        'reopen and retry: no automatic replay; explicit retry preserves requestId, payload and expectedDate',
      );
      await method('onView', { view: 'history' });
      await wait(async () => await data('historyLoaded'));
      assert.equal((await data('history')).filter((x) => x.state === 'completed').length, 2);
      checks.push('history: confirmed states are returned by the local production entry');
      await shot('09-history');
      // Before cleanup, all writes have exact receipts and the task outbox is empty.
      assert.equal(w.rows('task_history').length, 3);
    });
  } finally {
    if (await mini.evaluate(() => Boolean(getApp().__w6QC))) {
      await mini.evaluate(() => {
        const s = getApp().__w6QC;
        require('services/session-state.js').cloudSessionState.clear();
        Object.keys(s.env).forEach((k) => {
          delete s.env[k];
        });
        Object.assign(s.env, s.originalEnv);
        s.api.call = s.originalCall;
        delete getApp().__w6QC;
      });
      restored = await mini.evaluate(
        () => require('config/environment.local.js').cloudEnabled === false,
      );
      await mini.reLaunch('/pages/today/index');
    }
    await mini.disconnect();
  }
  assert(restored);
  const files = [
    'miniprogram/pages/tasks/index.js',
    'miniprogram/pages/tasks/index.wxml',
    'miniprogram/pages/tasks/index.wxss',
    'miniprogram/pages/record/index.js',
    'miniprogram/modules/tasks/cloud.js',
    'tools/week6-qc/local-world.cjs',
    'tools/week6-qc/wechat-task-flows.cjs',
  ];
  const sourceHashes = {};
  for (const file of files) {
    sourceHashes[file] = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(root, file)))
      .digest('hex');
  }
  const result = {
    task: 'W6-QC',
    date: new Date().toISOString(),
    stage,
    layer: 'OFFICIAL_WECHAT_SIMULATOR_LOCAL_PRODUCTION_ENTRY_OFFLINE_SDK',
    checks,
    sourceHashes,
    restoredCloudDisabled: restored,
    realCloud: false,
    realPhone: false,
    independentAcceptance: false,
  };
  await fs.writeFile(path.join(output, 'simulator.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
