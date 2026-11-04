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
  let historyHandler = async () => ({ ok: true, data: { items: [], nextCursor: null } });
  let readHandler = () => ({ ok: true, data: { date: row.date, items: rows } });
  const service = {
    createRequest,
    async submit(request) {
      calls.push(request);
      if (request.action === 'campus.checkinHistory') {
        return historyHandler(request);
      }
      if (request.action === 'campus.checkins') {
        return readHandler();
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
    read: (value) => {
      readHandler = value;
    },
    history: (value) => {
      historyHandler = value;
    },
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
function pageFixture({ scene, write, history } = {}) {
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
      if (request.action === 'campus.checkinHistory') {
        return history ? history(request) : { ok: true, data: { items: [], nextCursor: null } };
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

const historyRows = ['04', '03', '02'].flatMap((day) =>
  PLACES.map((p) => ({
    placeId: p.placeId,
    date: '2026-11-' + day,
    completedAt: '2026-11-' + day + 'T08:00:00.000Z',
  })).sort((a, b) => a.placeId.localeCompare(b.placeId)),
);
test('manual history pages lock repeated taps, retain loaded rows on failure and retry the same cursor', async () => {
  const f = fixture();
  await f.controller.show();
  f.history(async () => ({
    ok: true,
    data: { items: historyRows.slice(0, 10), nextCursor: 'page_two' },
  }));
  f.controller.toggleHistory();
  await settle();
  assert.equal(f.view.checkinHistory.length, 10);
  assert.equal(f.view.checkinHistoryMore, true);
  assert.equal(f.view.checkinHistory[0].name.length > 0, true);
  let reject;
  f.history(
    () =>
      new Promise((_r, fail) => {
        reject = fail;
      }),
  );
  const request = f.controller.moreHistory();
  f.controller.moreHistory();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 2);
  assert.equal(f.controller.getWorkStatus().pending, false);
  reject(new AppError('NETWORK_ERROR', 'offline'));
  await request;
  assert.equal(f.view.checkinHistory.length, 10);
  assert.equal(f.view.checkinHistoryMore, true);
  f.history(async () => ({ ok: true, data: { items: historyRows.slice(10), nextCursor: null } }));
  await f.controller.moreHistory();
  const cursors = f.calls
    .filter((r) => r.action === 'campus.checkinHistory')
    .map((r) => r.payload.cursor);
  assert.deepEqual(cursors, [undefined, 'page_two', 'page_two']);
  assert.equal(f.view.checkinHistory.length, 15);
  assert.equal(f.view.checkinHistoryMore, false);
  f.controller.dispose();
});
for (const event of ['hide', 'account']) {
  test('manual history late response stays private after ' + event, async () => {
    const f = fixture();
    await f.controller.show();
    let resolve;
    f.history(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    f.controller.toggleHistory();
    if (event === 'hide') {
      f.controller.hide();
    } else {
      f.state.accept(scope('b'));
    }
    resolve({ ok: true, data: { items: historyRows.slice(0, 10), nextCursor: 'page_two' } });
    await settle();
    assert.deepEqual(f.view.checkinHistory, []);
    assert.equal(f.view.checkinHistoryOpen, false);
    assert.equal(f.view.checkinHistoryBusy, false);
    f.controller.dispose();
  });
}
for (const fault of ['cursor', 'overlap']) {
  test('manual history refuses a looping cursor or overlapping page: ' + fault, async () => {
    const f = fixture();
    await f.controller.show();
    f.history(async () => ({
      ok: true,
      data: { items: historyRows.slice(0, 10), nextCursor: 'page_two' },
    }));
    f.controller.toggleHistory();
    await settle();
    f.history(async () => ({
      ok: true,
      data: {
        items: fault === 'cursor' ? historyRows.slice(0, 10) : historyRows.slice(0, 1),
        nextCursor: fault === 'cursor' ? 'page_two' : null,
      },
    }));
    await f.controller.moreHistory();
    assert.equal(f.view.checkinHistory.length, 10);
    assert.equal(f.view.checkinHistoryMore, true);
    assert.match(f.view.checkinHistoryError, /重试/);
    f.controller.dispose();
  });
}
test('history disabled response clears current account state rather than leaving completed records visible', async () => {
  const f = fixture();
  await f.controller.show();
  f.controller.complete(placeId);
  await settle();
  assert.equal(f.view.checkinPlaces[0].completed, true);
  f.history(async () => {
    throw new AppError('ACCOUNT_DISABLED', 'disabled');
  });
  f.controller.toggleHistory();
  await settle();
  assert.equal(f.state.capture(), null);
  assert.equal(f.view.checkinSignedIn, false);
  assert.deepEqual(f.view.checkinHistory, []);
  assert.equal(f.view.checkinPlaces[0].completed, false);
  f.controller.dispose();
});
test('actual campus Page exposes readonly own history after login and clears it on hide', async () => {
  const f = pageFixture({
    history: async () => ({ ok: true, data: { items: [row], nextCursor: null } }),
  });
  await settle();
  f.page.onCheckinHistory();
  assert.equal(
    f.calls.some((x) => typeof x === 'string' && x.includes('/pages/login/')),
    true,
  );
  f.page.onHide();
  f.session.accept(scope('a'));
  f.page.onShow();
  await settle();
  f.page.onCheckinHistory();
  await settle();
  assert.equal(f.page.data.checkinHistory.length, 1);
  assert.equal(f.page.getWorkStatus().pending, false);
  assert.equal(f.calls.filter((x) => x.action === 'campus.checkIn').length, 0);
  f.page.onHide();
  assert.equal(f.page.data.checkinHistory.length, 0);
  f.page.onUnload();
});

test('current-day identity failures clear previously confirmed private checkins', async () => {
  for (const code of ['UNAUTHENTICATED', 'ACCOUNT_DISABLED', 'FORBIDDEN']) {
    const f = fixture();
    await f.controller.show();
    f.controller.complete(placeId);
    await settle();
    assert.equal(f.view.checkinPlaces[0].completed, true);
    f.read(async () => {
      throw new AppError(code, 'identity unavailable');
    });
    await f.controller.retry();
    assert.equal(f.state.capture(), null);
    assert.equal(f.view.checkinSignedIn, false);
    assert.equal(f.view.checkinPlaces[0].completed, false);
    f.controller.dispose();
  }
});
test('checkin identity rejection clears prior records and the pending operation', async () => {
  const f = fixture();
  await f.controller.show();
  f.controller.complete(placeId);
  await settle();
  assert.equal(f.view.checkinPlaces[0].completed, true);
  f.write(async () => {
    throw new AppError('ACCOUNT_DISABLED', 'disabled');
  });
  f.controller.complete(PLACES[1].placeId);
  await settle();
  assert.equal(f.state.capture(), null);
  assert.equal(f.view.checkinSignedIn, false);
  assert.equal(f.view.checkinPlaces[0].completed, false);
  assert.equal(f.controller.getWorkStatus().pending, false);
  f.controller.dispose();
});

test('history empty state appears only after a confirmed empty read, not while loading or after failure', async () => {
  const f = fixture();
  await f.controller.show();
  let resolve;
  f.history(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  f.controller.toggleHistory();
  assert.equal(f.view.checkinHistoryEmpty, false);
  assert.equal(f.view.checkinHistoryBusy, true);
  resolve({ ok: true, data: { items: [], nextCursor: null } });
  await settle();
  assert.equal(f.view.checkinHistoryEmpty, true);
  f.controller.toggleHistory();
  assert.equal(f.view.checkinHistoryEmpty, false);
  f.history(async () => {
    throw new AppError('NETWORK_ERROR', 'offline');
  });
  f.controller.toggleHistory();
  await settle();
  assert.equal(f.view.checkinHistoryEmpty, false);
  assert.match(f.view.checkinHistoryError, /重试/);
  f.controller.dispose();
});
