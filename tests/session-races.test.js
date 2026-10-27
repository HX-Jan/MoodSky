const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createCloudSession } = require('../miniprogram/modules/account/cloud-session');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { fixture: backendFixture } = require('./helpers/backend-fixture');
const a = 'scope_' + 'a'.repeat(64);
const b = 'scope_' + 'b'.repeat(64);
const reply = (scope) => ({
  ok: true,
  data: {
    authenticated: true,
    scope,
    capabilities: ['journal', 'review', 'tasks'],
  },
});
function loadApi(state, invoke, ensureCloudSession = async () => Boolean(state.capture())) {
  const file = path.resolve(__dirname, '../miniprogram/services/api.js');
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module,
    setTimeout,
    clearTimeout,
    wx: { cloud: { callFunction: invoke } },
    require(id) {
      if (id === '../config/environment.local') {
        return {
          cloudEnabled: true,
          cloudEnvId: 'synthetic_session_races',
          cloudFunctionName: 'moodsky-private-pilot',
          trustedSessionEnabled: true,
        };
      }
      if (id === './session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../modules/account/cloud-session') {
        return {
          ensureCloudSession,
        };
      }
      return localRequire(id);
    },
  });
  return module.exports;
}
const wire = (request, code) => ({
  result: {
    apiVersion: '1',
    requestId: request.requestId,
    ok: !code,
    ...(code
      ? { error: { code, message: 'SYNTHETIC auth error' } }
      : { data: { entry: { text: 'SYNTHETIC private response' } } }),
  },
});
function fixture() {
  const state = createSessionState();
  state.accept(a);
  let release, start;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  const api = loadApi(state, (options) => {
    start(options);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const request = api.createRequest('journal.get', { date: '2026-10-26' });
  return { state, api, request, started, release: (code) => release(wire(request, code)) };
}

test('private dispatch refuses a binding cleared after the readiness check', async () => {
  const state = createSessionState();
  state.accept(a);
  let calls = 0;
  const api = loadApi(
    state,
    async (options) => {
      calls++;
      return wire(options.data.request);
    },
    async () => {
      state.clear();
      return true;
    },
  );
  await assert.rejects(api.call(api.createRequest('journal.get', { date: '2026-10-26' })), {
    code: 'UNAUTHENTICATED',
  });
  assert.equal(calls, 0);
});

test('shared readiness uses the newer verified binding without accepting an old authentication result', async () => {
  const state = createSessionState();
  const file = path.resolve(__dirname, '../miniprogram/modules/account/cloud-session.js');
  const localRequire = createRequire(file);
  const module = { exports: {} };
  let release;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module,
    require(id) {
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      if (id === '../../services/api') {
        return {
          createRequest: () => ({}),
          call: () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        };
      }
      return localRequire(id);
    },
  });
  const pending = module.exports.ensureCloudSession();
  const latest = state.accept(b);
  release(reply(a));
  assert.equal(await pending, true);
  assert.equal(state.capture(), latest);
});

test('a committed A write with a late response is not shown to B or repeated; A can reread the committed result', async () => {
  const backend = backendFixture();
  const state = createSessionState();
  state.accept(a);
  let actor = 'a',
    release,
    signal;
  let writes = 0;
  const committed = new Promise((resolve) => {
    signal = resolve;
  });
  const api = loadApi(state, async ({ data }) => {
    const result = await backend.router(data.request, { OPENID: actor });
    if (data.request.action === 'journal.upsert') {
      writes++;
      assert.equal(result.ok, true);
      signal();
      return new Promise((resolve) => {
        release = () => resolve({ result });
      });
    }
    return { result };
  });
  const changes = [];
  const controller = createJournalController({
    now: () => new Date('2026-10-18T00:00:00.000Z'),
    onChanged: (event) => changes.push(event),
    service: {
      get: (date) => api.call(api.createRequest('journal.get', { date })),
      createSaveRequest: (payload) => api.createRequest('journal.upsert', payload),
      submit: (request) => api.call(request),
    },
  });
  await controller.loadDate();
  controller.chooseWeather('CUSTOM');
  controller.setWeatherName('合成账号A私人天气');
  controller.setText('SYNTHETIC committed writing for A');
  const pending = controller.save();
  await committed;
  actor = 'b';
  const latest = state.accept(b);
  release();
  assert.equal(await pending, false);
  assert.equal(state.capture(), latest);
  assert.equal(controller.getState().text, '');
  assert.equal(controller.getState().loaded, false);
  assert.deepEqual(changes, []);
  assert.equal(await controller.retry(), false);
  await controller.loadDate();
  assert.equal(controller.getState().entry, null);
  assert.equal(backend.repository.inspect('synthetic_b').revision, 0);
  actor = 'a';
  state.accept(a);
  await controller.loadDate();
  assert.equal(controller.getState().entry.version, 1);
  assert.equal(controller.getState().text, 'SYNTHETIC committed writing for A');
  assert.equal(writes, 1);
  assert.equal(backend.repository.inspect('synthetic_a').revision, 1);
  controller.dispose();
});

