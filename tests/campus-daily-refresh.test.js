const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const { createCheckinController } = require('../miniprogram/modules/campus/checkin-controller');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { businessDate } = require('../miniprogram/shared/date');
const { PLACES } = require('../miniprogram/shared/campus-checkins');
const { AppError } = require('../miniprogram/shared/result');
const settle = () => new Promise((r) => setImmediate(r));
const placeId = PLACES[0].placeId;
const row = { placeId, date: '2026-11-04', completedAt: '2026-11-04T15:00:00.000Z' };
function fixture() {
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64));
  const view = {},
    timers = new Map(),
    calls = [];
  let time = new Date('2026-11-04T15:59:59.000Z'),
    timerId = 0;
  let read = async () => ({
    ok: true,
    data: { date: businessDate(time), items: businessDate(time) === row.date ? [row] : [] },
  });
  let write = async () => ({ ok: true, data: row });
  const controller = createCheckinController({
    service: {
      createRequest,
      submit: async (request) => {
        calls.push(request);
        return request.action === 'campus.checkins' ? read(request) : write(request);
      },
    },
    session: state,
    ensureSession: async () => false,
    publish: (p) => Object.assign(view, p),
    login() {},
    clock: () => time,
    schedule: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, {
        fn: () => {
          timers.delete(id);
          fn();
        },
        delay,
      });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  return {
    controller,
    state,
    view,
    timers,
    calls,
    clock: (v) => {
      time = new Date(v);
    },
    read: (fn) => {
      read = fn;
    },
    write: (fn) => {
      write = fn;
    },
  };
}
test('one visible midnight refresh replaces yesterday completion using the new server day', async () => {
  const f = fixture();
  await f.controller.show();
  assert.equal(f.view.checkinPlaces[0].completed, true);
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.ok(timer.delay >= 1000 && timer.delay < 2000);
  f.clock('2026-11-04T16:00:01.000Z');
  timer.fn();
  await settle();
  assert.equal(f.view.checkinDate, '2026-11-05');
  assert.equal(f.view.checkinPlaces[0].completed, false);
  assert.equal(f.calls.length, 2);
  timer.fn();
  await settle();
  assert.equal(f.calls.length, 2);
  f.controller.dispose();
  assert.equal(f.timers.size, 0);
});
test('midnight callbacks cannot refresh hidden, disposed or changed-account views', async () => {
  const f = fixture();
  await f.controller.show();
  const old = [...f.timers.values()][0].fn;
  f.controller.hide();
  assert.equal(f.timers.size, 0);
  old();
  await settle();
  assert.equal(f.calls.length, 1);
  await f.controller.show();
  const accountTimer = [...f.timers.values()][0].fn;
  f.state.accept('scope_' + 'b'.repeat(64));
  await settle();
  const count = f.calls.length;
  accountTimer();
  await settle();
  assert.equal(f.calls.length, count);
  assert.equal(f.timers.size, 1);
  const disposed = [...f.timers.values()][0].fn;
  f.controller.dispose();
  disposed();
  await settle();
  assert.equal(f.calls.length, count);
  assert.equal(f.timers.size, 0);
});
test('pull refresh and midnight never replay an unknown write; explicit retry retains its original request', async () => {
  const f = fixture();
  f.read(async () => ({ ok: true, data: { date: '2026-11-04', items: [] } }));
  await f.controller.show();
  const timer = [...f.timers.values()][0].fn;
  f.write(async () => {
    throw new AppError('NETWORK_ERROR', 'offline');
  });
  f.controller.complete(placeId);
  await settle();
  const original = f.calls.at(-1);
  assert.equal(f.controller.getWorkStatus().pending, true);
  assert.equal(f.timers.size, 0);
  f.clock('2026-11-04T16:00:01.000Z');
  timer();
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.calls.at(-1), original);
  f.read(async () => ({ ok: true, data: { date: '2026-11-05', items: [] } }));
  f.write(async () => ({ ok: true, data: row }));
  await f.controller.retry();
  const writes = f.calls.filter((r) => r.action === 'campus.checkIn');
  assert.equal(writes.length, 2);
  assert.equal(writes[1], original);
  assert.equal(f.view.checkinDate, '2026-11-05');
  assert.equal(f.view.checkinPlaces[0].completed, false);
  f.controller.dispose();
});
test('a midnight read failure offers retry without showing yesterday as completed today', async () => {
  const f = fixture();
  await f.controller.show();
  const timer = [...f.timers.values()][0].fn;
  f.read(async () => {
    throw new AppError('NETWORK_ERROR', '连接失败，请重试。');
  });
  f.clock('2026-11-04T16:00:01.000Z');
  timer();
  await settle();
  assert.equal(f.view.checkinPlaces[0].completed, false);
  assert.match(f.view.checkinError, /重试/);
  assert.equal(f.timers.size, 0);
  f.read(async () => ({ ok: true, data: { date: '2026-11-05', items: [] } }));
  assert.equal(await f.controller.refresh(), true);
  assert.equal(f.timers.size, 1);
  f.controller.dispose();
});
test('manual refresh shares an active read and an old response cannot finish the new account read', async () => {
  const f = fixture();
  const responses = [];
  f.read(() => new Promise((r) => responses.push(r)));
  const first = f.controller.show();
  const refresh = f.controller.refresh();
  assert.equal(f.calls.length, 1);
  f.state.accept('scope_' + 'b'.repeat(64));
  assert.equal(f.calls.length, 2);
  responses[0]({ ok: true, data: { date: row.date, items: [row] } });
  await first;
  await refresh;
  assert.equal(f.view.checkinLoading, true);
  assert.equal(f.view.checkinPlaces[0].completed, false);
  responses[1]({ ok: true, data: { date: row.date, items: [] } });
  await settle();
  assert.equal(f.view.checkinLoading, false);
  assert.equal(f.view.checkinPlaces[0].completed, false);
  f.controller.dispose();
});

