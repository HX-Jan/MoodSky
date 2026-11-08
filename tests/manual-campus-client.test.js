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
function pageFixture({
  scene,
  write,
  read,
  history,
  transport,
  navigate,
  storage = new Map(),
  storageFail = false,
} = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/campus/index.js');
  const local = createRequire(file),
    session = createSessionState(),
    calls = [];
  let definition;
  const platform = {
    getStorageSync: (key) => {
      if (storageFail) {
        throw new Error('SYNTHETIC storage unavailable');
      }
      return storage.get(key);
    },
    setStorageSync: (key, value) => {
      if (storageFail) {
        throw new Error('SYNTHETIC storage unavailable');
      }
      storage.set(key, value);
    },
    removeStorageSync: (key) => {
      if (storageFail) {
        throw new Error('SYNTHETIC storage unavailable');
      }
      storage.delete(key);
    },
    getEnterOptionsSync: () => ({ scene: scene || 1001 }),
    showShareMenu() {},
    navigateTo: (p) => {
      calls.push(p.url);
      navigate?.(p);
    },
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
      if (transport) {
        return transport(request);
      }
      if (request.action === 'campus.checkinHistory' && history) {
        return history(request);
      }
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
  return { page, session, calls, storage };
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

test('guest login keeps the first selected public place and returns to it without auto checkin', async () => {
  const f = pageFixture();
  await settle();
  const selected = PLACES[4].placeId;
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId: selected } } });
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId: PLACES[0].placeId } } });
  assert.equal(f.storage.get('moodsky.campus.returnPlace'), selected);
  assert.equal(
    f.calls.filter((r) => typeof r === 'string' && r.includes('/pages/login/')).length,
    1,
  );
  f.page.onHide();
  f.session.accept(scope('a'));
  f.page.onShow();
  await settle();
  assert.equal(f.page.data.checkinScrollTarget, 'checkin-place-' + selected);
  assert.equal(f.storage.has('moodsky.campus.returnPlace'), false);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  f.page.onHide();
  f.page.onShow();
  await settle();
  assert.equal(f.page.data.checkinScrollTarget, '');
  f.page.onUnload();
  f.page.onCheckinLogin(PLACES[0].placeId);
  assert.equal(f.storage.has('moodsky.campus.returnPlace'), false);
});
test('a cold campus entry consumes only a known public place, never a route or private object', async () => {
  for (const target of [
    PLACES[3].placeId,
    '../../pages/account/index?ownerId=other',
    { placeId: PLACES[0].placeId, ownerId: 'other' },
  ]) {
    const storage = new Map([['moodsky.campus.returnPlace', target]]),
      f = pageFixture({ storage });
    await settle();
    assert.equal(
      f.page.data.checkinScrollTarget,
      typeof target === 'string' && target === PLACES[3].placeId ? 'checkin-place-' + target : '',
    );
    assert.equal(storage.has('moodsky.campus.returnPlace'), false);
    assert.equal(f.calls.length, 0);
    f.page.onUnload();
  }
});
test('optional return-place storage failure keeps cached-page positioning without blocking login', async () => {
  const f = pageFixture({ storageFail: true });
  await settle();
  const selected = PLACES[2].placeId;
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId: selected } } });
  assert.equal(
    f.calls.some((r) => typeof r === 'string' && r.includes('/pages/login/')),
    true,
  );
  f.page.onHide();
  f.page.onShow();
  await settle();
  assert.equal(f.page.data.checkinScrollTarget, 'checkin-place-' + selected);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  f.page.onUnload();
});

