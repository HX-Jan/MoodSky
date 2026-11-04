const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate } = require('node:timers');
const { createCheckinController } = require('../miniprogram/modules/campus/checkin-controller');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { PLACES } = require('../miniprogram/shared/campus-checkins');
const { AppError } = require('../miniprogram/shared/result');
const placeId = PLACES[0].placeId;
const row = { placeId, date: '2026-11-04', completedAt: '2026-11-04T08:00:00.000Z' };
const scope = (letter) => 'scope_' + letter.repeat(64);
const settle = () => new Promise((r) => setImmediate(r));
function fixture() {
  const state = createSessionState();
  state.accept(scope('a'));
  const calls = [],
    view = {},
    toasts = [];
  let rows = [],
    handler = async () => ({ ok: true, data: row }),
    logins = 0;
  const service = {
    createRequest,
    async submit(request) {
      calls.push(request);
      if (request.action === 'campus.checkins') {
        return { ok: true, data: { date: row.date, items: rows } };
      }
      const result = await handler(request);
      rows = [result.data];
      return result;
    },
  };
  const controller = createCheckinController({
    service,
    session: state,
    ensureSession: async () => false,
    publish: (p) => Object.assign(view, p),
    login: () => logins++,
    toast: (text) => toasts.push(text),
  });
  return {
    controller,
    state,
    calls,
    view,
    toasts,
    logins: () => logins,
    write: (value) => {
      handler = value;
    },
  };
}
test('manual client requires acknowledgement, locks double taps and records only returned server result', async () => {
  const f = fixture();
  await f.controller.show();
  let resolve;
  f.write(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  f.controller.complete(placeId);
  f.controller.complete(placeId);
  f.controller.complete(PLACES[1].placeId);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 1);
  assert.equal(f.controller.getWorkStatus().pending, true);
  assert.equal(f.view.checkinPlaces[0].completed, false);
  resolve({ ok: true, data: row });
  await settle();
  assert.equal(f.view.checkinPlaces[0].completed, true);
  assert.equal(f.controller.getWorkStatus().pending, false);
  assert.deepEqual(f.toasts, ['已打卡']);
  f.controller.dispose();
});
test('uncertain manual write keeps exact request after hiding and retries without another operation', async () => {
  const f = fixture();
  await f.controller.show();
  f.write(async () => {
    throw new AppError('NETWORK_ERROR', 'offline');
  });
  f.controller.complete(placeId);
  await settle();
  const request = f.calls.at(-1);
  assert.equal(f.controller.getWorkStatus().pending, true);
  f.controller.hide();
  assert.equal(f.view.checkinPendingPlace, '');
  await f.controller.show();
  assert.equal(f.view.checkinPendingPlace, placeId);
  f.controller.complete(PLACES[1].placeId);
  assert.equal(f.calls.at(-1), request);
  f.write(async () => ({ ok: true, data: row }));
  await f.controller.retry();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn')[1], request);
  assert.equal(f.view.checkinPlaces[0].completed, true);
  f.controller.dispose();
});
test('account change immediately clears old private result and ignores a late checkin acknowledgement', async () => {
  const f = fixture();
  await f.controller.show();
  let resolve;
  f.write(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  f.controller.complete(placeId);
  f.state.accept(scope('b'));
  await settle();
  resolve({ ok: true, data: row });
  await settle();
  assert.equal(f.view.checkinPlaces[0].completed, false);
  assert.equal(f.controller.getWorkStatus().pending, false);
  assert.deepEqual(f.toasts, []);
  f.state.clear();
  f.controller.complete(placeId);
  assert.equal(f.logins(), 1);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 1);
  f.controller.dispose();
});
test('unavailable service never fakes completion; malformed acknowledgement retains original operation', async () => {
  const f = fixture();
  await f.controller.show();
  f.write(async () => {
    throw new AppError('NOT_IMPLEMENTED', 'not deployed');
  });
  f.controller.complete(placeId);
  await settle();
  assert.equal(f.view.checkinPlaces[0].completed, false);
  assert.equal(f.controller.getWorkStatus().pending, false);
  assert.match(f.view.checkinError, /暂未开放/);
  f.write(async () => ({ ok: true, data: { ...row, placeId: PLACES[1].placeId } }));
  f.controller.complete(placeId);
  await settle();
  assert.equal(f.controller.getWorkStatus().pending, true);
  assert.deepEqual(f.toasts, []);
  f.controller.dispose();
});
function pageFixture({ scene, write, read } = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/campus/index.js');
  const local = createRequire(file),
    session = createSessionState(),
    calls = [];
  let definition;
  const platform = {
    getEnterOptionsSync: () => ({ scene: scene || 1001 }),
    showShareMenu() {},
    navigateTo: (p) => calls.push(p.url),
    showToast: (p) => calls.push(p.title),
    enableAlertBeforeUnload: (p) => {
      calls.push('guard');
      p.success();
    },
    disableAlertBeforeUnload: (p) => p.success(),
  };
  const api = {
    createRequest,
    call: async (request) => {
      calls.push(request);
      if (request.action === 'campus.checkins' && read) {
        return read(request);
      }
      if (request.action === 'campus.checkIn' && write) {
        return write(request);
      }
      return {
        ok: true,
        data: request.action === 'campus.checkins' ? { date: row.date, items: [] } : row,
      };
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (p) => {
      definition = p;
    },
    wx: platform,
    require(id) {
      if (id.endsWith('environment.local')) {
        return { releaseProfile: 'production', explicitWechatLogin: true };
      }
      if (id.endsWith('/services/api')) {
        return api;
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: session };
      }
      if (id.endsWith('/account/cloud-session')) {
        return { ensureCloudSession: async () => false };
      }
      if (id.endsWith('/campus/service')) {
        return {
          listPlaces: () => {
            throw new Error('Legacy verified catalogue must not gate the manual flow');
          },
        };
      }
      return local(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(p) {
      Object.assign(this.data, p);
    },
  };
  page.onLoad(scene ? { scene } : {});
  page.onShow();
  return { page, session, calls };
}
test('actual default campus page shows five recommendations, guest login and explicit subsequent manual tap', async () => {
  const f = pageFixture();
  await settle();
  assert.equal(f.page.data.manualCheckinMode, true);
  assert.equal(f.page.data.checkinPlaces.length, 5);
  const event = { currentTarget: { dataset: { placeId } } };
  f.page.onCheckinTap(event);
  f.page.onCheckinTap(event);
  assert.equal(
    f.calls.filter((x) => typeof x === 'string' && x.includes('/pages/login/')).length,
    1,
  );
  f.page.onHide();
  f.session.accept(scope('a'));
  f.page.onShow();
  await settle();
  assert.equal(f.calls.filter((x) => x.action === 'campus.checkIn').length, 0);
  f.page.onCheckinTap(event);
  await settle();
  assert.equal(f.calls.filter((x) => x.action === 'campus.checkIn').length, 1);
  assert.equal(f.calls.includes('guard'), true);
  f.page.onUnload();
});
test('single-page timeline preview never initializes manual checkin, authentication or reads', () => {
  const f = pageFixture({ scene: 1154 });
  assert.equal(f.page.data.shareSinglePage, true);
  assert.equal(f.page._checkins, undefined);
  assert.deepEqual(f.calls, []);
  f.page.onUnload();
});

test('actual hidden campus unknown checkin participates in runtime logout/update and guarded home checks', async () => {
  const { workStatus, createAppRuntime } = require('../miniprogram/modules/system/runtime');
  const { goHome } = require('../miniprogram/modules/system/navigation');
  const f = pageFixture({
    write: async () => {
      throw new AppError('NETWORK_ERROR', 'synthetic offline');
    },
  });
  f.session.accept(scope('a'));
  await settle();
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  assert.equal(workStatus([f.page]).pending, true);
  f.page.onHide();
  assert.equal(f.page.data.checkinPendingPlace, '');
  assert.equal(workStatus([f.page]).pending, true);
  const runtime = createAppRuntime({ pages: () => [] });
  const untrack = runtime.trackPage(f.page);
  assert.equal(runtime.getWorkStatus().pending, true);
  const switches = [],
    notices = [];
  goHome({ switchTab: (p) => switches.push(p), showToast: (p) => notices.push(p.title) }, () => [
    f.page,
  ]);
  assert.deepEqual(switches, []);
  assert.deepEqual(notices, ['请先完成或重试当前操作']);
  f.page.onUnload();
  assert.equal(workStatus([f.page]).pending, false);
  untrack();
});

test('actual campus pull refresh deduplicates reads and late hide results cannot stop a newer refresh', async () => {
  const responses = [];
  const f = pageFixture({ read: () => new Promise((r) => responses.push(r)) });
  f.session.accept(scope('a'));
  await settle();
  responses.shift()({ ok: true, data: { date: row.date, items: [] } });
  await settle();
  const first = f.page.onCheckinRefresh(),
    duplicate = f.page.onCheckinRefresh();
  assert.equal(first, duplicate);
  await settle();
  assert.equal(f.page.data.checkinRefreshing, true);
  const old = responses.shift();
  f.page.onHide();
  assert.equal(f.page.data.checkinRefreshing, false);
  f.page.onShow();
  await settle();
  const newer = f.page.onCheckinRefresh();
  await settle();
  const next = responses.shift();
  old({ ok: true, data: { date: row.date, items: [] } });
  await first;
  assert.equal(f.page.data.checkinRefreshing, true);
  next({ ok: true, data: { date: row.date, items: [] } });
  await newer;
  assert.equal(f.page.data.checkinRefreshing, false);
  f.page.onUnload();
});
test('actual campus pull does not retry an unknown write or open login for a guest', async () => {
  const f = pageFixture({
    write: async () => {
      throw new AppError('NETWORK_ERROR', 'offline');
    },
  });
  await settle();
  assert.equal(await f.page.onCheckinRefresh(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.page.data.checkinRefreshing, false);
  f.session.accept(scope('a'));
  await settle();
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  const writes = f.calls.filter((r) => r.action === 'campus.checkIn'),
    reads = f.calls.filter((r) => r.action === 'campus.checkins');
  assert.equal(await f.page.onCheckinRefresh(), false);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, writes.length);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkins').length, reads.length);
  assert.equal(f.page.getWorkStatus().pending, true);
  assert.equal(f.page.data.checkinRefreshing, false);
  assert.equal(f.calls.includes('请先重试上次打卡'), true);
  f.page.onUnload();
});
test('aborting a campus pull releases the indicator without cancelling or duplicating its read', async () => {
  const responses = [];
  const f = pageFixture({ read: () => new Promise((r) => responses.push(r)) });
  f.session.accept(scope('a'));
  await settle();
  responses.shift()({ ok: true, data: { date: row.date, items: [] } });
  await settle();
  const first = f.page.onCheckinRefresh();
  await settle();
  f.page.onCheckinRefreshAbort();
  assert.equal(f.page.data.checkinRefreshing, false);
  const second = f.page.onCheckinRefresh();
  await settle();
  assert.equal(responses.length, 1);
  responses.shift()({ ok: true, data: { date: row.date, items: [] } });
  await first;
  await second;
  assert.equal(f.page.data.checkinRefreshing, false);
  f.page.onUnload();
});

test('account switch releases the old pull indicator and an old A result cannot finish B refresh', async () => {
  const responses = [];
  const f = pageFixture({ read: () => new Promise((r) => responses.push(r)) });
  f.session.accept(scope('a'));
  await settle();
  responses.shift()({ ok: true, data: { date: row.date, items: [] } });
  await settle();
  const first = f.page.onCheckinRefresh();
  await settle();
  const old = responses.shift();
  f.session.accept(scope('b'));
  assert.equal(f.page.data.checkinRefreshing, false);
  await settle();
  const newer = f.page.onCheckinRefresh();
  await settle();
  const next = responses.shift();
  old({ ok: true, data: { date: row.date, items: [row] } });
  await first;
  assert.equal(f.page.data.checkinRefreshing, true);
  assert.equal(f.page.data.checkinPlaces[0].completed, false);
  next({ ok: true, data: { date: row.date, items: [] } });
  await newer;
  assert.equal(f.page.data.checkinRefreshing, false);
  f.page.onUnload();
});