test('an incorrect device clock does not override a freshly confirmed server day', async () => {
  const f = fixture();
  f.clock('2026-11-05T08:00:00.000Z');
  f.read(async () => ({ ok: true, data: { date: row.date, items: [row] } }));
  await f.controller.show();
  assert.equal(f.view.checkinDate, row.date);
  assert.equal(f.view.checkinPlaces[0].completed, true);
  assert.equal(f.timers.size, 0);
  f.controller.dispose();
});

test('identity failure during refresh clears completed records and the midnight timer', async () => {
  for (const code of ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN']) {
    const f = fixture();
    await f.controller.show();
    assert.equal(f.view.checkinPlaces[0].completed, true);
    f.read(async () => {
      throw new AppError(code, 'identity changed');
    });
    await f.controller.refresh();
    assert.equal(f.state.capture(), null);
    assert.equal(f.view.checkinPlaces[0].completed, false);
    assert.equal(f.timers.size, 0);
    f.controller.dispose();
  }
});
test('identity rejection of a new write clears previous private records without retaining a false pending state', async () => {
  const f = fixture();
  await f.controller.show();
  f.write(async () => {
    throw new AppError('ACCOUNT_DISABLED', 'disabled');
  });
  f.controller.complete(PLACES[1].placeId);
  await settle();
  assert.equal(f.state.capture(), null);
  assert.equal(f.view.checkinPlaces[0].completed, false);
  assert.equal(f.controller.getWorkStatus().pending, false);
  assert.equal(f.timers.size, 0);
  f.controller.dispose();
});

test('a status read crossing midnight makes one follow-up read and trusts the fresh server date', async () => {
  for (const nextDate of ['2026-11-04', '2026-11-05']) {
    const f = fixture(),
      responses = [];
    f.read(() => new Promise((r) => responses.push(r)));
    const shown = f.controller.show();
    f.clock('2026-11-04T16:00:01.000Z');
    responses[0]({ ok: true, data: { date: row.date, items: [row] } });
    await settle();
    assert.equal(f.calls.length, 2);
    responses[1]({ ok: true, data: { date: nextDate, items: nextDate === row.date ? [row] : [] } });
    await shown;
    assert.equal(f.calls.length, 2);
    assert.equal(f.view.checkinDate, nextDate);
    assert.equal(f.view.checkinPlaces[0].completed, nextDate === row.date);
    f.controller.dispose();
  }
});