test('actual campus restores an unknown write after Page recreation and retries the same frozen request', async () => {
  const storage = new Map();
  const first = pageFixture({
    storage,
    write: async () => {
      throw new AppError('NETWORK_ERROR', 'synthetic offline');
    },
  });
  first.session.accept(scope('a'));
  await settle();
  first.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  const original = first.calls.find((r) => r.action === 'campus.checkIn');
  first.page.onUnload();
  const next = pageFixture({ storage });
  next.session.accept(scope('a'));
  await settle();
  assert.equal(next.page.getWorkStatus().pending, true);
  assert.equal(next.page.data.checkinPendingPlace, placeId);
  assert.equal(next.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  next.page.onCheckinTap({ currentTarget: { dataset: { placeId: PLACES[1].placeId } } });
  assert.equal(next.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  next.page.onCheckinRetry();
  await settle();
  const replay = next.calls.find((r) => r.action === 'campus.checkIn');
  assert.deepEqual(replay, original);
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(Object.isFrozen(replay.payload), true);
  assert.equal(next.page.getWorkStatus().pending, false);
  next.page.onUnload();
  const last = pageFixture({ storage });
  last.session.accept(scope('a'));
  await settle();
  assert.equal(last.page.getWorkStatus().pending, false);
  last.page.onUnload();
});

test('persisted manual request stays private to A and survives a B login without replay', async () => {
  const storage = new Map();
  const first = pageFixture({
    storage,
    write: async () => {
      throw new AppError('NETWORK_ERROR', 'synthetic offline');
    },
  });
  first.session.accept(scope('a'));
  await settle();
  first.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  first.session.clear();
  first.page.onUnload();
  const next = pageFixture({ storage });
  next.session.accept(scope('b'));
  await settle();
  assert.equal(next.page.getWorkStatus().pending, false);
  assert.equal(next.page.data.checkinPendingPlace, '');
  next.session.accept(scope('a'));
  await settle();
  assert.equal(next.page.getWorkStatus().pending, true);
  assert.equal(next.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  next.page.onUnload();
});

test('actual campus refuses to dispatch a write when local request persistence is unavailable', async () => {
  const f = pageFixture({ storageFail: true });
  f.session.accept(scope('a'));
  await settle();
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  assert.match(f.page.data.checkinError, /本机/);
  assert.equal(f.page.data.checkinStorageBlocked, true);
  f.page.onUnload();
});

for (const badRecord of [
  { date: '2026-03-02', completedAt: '2026-02-30T01:00:00.000Z' },
  { date: '2026-11-04', completedAt: '2026-11-04T16:00:00+08:00' },
  { date: '2026-11-05', completedAt: '2026-11-04T24:00:00.000Z' },
  { date: '2026-11-05', completedAt: '2026-11-05' },
]) {
  test(
    'actual Page preserves the durable request for a parseable but invalid UTC acknowledgement: ' +
      badRecord.completedAt,
    async () => {
      const storage = new Map();
      const first = pageFixture({
        storage,
        write: async () => ({ ok: true, data: { placeId, ...badRecord } }),
      });
      first.session.accept(scope('a'));
      await settle();
      first.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
      await settle();
      const original = first.calls.find((r) => r.action === 'campus.checkIn');
      assert.equal(first.page.getWorkStatus().pending, true);
      assert.equal(first.calls.includes('已打卡'), false);
      first.page.onUnload();
      const next = pageFixture({ storage });
      next.session.accept(scope('a'));
      await settle();
      assert.equal(next.page.getWorkStatus().pending, true);
      assert.equal(next.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
      next.page.onCheckinRetry();
      await settle();
      assert.deepEqual(
        next.calls.find((r) => r.action === 'campus.checkIn'),
        original,
      );
      assert.equal(next.page.getWorkStatus().pending, false);
      next.page.onUnload();
    },
  );
}
const historyReply = {
  ok: true,
  data: { items: [row], page: 1, pageSize: 10, total: 1, hasMore: false },
};
test('history login returns to the requested view once without performing a checkin', async (t) => {
  const f = pageFixture({ history: async () => historyReply });
  t.after(() => f.page.onUnload());
  await settle();
  await f.page.onCheckinHistory();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  assert.equal(
    f.calls.filter((r) => typeof r === 'string' && r.includes('/pages/login/')).length,
    1,
  );
  f.page.onHide();
  f.session.accept(scope('a'));
  await f.page.onShow();
  assert.equal(f.page.data.checkinHistoryOpen, true);
  assert.equal(f.page.data.checkinHistory.length, 1);
  assert.equal(f.page.data.checkinScrollTarget, 'checkin-history');
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 1);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  await f.page.onShow();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 1);
});

test('cancelled history login consumes the view intent and does not open after a later login', async (t) => {
  const f = pageFixture({ history: async () => historyReply });
  t.after(() => f.page.onUnload());
  await settle();
  await f.page.onCheckinHistory();
  f.page.onHide();
  await f.page.onShow();
  f.session.accept(scope('a'));
  await settle();
  assert.equal(f.page.data.checkinHistoryOpen, false);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
});

test('failed navigation clears history return intent without exposing the platform error', async (t) => {
  const f = pageFixture({
    history: async () => historyReply,
    navigate: (options) => options.fail({ errMsg: 'SYNTHETIC_PRIVATE_NAVIGATION' }),
  });
  t.after(() => f.page.onUnload());
  await settle();
  await f.page.onCheckinHistory();
  f.session.accept(scope('a'));
  await f.page.onShow();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  assert.doesNotMatch(JSON.stringify(f.calls), /SYNTHETIC_PRIVATE_NAVIGATION/);
});

test('late failure from an old navigation cannot clear a newer history login intent', async (t) => {
  const navigations = [];
  const f = pageFixture({
    history: async () => historyReply,
    navigate: (options) => navigations.push(options),
  });
  t.after(() => f.page.onUnload());
  await settle();
  await f.page.onCheckinHistory();
  f.page.onHide();
  await f.page.onShow();
  await f.page.onCheckinHistory();
  navigations[0].fail({ errMsg: 'SYNTHETIC late failure' });
  f.page.onHide();
  f.session.accept(scope('a'));
  await f.page.onShow();
  assert.equal(f.page.data.checkinHistoryOpen, true);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 1);
});

test('a restored unknown write stays ahead of a history login return', async (t) => {
  const f = pageFixture({
    history: async () => historyReply,
    write: async () => {
      throw new AppError('NETWORK_ERROR', 'synthetic offline');
    },
  });
  t.after(() => f.page.onUnload());
  f.session.accept(scope('a'));
  await settle();
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  f.session.clear();
  await f.page.onCheckinHistory();
  f.page.onHide();
  f.session.accept(scope('a'));
  await f.page.onShow();
  assert.equal(f.page.getWorkStatus().pending, true);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 1);
});

