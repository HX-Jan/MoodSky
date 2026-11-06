const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate } = require('node:timers');
const { createRequire } = require('node:module');
const { backendClient } = require('./helpers/backend-client');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createReviewReader, reviewErrorMessage } = require('../miniprogram/modules/review/reader');
const { AppError } = require('../miniprogram/shared/result');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const empty = (month) => ({
  ok: true,
  data: { month, recordCount: 0, entries: [], sourceRevision: 1 },
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(t, { enabled = true, demo = false } = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/universe/index.js');
  const local = createRequire(file),
    backend = backendClient(),
    session = createSessionState();
  session.accept('scope_' + 'a'.repeat(64));
  const base = demo
    ? local('../../modules/review/demo-service').reviewDemoService
    : createReviewReader({
        journal: backend.journal,
        review: backend.review,
        sessionState: session,
      });
  const reads = [],
    stops = [],
    decorationRequests = [];
  let handler = (month) => base.calendar(month),
    throwStop = false,
    definition;
  const service = {
    ...base,
    calendar(month) {
      reads.push(month);
      return handler(month);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: {
      stopPullDownRefresh() {
        stops.push('stop');
        if (throwStop) {
          throw Error('SYNTHETIC_NATIVE_FAILURE');
        }
      },
    },
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return { cloudEnabled: enabled && !demo, journalDemo: demo };
      }
      if (id.endsWith('/review/reader')) {
        return { reviewReader: service, reviewErrorMessage };
      }
      if (id.endsWith('/review/demo-service') && demo) {
        return { reviewDemoService: service };
      }
      if (id.endsWith('/review/session-boundary')) {
        const boundary = local(id);
        return {
          ...boundary,
          subscribeReviewSession: (listener) => boundary.subscribeReviewSession(listener, session),
        };
      }
      if (id.endsWith('/review/service')) {
        return {
          createDecorationRequest: (payload) => ({ payload }),
          submit: async (request) => {
            decorationRequests.push(request);
            throw new AppError('NOT_IMPLEMENTED', 'SYNTHETIC_PRIVATE_ERROR');
          },
        };
      }
      return local(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  page.onLoad({ month: '2026-10' });
  page.onShow();
  await settle();
  reads.length = 0;
  backend.requests.length = 0;
  t.after(() => page.onUnload());
  return {
    page,
    backend,
    session,
    reads,
    stops,
    decorationRequests,
    handle: (fn) => {
      handler = fn;
    },
    throwStop: (value) => {
      throwStop = value;
    },
  };
}

test('Universe native pull keeps the selected month, joins gestures and reads an actual fresh private snapshot only', async (t) => {
  const config = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/universe/index.json'), 'utf8'),
  );
  assert.equal(config.enablePullDownRefresh, true);
  const f = await fixture(t);
  await f.backend.save({ text: 'SYNTHETIC_PRIVATE_BODY' });
  const first = f.page.onPullDownRefresh();
  assert.equal(f.page.onPullDownRefresh(), first);
  assert.equal(await first, true);
  assert.deepEqual(f.reads, ['2026-10']);
  assert.equal(f.page.data.month, '2026-10');
  assert.equal(f.page.data.monthRecordCount, 1);
  assert.deepEqual(
    f.backend.requests.map((request) => request.action),
    ['review.calendar'],
  );
  assert.doesNotMatch(JSON.stringify(f.page.data), /SYNTHETIC_PRIVATE_BODY/);
  assert.equal(f.stops.length, 1);
});

test('Universe stops the native indicator only after the active calendar read finishes', async (t) => {
  const f = await fixture(t),
    wait = deferred();
  f.handle(() => wait.promise);
  const work = f.page.onPullDownRefresh();
  assert.equal(f.page.data.calendarBusy, true);
  assert.equal(f.stops.length, 0);
  wait.resolve(empty('2026-10'));
  assert.equal(await work, true);
  assert.equal(f.stops.length, 1);
  assert.equal(f.page.data.calendarBusy, false);
});

test('hidden Universe reads cannot finish a newer indicator after the page returns', async (t) => {
  const f = await fixture(t),
    waits = [];
  f.handle(() => {
    const wait = deferred();
    waits.push(wait);
    return wait.promise;
  });
  const old = f.page.onPullDownRefresh();
  f.page.onHide();
  assert.equal(f.stops.length, 1);
  f.page.onShow();
  waits[1].resolve(empty('2026-10'));
  await settle();
  const fresh = f.page.onPullDownRefresh();
  waits[0].resolve(empty('2026-10'));
  assert.equal(await old, false);
  assert.equal(f.stops.length, 1);
  assert.equal(f.page.data.calendarBusy, true);
  waits[2].resolve(empty('2026-10'));
  assert.equal(await fresh, true);
  assert.equal(f.stops.length, 2);
});

test('switching account cancels the old Universe pull without releasing the new account indicator', async (t) => {
  const f = await fixture(t),
    waits = [];
  f.handle(() => {
    const wait = deferred();
    waits.push(wait);
    return wait.promise;
  });
  const old = f.page.onPullDownRefresh();
  f.session.accept('scope_' + 'b'.repeat(64));
  assert.equal(f.stops.length, 1);
  const fresh = f.page.onPullDownRefresh();
  waits[0].resolve(empty('2026-10'));
  assert.equal(await old, false);
  assert.equal(f.stops.length, 1);
  assert.equal(f.page.data.calendarBusy, true);
  waits[1].resolve(empty('2026-10'));
  assert.equal(await fresh, true);
  assert.equal(f.stops.length, 2);
});

test('choosing another month cancels the old gesture and late results preserve the new selection', async (t) => {
  const f = await fixture(t),
    wait = deferred();
  f.handle((month) => (month === '2026-10' ? wait.promise : Promise.resolve(empty(month))));
  const old = f.page.onPullDownRefresh();
  f.page.onMonthPick({ detail: { value: '2026-09' } });
  assert.equal(f.stops.length, 1);
  await settle();
  wait.resolve(empty('2026-10'));
  assert.equal(await old, false);
  assert.equal(f.page.data.month, '2026-09');
  assert.equal(await f.page.onPullDownRefresh(), true);
  assert.equal(f.reads.at(-1), '2026-09');
  assert.equal(f.stops.length, 2);
});

test('unavailable or busy Universe pulls stop locally; inactive and static pages touch no native API', async (t) => {
  for (const state of [
    'disabled',
    'calendarBusy',
    'decorationBusy',
    'decorationLoading',
    'hidden',
    'unloaded',
    'static',
    'redirected',
  ]) {
    const f = await fixture(t, { enabled: state !== 'disabled' });
    if (['calendarBusy', 'decorationBusy', 'decorationLoading'].includes(state)) {
      f.page.data[state] = true;
    }
    if (state === 'hidden') {
      f.page.onHide();
    }
    if (state === 'unloaded') {
      f.page.onUnload();
    }
    if (state === 'static') {
      f.page.data.shareSinglePage = true;
    }
    if (state === 'redirected') {
      f.page._shareLoginRedirected = true;
    }
    assert.equal(await f.page.onPullDownRefresh(), false, state);
    assert.equal(f.reads.length, 0, state);
    assert.equal(
      f.stops.length,
      ['hidden', 'unloaded', 'static', 'redirected'].includes(state) ? 0 : 1,
      state,
    );
  }
});

test('failed Universe reads and a throwing native stop remain retryable without exposing raw errors', async (t) => {
  const f = await fixture(t);
  f.handle(() => Promise.reject(new AppError('NETWORK_ERROR', 'SYNTHETIC_PRIVATE_ERROR')));
  f.throwStop(true);
  assert.equal(await f.page.onPullDownRefresh(), false);
  assert.ok(f.page.data.calendarError);
  assert.doesNotMatch(f.page.data.calendarError, /SYNTHETIC_PRIVATE_ERROR/);
  f.throwStop(false);
  f.handle((month) => Promise.resolve(empty(month)));
  assert.equal(await f.page.onPullDownRefresh(), true);
  assert.equal(f.stops.length, 2);
  assert.equal(f.page.data.calendarError, '');
});

test('Universe pulls refresh an open decoration read but do not reopen a known unavailable production capability', async (t) => {
  const f = await fixture(t);
  f.page.data.decorationPanel = true;
  f.page.data.decorationState = 'unimplemented';
  assert.equal(await f.page.onPullDownRefresh(), true);
  assert.equal(f.decorationRequests.length, 0);
  f.page.data.decorationState = 'unavailable';
  assert.equal(await f.page.onPullDownRefresh(), true);
  assert.equal(f.decorationRequests.length, 1);
  assert.equal(f.decorationRequests[0].payload.operation, 'get');
  assert.equal(f.page.data.decorationState, 'unimplemented');
  assert.equal(f.page.data.calendarError, '');
  assert.equal(f.stops.length, 2);
});

test('Universe demo pull uses existing memory readers without dispatching a cloud request', async (t) => {
  const f = await fixture(t, { demo: true });
  assert.equal(await f.page.onPullDownRefresh(), true);
  assert.equal(f.reads.length, 1);
  assert.equal(f.backend.requests.length, 0);
  assert.equal(f.decorationRequests.length, 0);
  assert.equal(f.stops.length, 1);
});
