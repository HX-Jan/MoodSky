const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudTaskController } = require('../miniprogram/modules/tasks/cloud');
const ok = (data) => ({ ok: true, data });
const row = (state = null) => ({ taskId: 'tpl_one', title: '合成测试', durationMin: 3, state });
function fixture(overrides = {}) {
  const state = {};
  const calls = [];
  const api = {
    suggestions: async () => ok({ items: [row()] }),
    history: async () => ok({ items: [] }),
    quickChoice: async () => ok({ entries: [] }),
    createTransitionRequest: (payload) =>
      Object.freeze({ requestId: 'req_fixed_001', payload: Object.freeze(payload) }),
    submit: async (request) => {
      calls.push(request);
      return ok({ taskId: 'tpl_one', state: 'selected' });
    },
    ...overrides,
  };
  return {
    state,
    calls,
    controller: createCloudTaskController({ api, publish: (patch) => Object.assign(state, patch) }),
  };
}
test('cloud tasks distinguish valid empty, unavailable and malformed suggestions', async () => {
  for (const [reply, expected] of [
    [async () => ok({ items: [] }), '暂无'],
    [
      async () => {
        throw { code: 'NOT_IMPLEMENTED' };
      },
      '尚未实现',
    ],
    [async () => ok({ items: Array.from({ length: 4 }, () => row()) }), '读取失败'],
    [async () => ok({ items: [{ ...row(), state: 'unknown' }] }), '读取失败'],
  ]) {
    const f = fixture({ suggestions: reply });
    await f.controller.load();
    assert.equal(f.state.suggestions.length, 0);
    assert.match(f.state.notice, new RegExp(expected));
    assert.equal(f.state.loading, false);
  }
});
test('unknown write outcome preserves selection, blocks new writes and retries exact original request', async () => {
  let fail = true;
  const sent = [];
  const f = fixture({
    submit: async (request) => {
      sent.push(request);
      if (fail) {
        throw { code: 'NETWORK_ERROR' };
      }
      return ok({ taskId: 'tpl_one', state: 'selected' });
    },
  });
  await f.controller.load();
  await f.controller.transition('tpl_one', 'select');
  assert.equal(f.state.suggestions[0].state, 'available');
  assert.equal(f.state.retryPending, true);
  await f.controller.transition('tpl_one', 'complete');
  assert.equal(sent.length, 1);
  fail = false;
  await f.controller.retry();
  assert.equal(sent[0], sent[1]);
  assert.equal(f.state.retryPending, false);
  assert.equal(f.state.suggestions[0].state, 'selected');
});
test('writes update only after matching task and state response, illegal local operation is not dispatched', async () => {
  const f = fixture({ submit: async () => ok({ taskId: 'someone_else', state: 'selected' }) });
  await f.controller.load();
  await f.controller.transition('tpl_one', 'complete');
  assert.equal(f.state.busy, undefined);
  await f.controller.transition('tpl_one', 'select');
  assert.equal(f.state.errorCode, 'INVALID_RESPONSE');
  assert.equal(f.state.suggestions[0].state, 'available');
});
test('failure codes preserve selected task without claiming success', async () => {
  for (const code of [
    'FORBIDDEN',
    'ACCOUNT_DISABLED',
    'UNAUTHENTICATED',
    'INVALID_INPUT',
    'NOT_IMPLEMENTED',
  ]) {
    const f = fixture({
      suggestions: async () => ok({ items: [row('selected')] }),
      submit: async () => {
        throw { code };
      },
    });
    await f.controller.load();
    await f.controller.transition('tpl_one', 'complete');
    assert.equal(f.state.suggestions[0].state, 'selected');
    assert.equal(f.state.noticeType, 'warning');
    assert.equal(f.state.retryPending, false);
  }
});
test('duplicate click cannot dispatch a second write while first is pending', async () => {
  let resolve;
  const f = fixture({
    submit: (request) => {
      f.calls.push(request);
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  await f.controller.load();
  const pending = f.controller.transition('tpl_one', 'select');
  await f.controller.transition('tpl_one', 'select');
  assert.equal(f.calls.length, 1);
  resolve(ok({ taskId: 'tpl_one', state: 'selected' }));
  await pending;
});
test('late reads and writes cannot publish after unload or superseding history read', async () => {
  let resolve;
  const f = fixture({
    suggestions: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const first = f.controller.load();
  await f.controller.load('history');
  resolve(ok({ items: [row()] }));
  await first;
  assert.deepEqual(f.state.suggestions, []);
  let finish;
  const g = fixture({
    submit: () =>
      new Promise((done) => {
        finish = done;
      }),
  });
  await g.controller.load();
  const write = g.controller.transition('tpl_one', 'select');
  g.controller.dispose();
  const before = JSON.stringify(g.state);
  finish(ok({ taskId: 'tpl_one', state: 'selected' }));
  await write;
  assert.equal(JSON.stringify(g.state), before);
});
test('history reads use no client owner and preserve cross-day dates; auth failure clears stale history', async () => {
  let fail = false;
  const f = fixture({
    history: async (...args) => {
      assert.equal(args.length, 0);
      if (fail) {
        throw { code: 'UNAUTHENTICATED' };
      }
      return ok({
        items: ['2026-10-20', '2026-10-19'].map((date) => ({ ...row('completed'), date })),
      });
    },
  });
  await f.controller.load('history');
  assert.equal(f.state.history.length, 2);
  assert.equal(f.state.history[1].date, '2026-10-19');
  fail = true;
  await f.controller.load('history');
  assert.deepEqual(f.state.history, []);
});
test('quickChoice uses public empty payload adapter and only known entry kinds', async () => {
  const f = fixture({
    quickChoice: async (...args) => {
      assert.equal(args.length, 0);
      return ok({ entries: [{ kind: 'places', label: '校园', enabled: true }] });
    },
  });
  await f.controller.loadChoices();
  assert.equal(f.state.quickEntries[0].kind, 'places');
  const g = fixture({
    quickChoice: async () =>
      ok({ entries: [{ kind: 'private-record', label: '不允许', enabled: true }] }),
  });
  await g.controller.loadChoices();
  assert.deepEqual(g.state.quickEntries, []);
});

test('all selected task actions require matching server confirmation before changing state', async () => {
  for (const [action, target] of [
    ['complete', 'completed'],
    ['replace', 'replaced'],
    ['skip', 'skipped'],
  ]) {
    let resolve;
    const f = fixture({
      suggestions: async () => ok({ items: [row('selected')] }),
      submit: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    await f.controller.load();
    const operation = f.controller.transition('tpl_one', action);
    assert.equal(f.state.suggestions[0].state, 'selected');
    resolve(ok({ taskId: 'tpl_one', state: target }));
    await operation;
    assert.equal(f.state.suggestions[0].state, target);
    assert.equal(f.state.retryPending, false);
  }
});

test('quick choice ignores late success or failure from an older refresh', async () => {
  for (const fail of [false, true]) {
    let finish;
    let reject;
    let calls = 0;
    const f = fixture({
      quickChoice: () =>
        ++calls === 1
          ? new Promise((resolve, rejectPromise) => {
              finish = resolve;
              reject = rejectPromise;
            })
          : Promise.resolve(ok({ entries: [{ kind: 'tasks', label: '最新入口', enabled: true }] })),
    });
    const old = f.controller.loadChoices();
    await f.controller.loadChoices();
    if (fail) {
      reject(new Error('late failure'));
    } else {
      finish(ok({ entries: [{ kind: 'places', label: '旧入口', enabled: true }] }));
    }
    await old;
    assert.equal(f.state.quickEntries[0].label, '最新入口');
  }
});

test('task candidates reject prototype states, invalid dates and malformed rows', async () => {
  for (const item of [null, { ...row(), state: 'constructor' }, { ...row(), durationMin: -1 }]) {
    const f = fixture({ suggestions: async () => ok({ items: [item] }) });
    await f.controller.load();
    assert.deepEqual(f.state.suggestions, []);
    assert.equal(f.state.errorCode, 'INVALID_RESPONSE');
  }
  const f = fixture({
    history: async () => ok({ items: [{ ...row('completed'), date: '2026-02-30' }] }),
  });
  await f.controller.load('history');
  assert.equal(f.state.errorCode, 'INVALID_RESPONSE');
  await f.controller.load();
  assert.equal(f.state.errorCode, '');
  await f.controller.transition('tpl_one', 'constructor');
  assert.equal(f.calls.length, 0);
});