test('hiding before return loading completes cancels the automatic history read', async (t) => {
  let resolve;
  const f = pageFixture({
    history: async () => historyReply,
    read: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  t.after(() => f.page.onUnload());
  await settle();
  await f.page.onCheckinHistory();
  f.page.onHide();
  f.session.accept(scope('a'));
  const showing = f.page.onShow();
  f.page.onHide();
  resolve({ ok: true, data: { date: row.date, items: [] } });
  await showing;
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
});

test('changing accounts during return loading cannot open the new account from the old intent', async (t) => {
  let resolve,
    reads = 0;
  const f = pageFixture({
    history: async () => historyReply,
    read: async () => {
      if (++reads === 1) {
        return new Promise((r) => {
          resolve = r;
        });
      }
      return { ok: true, data: { date: row.date, items: [] } };
    },
  });
  t.after(() => f.page.onUnload());
  await settle();
  await f.page.onCheckinHistory();
  f.page.onHide();
  f.session.accept(scope('a'));
  const showing = f.page.onShow();
  f.session.accept(scope('b'));
  resolve({ ok: true, data: { date: row.date, items: [] } });
  await showing;
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  assert.equal(f.page.data.checkinHistoryOpen, false);
});

test('actual campus history reads the merged production page API and keeps both share cards static', async (t) => {
  const { databaseFixture } = require('./helpers/w2-database');
  const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
  const {
    readProductionConfig,
    APP_ID,
    ENV_ID,
  } = require('../cloudfunctions/moodsky/production/config');
  const config = readProductionConfig({
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  });
  const database = databaseFixture({});
  let instant = new Date('2026-11-05T01:00:00.000Z');
  const entry = createProductionEntry({
    readIdentity: () => ({
      APPID: APP_ID,
      ENV: ENV_ID,
      SOURCE: 'wx_client',
      OPENID: 'synthetic_history_owner',
      identityFromCurrentInvocation: true,
    }),
    readConfig: () => config,
    openDatabase: () => database.db,
    now: () => instant,
  });
  const auth = await entry(createRequest('account.session'));
  assert.equal(auth.ok, true);
  for (let index = 0; index < 23; index++) {
    const date = new Date(Date.UTC(2026, 10, 5 - Math.floor(index / 5))).toISOString().slice(0, 10);
    instant = new Date(date + 'T01:' + String(59 - (index % 5)).padStart(2, '0') + ':00.000Z');
    assert.equal(
      (
        await entry({
          ...createRequest('campus.checkIn', { placeId: PLACES[index % 5].placeId }),
          sessionScope: auth.data.scope,
        })
      ).ok,
      true,
    );
  }
  instant = new Date('2026-11-05T02:00:00.000Z');
  const f = pageFixture({
    transport: (request) => entry({ ...request, sessionScope: f.session.capture()?.scope }),
  });
  t.after(() => f.page.onUnload());
  f.session.accept(auth.data.scope);
  await settle();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  await f.page.onCheckinHistory();
  assert.equal(f.page.data.checkinHistory.length, 10);
  assert.equal(f.page.data.checkinScrollTarget, 'checkin-history');
  await f.page.onCheckinHistoryMore();
  await f.page.onCheckinHistoryMore();
  assert.equal(f.page.data.checkinHistory.length, 23);
  assert.equal(f.page.data.checkinHistoryMore, false);
  for (const card of [f.page.onShareAppMessage(), f.page.onShareTimeline()]) {
    assert.equal(card.imageUrl, '/assets/jiaqi/PARTLY_CLOUDY.png');
    assert.doesNotMatch(JSON.stringify(card), /2026-|synthetic_history_owner|scope_|completedAt/);
  }
  const count = f.calls.filter((r) => r.action === 'campus.checkinHistory').length;
  f.page.onHide();
  assert.equal(f.page.data.checkinHistory.length, 0);
  f.page.onShow();
  await settle();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, count);
});

test('actual history Page scrolls to loading immediately and allows closing before the read ends', async (t) => {
  const pending = [];
  const f = pageFixture({
    history: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  });
  t.after(() => f.page.onUnload());
  f.session.accept(scope('a'));
  await settle();
  const opened = f.page.onCheckinHistory();
  assert.equal(f.page.data.checkinHistoryOpen, true);
  assert.equal(f.page.data.checkinHistoryBusy, true);
  assert.equal(f.page.data.checkinScrollTarget, 'checkin-history');
  assert.equal(await f.page.onCheckinHistory(), false);
  assert.equal(f.page.data.checkinHistoryOpen, false);
  assert.equal(f.page.data.checkinHistoryBusy, false);
  assert.equal(f.page.data.checkinScrollTarget, '');
  pending[0]({ ok: true, data: { items: [row], page: 1, pageSize: 10, total: 1, hasMore: false } });
  assert.equal(await opened, false);
  assert.equal(f.page.data.checkinHistory.length, 0);
  assert.equal(f.page.data.checkinScrollTarget, '');
  const reopened = f.page.onCheckinHistory();
  pending[1]({ ok: true, data: { items: [], page: 1, pageSize: 10, total: 0, hasMore: false } });
  assert.equal(await reopened, true);
  assert.equal(f.page.data.checkinHistoryEmpty, true);
});

test('actual history Page keeps a new account spinner when an old account response arrives', async (t) => {
  const pending = [];
  const f = pageFixture({
    history: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  });
  t.after(() => f.page.onUnload());
  f.session.accept(scope('a'));
  await settle();
  const old = f.page.onCheckinHistory();
  f.session.accept(scope('b'));
  await settle();
  const next = f.page.onCheckinHistory();
  const newAccountAnchor = f.page.data.checkinScrollTarget;
  assert.equal(newAccountAnchor, 'checkin-history');
  pending[0]({ ok: true, data: { items: [row], page: 1, pageSize: 10, total: 1, hasMore: false } });
  await old;
  assert.equal(f.page.data.checkinHistory.length, 0);
  assert.equal(f.page.data.checkinHistoryBusy, true);
  assert.equal(f.page.data.checkinScrollTarget, newAccountAnchor);
  pending[1]({ ok: true, data: { items: [], page: 1, pageSize: 10, total: 0, hasMore: false } });
  await next;
  assert.equal(f.page.data.checkinHistoryEmpty, true);
});

test('timeline single-page preview cannot initialize or read private checkin history', async () => {
  const f = pageFixture({ scene: 1154 });
  await f.page.onCheckinHistory();
  await f.page.onCheckinHistoryMore();
  await f.page.onCheckinHistoryRefresh();
  await f.page.onCheckinHistoryRetry();
  assert.equal(f.page._checkins, undefined);
  assert.deepEqual(f.calls, []);
  f.page.onUnload();
});

test('actual Page keeps an unknown manual write ahead of history browsing', async (t) => {
  const f = pageFixture({
    write: async () => {
      throw new AppError('NETWORK_ERROR', 'synthetic offline');
    },
  });
  t.after(() => f.page.onUnload());
  f.session.accept(scope('a'));
  await settle();
  f.page.onCheckinTap({ currentTarget: { dataset: { placeId } } });
  await settle();
  await f.page.onCheckinHistory();
  assert.equal(f.page.getWorkStatus().pending, true);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  assert.equal(f.page.data.checkinHistoryOpen, false);
});

for (const invalid of [
  { date: '2026-02-30', completedAt: '2026-03-02T01:00:00.000Z' },
  { date: '2026-11-04', completedAt: 'not-a-time' },
  { date: '2026-11-04', completedAt: '2026-02-30T01:00:00.000Z' },
  { date: '2026-11-04', completedAt: '2026-11-04T16:00:00.000Z' },
  { placeId: PLACES[1].placeId },
]) {
  test(
    'PR130 invalid acknowledgement retains original request: ' + JSON.stringify(invalid),
    async () => {
      const f = fixture();
      f.write(async () => ({ ok: true, data: { ...row, ...invalid } }));
      await f.controller.show();
      f.controller.complete(placeId);
      await settle();
      assert.equal(f.controller.getWorkStatus().pending, true);
      assert.equal(f.toasts.length, 0);
      const original = f.calls.find((r) => r.action === 'campus.checkIn');
      f.controller.hide();
      assert.equal(f.controller.getWorkStatus().pending, true);
      await f.controller.show();
      f.write(async () => ({ ok: true, data: row }));
      await f.controller.retry();
      assert.strictEqual(f.calls.filter((r) => r.action === 'campus.checkIn').at(-1), original);
      assert.equal(f.controller.getWorkStatus().pending, false);
      f.controller.dispose();
    },
  );
}