for (const code of ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN']) {
  test(
    'late ' + code + ' from the old private request preserves the new verified binding',
    async () => {
      const f = fixture();
      const pending = f.api.call(f.request);
      await f.started;
      const current = f.state.accept(b);
      f.release(code);
      await assert.rejects(pending, { code: 'UNAUTHENTICATED' });
      assert.equal(f.state.capture(), current);
    },
  );
  test('current private ' + code + ' still clears the current binding', async () => {
    const f = fixture();
    const pending = f.api.call(f.request);
    await f.started;
    f.release(code);
    await assert.rejects(pending, { code });
    assert.equal(f.state.capture(), null);
  });
}

for (const mode of ['switch', 'clear-and-reauthenticate']) {
  test(
    'late private success after ' + mode + ' is discarded without clearing the fresh binding',
    async () => {
      const f = fixture();
      const pending = f.api.call(f.request);
      await f.started;
      if (mode === 'switch') {
        f.state.accept(b);
      } else {
        f.state.clear();
        f.state.accept(a);
      }
      const current = f.state.capture();
      f.release();
      await assert.rejects(pending, { code: 'UNAUTHENTICATED' });
      assert.equal(f.state.capture(), current);
    },
  );
}

test('retry stays with original account/request; rejection cannot log out B, same-account fresh retry can recover', async () => {
  const state = createSessionState();
  state.accept(a);
  const calls = [];
  const api = loadApi(state, async (options) => {
    calls.push(options);
    if (calls.length === 1) {
      throw Error('SYNTHETIC unknown result');
    }
    return wire(options.data.request, calls.length === 2 ? 'FORBIDDEN' : undefined);
  });
  const request = api.createRequest('journal.upsert', {
    date: '2026-10-26',
    weather: 'CUSTOM',
    weatherName: '合成原输入😀',
    expectedVersion: 0,
  });
  await assert.rejects(api.call(request), { code: 'NETWORK_ERROR' });
  const currentB = state.accept(b);
  await assert.rejects(api.call(request), { code: 'UNAUTHENTICATED' });
  assert.equal(state.capture(), currentB);
  state.accept(a);
  assert.equal((await api.call(request)).ok, true);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.data.request, request);
    assert.equal(call.data.sessionScope, a);
    assert.equal(call.data.request.payload.weatherName, '合成原输入😀');
    assert.equal(call.name, 'moodsky-private-pilot');
    assert.equal(call.config.env, 'synthetic_session_races');
  }
});

test('public catalogue authorization failure is not proof the private account was disabled', async () => {
  const state = createSessionState();
  const current = state.accept(a);
  const api = loadApi(state, async (options) => wire(options.data.request, 'FORBIDDEN'));
  await assert.rejects(api.call(api.createRequest('tasks.suggestions')), { code: 'FORBIDDEN' });
  assert.equal(state.capture(), current);
});

for (const mode of ['success', 'failure', 'malformed', 'switch-back']) {
  test(
    'late authentication ' + mode + ' cannot replace or clear externally refreshed state',
    async () => {
      const state = createSessionState();
      state.accept(a);
      let resolve, reject;
      const session = createCloudSession({
        state,
        authenticate: () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      });
      const pending = session.refresh();
      state.accept(b);
      if (mode === 'switch-back') {
        state.accept(a);
      }
      const current = state.capture();
      if (mode === 'failure') {
        reject(Error('SYNTHETIC auth failure'));
      } else {
        resolve(mode === 'malformed' ? { ok: true, data: {} } : reply(a));
      }
      assert.equal(await pending, false);
      assert.equal(state.capture(), current);
    },
  );
}

test('clearing an empty state cancels initial authentication without notifying views of an identity change', async () => {
  const state = createSessionState();
  let release;
  let changes = 0;
  state.subscribe(() => {
    changes++;
  });
  const session = createCloudSession({
    state,
    authenticate: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = session.refresh();
  state.clear();
  release(reply(a));
  assert.equal(await pending, false);
  assert.equal(state.capture(), null);
  assert.equal(changes, 0);
  const retry = session.refresh();
  release(reply(a));
  assert.equal(await retry, true);
  assert.equal(changes, 1);
});
