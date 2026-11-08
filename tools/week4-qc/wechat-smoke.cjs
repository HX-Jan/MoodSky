/* global getApp, getCurrentPages */
// Official automator + actual Page/controller/storage; all service responses are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_MODULE || 'miniprogram-automator');
const output = process.env.QC_SIMULATOR_OUTPUT;
async function main() {
  const mini = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420',
  });
  let installed = false;
  const checks = [];
  const evaluate = (method, input) =>
    mini.evaluate((name, value) => getCurrentPages().slice(-1)[0][name](value), method, input);
  async function wait(predicate) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Synthetic simulator check did not settle');
  }
  try {
    await mini.evaluate(() => {
      const env = require('config/environment.local.js'),
        api = require('services/api.js');
      if (env.cloudEnabled !== false) {
        throw new Error('Simulator must start with cloud disabled');
      }
      const state = {
        env,
        originalEnv: { ...env },
        originalCall: api.call,
        scope: 'scope_' + 'c'.repeat(64),
        taskState: 'available',
        unknown: true,
        calls: [],
      };
      getApp().__week4QC = state;
      Object.assign(env, {
        cloudEnabled: true,
        cloudEnvId: 'synthetic-local-only',
        releaseProfile: 'production',
        trustedSessionEnabled: true,
        cloudFunctionName: 'moodsky-synthetic',
        explicitWechatLogin: false,
      });
      api.call = async (request) => {
        state.calls.push({
          action: request.action,
          requestId: request.requestId,
          payload: request.payload,
        });
        const ok = (data) => ({ apiVersion: '1', requestId: request.requestId, ok: true, data });
        if (request.action === 'account.session') {
          return ok({
            authenticated: true,
            scope: state.scope,
            capabilities: ['journal', 'review', 'tasks'],
          });
        }
        if (request.action === 'tasks.mine') {
          return ok({
            readOnly: false,
            items: [
              {
                taskId: 'synthetic_w4_task',
                title: '合成验证任务',
                description: '模拟器验证，不连接真实云服务',
                durationMin: 2,
                tags: ['合成'],
                state: state.taskState,
              },
            ],
          });
        }
        if (request.action === 'tasks.quickChoice') {
          return ok({ entries: [] });
        }
        if (request.action === 'tasks.transition') {
          state.taskState = request.payload.transition === 'complete' ? 'completed' : 'selected';
          if (state.unknown) {
            const error = new Error('synthetic');
            error.code = 'NETWORK_ERROR';
            throw error;
          }
          return ok({ taskId: request.payload.taskId, state: state.taskState });
        }
        if (request.action === 'tasks.history') {
          return ok({
            items: [
              {
                taskId: 'synthetic_w4_task',
                title: '合成验证任务',
                state: state.taskState,
                date: '2026-11-06',
                createdAt: '2026-11-06T01:00:00Z',
              },
            ],
            nextCursor: null,
          });
        }
        const error = new Error('synthetic service unavailable');
        error.code = 'NOT_IMPLEMENTED';
        throw error;
      };
    });
    installed = true;
    await mini.reLaunch('/pages/tasks/index');
    await wait(async () => (await (await mini.currentPage()).data('suggestions')).length === 1);
    assert.equal(await (await mini.currentPage()).data('isAuthenticated'), true);
    checks.push('Actual production-capable task Page loads one synthetic private suggestion.');
    await evaluate('onTaskAction', {
      currentTarget: { dataset: { taskId: 'synthetic_w4_task', action: 'select' } },
    });
    await wait(async () => (await (await mini.currentPage()).data('retryPending')) === true);
    const original = JSON.parse(
      await mini.evaluate(() =>
        JSON.stringify(getApp().__week4QC.calls.find((x) => x.action === 'tasks.transition')),
      ),
    );
    assert.equal(await (await mini.currentPage()).data('noticeType'), 'warning');
    checks.push('Unknown task result displays retry without premature selected/completed success.');
    await mini.reLaunch('/pages/tasks/index');
    await wait(async () => (await (await mini.currentPage()).data('retryPending')) === true);
    assert.equal(
      await mini.evaluate(
        () => getApp().__week4QC.calls.filter((x) => x.action === 'tasks.transition').length,
      ),
      1,
    );
    assert.equal((await (await mini.currentPage()).data('suggestions')).length, 0);
    checks.push('Actual unload/reopen restores wx storage request and does not auto replay.');
    await mini.evaluate(() => {
      getApp().__week4QC.unknown = false;
    });
    await evaluate('onRetry');
    await wait(
      async () => (await (await mini.currentPage()).data('suggestions'))[0]?.state === 'selected',
    );
    const replay = JSON.parse(
      await mini.evaluate(() =>
        JSON.stringify(getApp().__week4QC.calls.filter((x) => x.action === 'tasks.transition')[1]),
      ),
    );
    assert.deepEqual(replay, original);
    checks.push(
      'Explicit original retry preserves requestId/payload then rereads authoritative state.',
    );
    await evaluate('onTaskAction', {
      currentTarget: { dataset: { taskId: 'synthetic_w4_task', action: 'complete' } },
    });
    await wait(
      async () => (await (await mini.currentPage()).data('suggestions'))[0]?.state === 'completed',
    );
    await evaluate('onView', { currentTarget: { dataset: { view: 'history' } } });
    await wait(async () => (await (await mini.currentPage()).data('history')).length === 1);
    const histories = JSON.parse(
      await mini.evaluate(() =>
        JSON.stringify(getApp().__week4QC.calls.filter((x) => x.action === 'tasks.history')),
      ),
    );
    const query = histories[histories.length - 1]?.payload;
    assert.ok(query?.from && query?.to, JSON.stringify(histories));
    assert.equal(Object.hasOwn(query, 'ownerId'), false);
    checks.push('Task completion and dated history remain reachable through actual Page events.');
    if (output) {
      await fs.mkdir(output, { recursive: true });
      await mini.screenshot({ path: path.join(output, 'tasks-history.png') });
    }
    await mini.evaluate(() => require('services/session-state.js').cloudSessionState.clear());
    assert.equal((await (await mini.currentPage()).data('history')).length, 0);
    checks.push('Session invalidation clears visible task history.');
  } finally {
    if (installed) {
      await mini.evaluate(() => {
        const state = getApp().__week4QC;
        require('services/session-state.js').cloudSessionState.clear();
        const outbox = require('modules/tasks/outbox.js').createTaskOutbox(wx, state.env);
        outbox.purge(state.scope);
        for (const key of Object.keys(state.env)) {
          delete state.env[key];
        }
        Object.assign(state.env, state.originalEnv);
        require('services/api.js').call = state.originalCall;
        delete getApp().__week4QC;
      });
      assert.equal(
        await mini.evaluate(() => require('config/environment.local.js').cloudEnabled),
        false,
      );
      await mini.reLaunch('/pages/today/index');
    }
    await mini.disconnect();
  }
  const report = {
    date: new Date().toISOString(),
    fixtureDate: '2026-11-06',
    mode: 'WECHAT_SIMULATOR_SYNTHETIC_SERVICE',
    baseline: '66be660828a4e09e253720028a670d0912c4794f plus this branch',
    automator: '0.13.0',
    checks,
    realCloudCalls: 0,
    realIdentityVerification: false,
    independentAcceptance: false,
    restorationVerified: true,
  };
  if (output) {
    await fs.writeFile(path.join(output, 'simulator.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
