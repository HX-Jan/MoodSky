/* global getApp, getCurrentPages */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_MODULE || 'miniprogram-automator');
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const output = path.resolve(
  process.env.QC_SIMULATOR_OUTPUT || path.join(os.tmpdir(), 'moodsky-qc-simulator'),
);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const fixtures = {};
  for (const count of [0, 3]) {
    const router = createCandidateRouter({
      taskCatalogueRepository: {
        listEnabled: async () =>
          Array.from({ length: count }, (_, index) => ({
            _id: 'synthetic_qc_' + index,
            title: '合成验证任务 ' + (index + 1),
            enabled: true,
            steps: ['仅供模拟器验证，不连接真实账号'],
            durationMin: index + 1,
            tags: ['合成'],
          })),
      },
    });
    fixtures[count] = {};
    for (const action of ['tasks.suggestions', 'tasks.quickChoice']) {
      const result = await router({
        apiVersion: '1',
        requestId: 'req_qc_sim_fixture',
        action,
        payload: {},
      });
      assert.equal(result.ok, true);
      fixtures[count][action] = result.data;
    }
  }
  const mini = await automator.connect({
    wsEndpoint: process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420',
  });
  const checks = [];
  const screenshots = [];
  let installed = false;
  let report;
  let sheetMocked = false;
  const calls = () => mini.evaluate(() => getApp().__qcSimulator.calls);
  const invokePage = (method, event) =>
    mini.evaluate(
      (name, input) => {
        const active = getCurrentPages().slice(-1)[0];
        if (!active || typeof active[name] !== 'function') {
          throw new Error('Expected task page method is unavailable.');
        }
        return active[name](input);
      },
      method,
      event,
    );
  const saveShot = async (name) => {
    await mini.screenshot({ path: path.join(output, name + '.png') });
    screenshots.push(name + '.png');
  };
  const waitForRoute = async (route) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = await mini.currentPage();
      if (current.path === route) {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Navigation did not reach ' + route);
  };
  const settled = async (page) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!(await page.data('loading'))) {
        await page.waitFor(100);
        return;
      }
      await page.waitFor(100);
    }
    throw new Error('Task page did not finish loading.');
  };
  try {
    assert.equal(
      await mini.evaluate(() => require('config/environment.local.js').cloudEnabled),
      false,
      'Use an isolated project with cloudEnabled:false.',
    );
    let page = await mini.reLaunch('/pages/tasks/index');
    assert.equal(await page.data('isCloud'), false);
    assert.equal(await page.data('isDemo'), false);
    assert.equal((await page.$$('.task-card')).length, 0);
    checks.push(
      'Default unconfigured page renders unavailable state without synthetic suggestions.',
    );
    installed = true;
    await mini.evaluate((allFixtures) => {
      const app = getApp();
      if (app.__qcSimulator) {
        throw new Error('A simulator check is already active.');
      }
      const environment = require('config/environment.local.js');
      const api = require('services/api.js');
      const state = {
        environment,
        originalEnvironment: { ...environment },
        originalCall: api.call,
        fixtures: allFixtures,
        count: 0,
        calls: [],
      };
      app.__qcSimulator = state;
      // Override every business dispatch before changing in-memory page configuration.
      // Unsupported actions fail locally; no request reaches wx.cloud.callFunction.
      api.call = async (request) => {
        state.calls.push({
          action: request.action,
          requestId: request.requestId,
          payload: request.payload,
        });
        const data = state.fixtures[state.count][request.action];
        if (!data) {
          const error = new Error('Only synthetic public task reads are available.');
          error.code = 'NOT_IMPLEMENTED';
          throw error;
        }
        return {
          apiVersion: '1',
          requestId: request.requestId,
          ok: true,
          data: JSON.parse(JSON.stringify(data)),
        };
      };
      environment.cloudEnabled = true;
      environment.cloudEnvId = 'synthetic-local-qc';
      environment.journalDemo = false;
    }, fixtures);
    for (const authenticated of [false, true]) {
      for (const count of [0, 3]) {
        await mini.evaluate((n) => {
          getApp().__qcSimulator.count = n;
        }, count);
        page = await mini.reLaunch('/pages/tasks/index');
        await settled(page);
        if (authenticated) {
          await mini.evaluate(async () => {
            const current = getCurrentPages().slice(-1)[0];
            current._cloud.dispose();
            const scope = {};
            const session = {
              capture: () => scope,
              isCurrent: (value) => value === scope,
              subscribe: () => () => {},
            };
            current._cloud = require('modules/tasks/cloud.js').createCloudTaskController({
              session,
              publish: (patch) => current.setData(patch),
            });
            await Promise.all([current._cloud.load('suggestions'), current._cloud.loadChoices()]);
          });
        }
        await page.setData({
          isAuthenticated: authenticated,
          modeLabel: authenticated ? '合成会话 · 模拟器验证' : '合成游客 · 模拟器验证',
        });
        await settled(page);
        assert.equal(await page.data('tasksReadOnly'), true);
        assert.equal(await page.data('writeBlocked'), true);
        assert.equal((await page.data('suggestions')).length, count);
        assert.equal((await page.$$('.task-card')).length, count);
        assert.equal((await page.$$('.task-button')).length, 0);
        assert.equal((await page.$$('.view-tab')).length, 1);
        checks.push(
          (authenticated ? 'Synthetic current session' : 'Guest') +
            ': ' +
            count +
            ' suggestions, hidden writes and history, read-only controller.',
        );
        if (!authenticated && count === 0) {
          await saveShot('guest-empty');
        }
        if (authenticated && count === 3) {
          await saveShot('synthetic-session-three');
        }
      }
    }
    const before = (await calls()).length;
    for (const action of ['select', 'complete', 'replace', 'skip']) {
      await invokePage('onTaskAction', {
        currentTarget: { dataset: { taskId: 'synthetic_qc_0', action } },
      });
    }
    await invokePage('onView', { currentTarget: { dataset: { view: 'history' } } });
    assert.equal((await calls()).length, before);
    assert.equal(
      (await calls()).some((entry) => ['tasks.transition', 'tasks.history'].includes(entry.action)),
      false,
    );
    checks.push('Forged four write events and readonly history event dispatch no private request.');
    await invokePage('onRetry');
    await settled(page);
    const readBefore = (await calls()).filter(
      (entry) => entry.action === 'tasks.suggestions',
    ).length;
    const buttons = await page.$$('button');
    let quickChoice = null;
    for (const button of buttons) {
      if ((await button.text()) === '浏览小任务') {
        quickChoice = button;
      }
    }
    assert.ok(quickChoice, 'Quick-choice task entry must be rendered.');
    await quickChoice.tap();
    await settled(page);
    assert.ok(
      (await calls()).filter((entry) => entry.action === 'tasks.suggestions').length > readBefore,
    );
    checks.push('Rendered quick-choice button rereads public suggestions.');
    page = await mini.switchTab('/pages/me/index');
    const historyEntry = await page.$('#menu-tasks');
    assert.ok(historyEntry);
    await historyEntry.tap();
    page = await waitForRoute('pages/tasks/index');
    assert.equal(page.path, 'pages/tasks/index');
    assert.equal(page.query.view, 'history');
    await settled(page);
    assert.equal(
      (await calls()).some((entry) => entry.action === 'tasks.history'),
      false,
    );
    checks.push(
      'Actual Me menu opens tasks?view=history; unbound private history is not dispatched.',
    );
    // Today routing uses its existing local demo solely to keep journal startup offline.
    await mini.evaluate(() => {
      const environment = getApp().__qcSimulator.environment;
      environment.cloudEnabled = false;
      environment.journalDemo = true;
    });
    page = await mini.switchTab('/pages/today/index');
    await mini.mockWxMethod('showActionSheet', { tapIndex: 3 });
    sheetMocked = true;
    await invokePage('onNeeds');
    page = await waitForRoute('pages/tasks/index');
    assert.equal(page.path, 'pages/tasks/index');
    checks.push('Actual Today need selector opens task page with synthetic local journal mode.');
    assert.equal(
      (await calls()).every((entry) =>
        ['tasks.suggestions', 'tasks.quickChoice'].includes(entry.action),
      ),
      true,
    );
    report = {
      date: '2026-10-29',
      source: process.env.QC_SOURCE_SHA || 'unrecorded; pass QC_SOURCE_SHA',
      mode: 'WECHAT_SIMULATOR_SYNTHETIC_API_TRANSPORT',
      automator: '0.13.0',
      driverCompatibilityNote:
        'Initial Page.callMethod binding failed; official evaluate invokes the actual current Page method instead. Initial immediate navigation assertion raced Me navigation; bounded route wait added. Assertions retained.',
      checks,
      screenshots,
      publicTaskRequests: (await calls()).length,
      realCloudCalls: 0,
      realIdentityVerification: false,
      independentAcceptance: false,
    };
  } finally {
    try {
      if (sheetMocked) {
        await mini.restoreWxMethod('showActionSheet');
      }
      if (installed) {
        await mini.evaluate(() => {
          const state = getApp().__qcSimulator;
          if (!state) {
            return;
          }
          for (const key of Object.keys(state.environment)) {
            delete state.environment[key];
          }
          Object.assign(state.environment, state.originalEnvironment);
          require('services/api.js').call = state.originalCall;
          delete getApp().__qcSimulator;
        });
      }
      assert.equal(await mini.evaluate(() => Boolean(getApp().__qcSimulator)), false);
      assert.equal(
        await mini.evaluate(() => require('config/environment.local.js').cloudEnabled),
        false,
      );
      await mini.reLaunch('/pages/today/index');
    } finally {
      await mini.disconnect();
    }
  }
  report.restorationVerified = true;
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: checks.length,
      report: path.join(output, 'verification.json'),
    }),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
