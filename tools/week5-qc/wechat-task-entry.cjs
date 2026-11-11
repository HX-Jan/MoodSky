/* global getApp, getCurrentPages */
// Official simulator driver; uses synthetic service replies and a fake environment only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_MODULE || 'miniprogram-automator');
async function main() {
  const mini = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420',
  });
  const checks = [],
    output = process.env.QC_SIMULATOR_OUTPUT;
  const evaluate = (name, value) =>
    mini.evaluate((method, input) => getCurrentPages().slice(-1)[0][method](input), name, value);
  const data = async (key) => (await mini.currentPage()).data(key);
  const counts = () => mini.evaluate(() => JSON.stringify(getApp().__week5QC.calls));
  const set = (key, value) =>
    mini.evaluate(
      (name, val) => {
        getApp().__week5QC[name] = val;
      },
      key,
      value,
    );
  async function wait(predicate) {
    for (let i = 0; i < 80; i++) {
      if (await predicate()) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Simulator state did not settle');
  }
  async function shot(name) {
    if (output) {
      await fs.mkdir(output, { recursive: true });
      await mini.screenshot({ path: path.join(output, name + '.png') });
    }
  }
  let installed = false;
  let stage = 'setup';
  try {
    await mini.evaluate(() => {
      const env = require('config/environment.local.js'),
        api = require('services/api.js');
      if (env.cloudEnabled !== false) {
        throw new Error('Start with cloud disabled');
      }
      const state = {
        env,
        originalEnv: { ...env },
        originalCall: api.call,
        calls: [],
        scope: 'scope_' + 'd'.repeat(64),
        taskState: 'available',
        failRead: false,
        unknown: true,
      };
      getApp().__week5QC = state;
      Object.assign(env, {
        cloudEnabled: true,
        cloudEnvId: 'synthetic-local-only',
        cloudFunctionName: 'moodsky-synthetic',
        releaseProfile: 'production',
        trustedSessionEnabled: true,
        explicitWechatLogin: false,
        taskMode: 'closed',
      });
      api.call = async (request) => {
        state.calls.push({
          action: request.action,
          requestId: request.requestId,
          payload: request.payload,
        });
        const ok = (data) => ({ apiVersion: '1', requestId: request.requestId, ok: true, data });
        const item = {
          taskId: 'synthetic_w5_task',
          title: '合成任务验证',
          description: '模拟器合成数据，不连接真实云端',
          durationMin: 2,
          tags: ['合成'],
          state: state.taskState,
        };
        if (request.action === 'account.session') {
          return ok({
            authenticated: true,
            scope: state.scope,
            capabilities: ['journal', 'review', 'tasks'],
          });
        }
        if (['tasks.mine', 'tasks.suggestions'].includes(request.action)) {
          if (state.failRead) {
            const e = new Error('synthetic');
            e.code = 'NETWORK_ERROR';
            throw e;
          }
          return ok({ items: [item], readOnly: false });
        }
        if (request.action === 'tasks.quickChoice') {
          return ok({ entries: [] });
        }
        if (request.action === 'tasks.transition') {
          state.taskState = request.payload.transition === 'complete' ? 'completed' : 'selected';
          if (state.unknown) {
            const e = new Error('synthetic unknown outcome');
            e.code = 'NETWORK_ERROR';
            throw e;
          }
          return ok({
            taskId: request.payload.taskId,
            state: state.taskState,
            date: request.payload.expectedDate,
          });
        }
        if (request.action === 'tasks.history') {
          return ok({
            items: [
              {
                ...item,
                date: require('shared/date.js').businessDate(new Date()),
                createdAt: new Date().toISOString(),
              },
            ],
            nextCursor: null,
          });
        }
        const e = new Error('synthetic unimplemented');
        e.code = 'NOT_IMPLEMENTED';
        throw e;
      };
    });
    installed = true;
    stage = 'closed';
    console.log('SIMULATOR_STAGE ' + stage);
    await mini.reLaunch('/pages/tasks/index?view=history');
    await wait(async () => (await data('tasksClosed')) === true);
    assert.equal(JSON.parse(await counts()).length, 0);
    assert.equal((await (await mini.currentPage()).$$('.task-button')).length, 0);
    checks.push(
      'Closed deep link shows a usable campus return and creates no service/session calls or task controls.',
    );
    await shot('tasks-closed');
    stage = 'readonly';
    console.log('SIMULATOR_STAGE ' + stage);
    await mini.evaluate(() => {
      getApp().__week5QC.env.taskMode = 'readOnly';
    });
    await mini.reLaunch('/pages/tasks/index?view=history');
    await wait(async () => (await data('taskListLoaded')) === true);
    assert.equal(await data('view'), 'suggestions');
    assert.equal(await data('tasksReadOnly'), true);
    assert.equal((await (await mini.currentPage()).$$('.task-button')).length, 0);
    await evaluate('onTaskAction', {
      currentTarget: { dataset: { taskId: 'synthetic_w5_task', action: 'complete' } },
    });
    await evaluate('onView', { currentTarget: { dataset: { view: 'history' } } });
    assert(
      JSON.parse(await counts()).every((x) =>
        ['tasks.suggestions', 'tasks.quickChoice'].includes(x.action),
      ),
    );
    checks.push(
      'Readonly mode uses only public suggestions, hides write/history controls and rejects a forced action.',
    );
    await shot('tasks-readonly');
    await set('failRead', true);
    await evaluate('onRetry');
    await wait(async () => (await data('errorCode')) === 'NETWORK_ERROR');
    assert.equal(await data('taskListLoaded'), false);
    assert.equal((await (await mini.currentPage()).$$('.private-empty')).length, 0);
    checks.push('Failed public read shows a retry notice without a confirmed empty-state message.');
    await shot('tasks-failure');
    await set('failRead', false);
    await mini.evaluate(() => {
      getApp().__week5QC.env.taskMode = 'enabled';
    });
    await mini.reLaunch('/pages/tasks/index');
    await wait(async () => await data('suggestions').then((x) => x.length === 1));
    await evaluate('onTaskAction', {
      currentTarget: { dataset: { taskId: 'synthetic_w5_task', action: 'select' } },
    });
    await wait(async () => (await data('retryPending')) === true);
    assert.equal((await data('suggestions'))[0].state, 'available');
    const first = JSON.parse(await counts()).find((x) => x.action === 'tasks.transition');
    assert(first.payload.expectedDate);
    checks.push(
      'Unknown write does not claim selected/completed success and retains the dated original request.',
    );
    await shot('tasks-pending');
    await mini.reLaunch('/pages/tasks/index');
    await wait(async () => (await data('retryPending')) === true);
    assert.equal(
      JSON.parse(await counts()).filter((x) => x.action === 'tasks.transition').length,
      1,
    );
    assert.equal((await data('suggestions')).length, 0);
    checks.push(
      'Actual unload/reopen restores pending state from wx storage without automatic replay.',
    );
    await set('unknown', false);
    await evaluate('onRetry');
    await wait(async () => (await data('suggestions'))[0]?.state === 'selected');
    const writes = JSON.parse(await counts()).filter((x) => x.action === 'tasks.transition');
    assert.deepEqual(writes[1], first);
    checks.push(
      'Explicit retry sends the same requestId, payload and expectedDate and then reloads confirmed state.',
    );
    await evaluate('onTaskAction', {
      currentTarget: { dataset: { taskId: 'synthetic_w5_task', action: 'complete' } },
    });
    await wait(async () => (await data('suggestions'))[0]?.state === 'completed');
    await evaluate('onView', { currentTarget: { dataset: { view: 'history' } } });
    await wait(async () => (await data('historyLoaded')) === true);
    assert.equal((await data('history'))[0].state, 'completed');
    checks.push(
      'Enabled select/complete/history are reachable and display only confirmed server state.',
    );
    await shot('tasks-history');
    await mini.evaluate(() => require('services/session-state.js').cloudSessionState.clear());
    assert.equal((await data('history')).length, 0);
    checks.push('Invalidating the account clears visible private history.');
  } catch (error) {
    console.error('SIMULATOR_FAILED_STAGE ' + stage);
    throw error;
  } finally {
    if (installed && (await mini.evaluate(() => Boolean(getApp().__week5QC)))) {
      await mini.evaluate(() => {
        const s = getApp().__week5QC;
        require('services/session-state.js').cloudSessionState.clear();
        require('modules/tasks/outbox.js').createTaskOutbox(wx, s.env).purge(s.scope);
        for (const k of Object.keys(s.env)) {
          delete s.env[k];
        }
        Object.assign(s.env, s.originalEnv);
        require('services/api.js').call = s.originalCall;
        delete getApp().__week5QC;
      });
      assert.equal(
        await mini.evaluate(() => require('config/environment.local.js').cloudEnabled),
        false,
      );
      await mini.reLaunch('/pages/today/index');
    }
    await mini.disconnect();
  }
  const sourceRoot = path.resolve(__dirname, '../..');
  const files = [
    'miniprogram/pages/tasks/index.js',
    'miniprogram/pages/tasks/index.wxml',
    'miniprogram/modules/tasks/cloud.js',
    'miniprogram/modules/system/capabilities.js',
  ];
  const hashes = {};
  for (const f of files) {
    hashes[f] = crypto
      .createHash('sha256')
      .update(await fs.readFile(path.join(sourceRoot, f)))
      .digest('hex');
  }
  const report = {
    date: new Date().toISOString(),
    mode: 'WECHAT_SIMULATOR_SYNTHETIC_SERVICE',
    checks,
    sourceHashes: hashes,
    realCloudCalls: 0,
    realIdentityVerification: false,
    phoneVerified: false,
    independentAcceptance: false,
    restorationVerified: true,
  };
  if (output) {
    await fs.writeFile(path.join(output, 'simulator.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
