const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const { createCheckinController } = require('../miniprogram/modules/campus/checkin-controller');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { PLACES } = require('../miniprogram/shared/campus-checkins');
const { AppError } = require('../miniprogram/shared/result');
const A = 'scope_' + 'a'.repeat(64);
const B = 'scope_' + 'b'.repeat(64);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function records(count = 23) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, 5 - Math.floor(index / 5))).toISOString().slice(0, 10);
    return {
      placeId: PLACES[index % 5].placeId,
      date,
      completedAt: date + 'T01:' + String(59 - (index % 5)).padStart(2, '0') + ':00.000Z',
    };
  });
}
function page(items, number = 1, total = items.length) {
  return {
    ok: true,
    data: { items, page: number, pageSize: 10, total, hasMore: number * 10 < total },
  };
}
function fixture(t, authenticated = true) {
  const session = createSessionState();
  if (authenticated) {
    session.accept(A);
  }
  const calls = [],
    view = {};
  let rows = records(),
    logins = 0;
  let history = async (request) =>
    page(
      rows.slice((request.payload.page - 1) * 10, request.payload.page * 10),
      request.payload.page,
      rows.length,
    );
  let write = async () => ({ ok: true, data: records(1)[0] });
  const controller = createCheckinController({
    session,
    service: {
      createRequest,
      async submit(request) {
        calls.push(request);
        if (request.action === 'campus.checkins') {
          return { ok: true, data: { date: '2026-11-05', items: [] } };
        }
        return request.action === 'campus.checkinHistory' ? history(request) : write(request);
      },
    },
    ensureSession: async () => false,
    publish: (patch) => Object.assign(view, patch),
    login: () => {
      logins++;
    },
    clock: () => new Date('2026-11-05T02:00:00.000Z'),
  });
  t.after(() => controller.dispose());
  return {
    controller,
    session,
    calls,
    view,
    logins: () => logins,
    history: (fn) => {
      history = fn;
    },
    write: (fn) => {
      write = fn;
    },
    rows: (value) => {
      rows = value;
    },
  };
}

test('history accepts chronological UTC rows with mixed fractional precision', async (t) => {
  const f = fixture(t);
  const places = [...PLACES].sort((a, b) => a.placeId.localeCompare(b.placeId));
  const stamps = ['.900Z', '.10Z', '.1Z', 'Z'];
  f.rows(
    stamps.map((stamp, index) => ({
      placeId: places[index].placeId,
      date: '2026-11-05',
      completedAt: '2026-11-05T01:00:00' + stamp,
    })),
  );
  await f.controller.show();
  assert.equal(await f.controller.toggleHistory(), true);
  assert.deepEqual(
    f.view.checkinHistory.map((row) => row.name),
    places.slice(0, 4).map((p) => p.name),
  );
  assert.equal(f.view.checkinHistoryError, '');
});

test('history keeps a retired place but never offers it as a new checkin', async (t) => {
  const f = fixture(t);
  const retired = 'fzu-qishan-retired-place';
  f.rows([{ placeId: retired, date: '2026-11-05', completedAt: '2026-11-05T01:00:00.000Z' }]);
  await f.controller.show();
  assert.equal(await f.controller.toggleHistory(), true);
  assert.equal(f.view.checkinHistory.length, 1);
  assert.equal(f.view.checkinHistory[0].name, '已下架地点');
  assert.equal(
    f.view.checkinPlaces.some((place) => place.placeId === retired),
    false,
  );
  f.controller.complete(retired);
  await settle();
  assert.equal(f.calls.filter((request) => request.action === 'campus.checkIn').length, 0);
});

test('history rejects reversed instants even when their UTC strings appear descending', async (t) => {
  const f = fixture(t);
  f.rows(
    ['Z', '.900Z'].map((stamp, index) => ({
      placeId: PLACES[index].placeId,
      date: '2026-11-05',
      completedAt: '2026-11-05T01:00:00' + stamp,
    })),
  );
  await f.controller.show();
  assert.equal(await f.controller.toggleHistory(), false);
  assert.equal(f.view.checkinHistoryRestart, true);
  assert.deepEqual(f.view.checkinHistory, []);
});

test('history next page compares mixed UTC precision against the prior page boundary', async (t) => {
  const f = fixture(t);
  f.rows(
    records(9).concat(
      ['.1Z', 'Z'].map((stamp, index) => ({
        placeId: PLACES[index].placeId,
        date: '2026-11-03',
        completedAt: '2026-11-03T01:00:00' + stamp,
      })),
    ),
  );
  await f.controller.show();
  await f.controller.toggleHistory();
  assert.equal(f.view.checkinHistory.length, 10);
  assert.equal(await f.controller.loadMoreHistory(), true);
  assert.equal(f.view.checkinHistory.length, 11);
  assert.equal(f.view.checkinHistoryError, '');
});

test('history is explicit, paginated with the merged contract and projects only display fields', async (t) => {
  const f = fixture(t);
  f.rows(
    records().map((row) => ({
      ...row,
      text: 'SYNTHETIC_PRIVATE_BODY',
      ownerId: 'SYNTHETIC_OWNER',
    })),
  );
  await f.controller.show();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 0);
  await f.controller.toggleHistory();
  assert.deepEqual(f.calls.at(-1).payload, { page: 1, pageSize: 10 });
  assert.equal(f.view.checkinHistory.length, 10);
  assert.equal(f.view.checkinHistory[0].name, '福友阁');
  assert.equal(f.view.checkinHistory[0].time, '09:59');
  assert.doesNotMatch(JSON.stringify(f.view.checkinHistory), /SYNTHETIC|ownerId|text/);
  await f.controller.loadMoreHistory();
  await f.controller.loadMoreHistory();
  assert.equal(f.view.checkinHistory.length, 23);
  assert.equal(f.view.checkinHistoryMore, false);
  const requests = f.calls.length;
  await f.controller.loadMoreHistory();
  assert.equal(f.calls.length, requests);
});

test('guest history requests login without a private read or an automatic checkin', async (t) => {
  const f = fixture(t, false);
  await f.controller.show();
  await f.controller.toggleHistory();
  assert.equal(f.logins(), 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.view.checkinHistoryOpen, false);
});

test('history empty state is acknowledged and collapsing clears its private rows', async (t) => {
  const f = fixture(t);
  f.rows([]);
  await f.controller.show();
  await f.controller.toggleHistory();
  assert.equal(f.view.checkinHistoryEmpty, true);
  assert.equal(f.view.checkinHistoryMore, false);
  await f.controller.toggleHistory();
  assert.equal(f.view.checkinHistoryOpen, false);
  assert.deepEqual(f.view.checkinHistory, []);
});

test('duplicate history reads share one in-flight request and cannot skip a page', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  let resolve;
  f.history(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const first = f.controller.toggleHistory();
  const second = f.controller.refreshHistory();
  assert.equal(first, second);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkinHistory').length, 1);
  resolve(page(records(10), 1, 23));
  await first;
  const more = f.controller.loadMoreHistory();
  assert.equal(f.controller.loadMoreHistory(), more);
  assert.equal(f.calls.at(-1).payload.page, 2);
  resolve(page(records(20).slice(10), 2, 23));
  await more;
  assert.equal(f.view.checkinHistory.length, 20);
});

test('network failure retains loaded history and retries the same page without exposing raw errors', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  await f.controller.toggleHistory();
  f.history(async () => {
    throw new AppError('NETWORK_ERROR', 'SYNTHETIC_PRIVATE_ERROR');
  });
  await f.controller.loadMoreHistory();
  assert.equal(f.view.checkinHistory.length, 10);
  assert.doesNotMatch(f.view.checkinHistoryError, /SYNTHETIC_PRIVATE/);
  f.history(async (request) => {
    assert.equal(request.payload.page, 2);
    return page(records(20).slice(10), 2, 23);
  });
  await f.controller.retryHistory();
  assert.equal(f.view.checkinHistory.length, 20);
  assert.equal(f.view.checkinHistoryError, '');
});

test('changed totals preserve prior rows and request page one when the user retries', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  await f.controller.toggleHistory();
  f.history(async () => page(records(20).slice(10), 2, 24));
  await f.controller.loadMoreHistory();
  assert.equal(f.view.checkinHistory.length, 10);
  assert.equal(f.view.checkinHistoryRestart, true);
  assert.match(f.view.checkinHistoryError, /已更新/);
  f.history(async (request) => {
    assert.equal(request.payload.page, 1);
    return page(records(10), 1, 24);
  });
  await f.controller.retryHistory();
  assert.equal(f.view.checkinHistoryRestart, false);
});

test('duplicate, reversed or malformed history pages never replace acknowledged rows', async (t) => {
  const badPages = [
    page(records(10), 2, 23),
    page(records(20).slice(10).reverse(), 2, 23),
    page([{ ...records(20)[10], date: '2026-02-30' }, ...records(20).slice(11)], 2, 23),
    { ok: true, data: { ...page(records(20).slice(10), 2, 23).data, page: 3 } },
    { ok: true, data: { ...page(records(20).slice(10), 2, 23).data, hasMore: false } },
  ];
  for (const bad of badPages) {
    const f = fixture(t);
    await f.controller.show();
    await f.controller.toggleHistory();
    const original = JSON.stringify(f.view.checkinHistory);
    f.history(async () => bad);
    await f.controller.loadMoreHistory();
    assert.equal(JSON.stringify(f.view.checkinHistory), original);
    assert.ok(f.view.checkinHistoryError);
  }
});

test('hidden or changed-account history clears immediately and ignores late private results', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  await f.controller.toggleHistory();
  let resolve;
  f.history(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const old = f.controller.loadMoreHistory();
  f.controller.hide();
  assert.deepEqual(f.view.checkinHistory, []);
  assert.equal(f.view.checkinHistoryOpen, false);
  f.session.accept(B);
  await f.controller.show();
  resolve(page(records(20).slice(10), 2, 23));
  await old;
  assert.deepEqual(f.view.checkinHistory, []);
  assert.equal(f.view.checkinHistoryBusy, false);
});

test('history identity errors clear the binding and private list rather than leaving stale rows', async (t) => {
  for (const code of ['UNAUTHENTICATED', 'FORBIDDEN', 'ACCOUNT_DISABLED']) {
    const f = fixture(t);
    await f.controller.show();
    await f.controller.toggleHistory();
    f.history(async () => {
      throw new AppError(code, 'SYNTHETIC_PRIVATE_ERROR');
    });
    await f.controller.loadMoreHistory();
    assert.equal(f.session.capture(), null);
    assert.deepEqual(f.view.checkinHistory, []);
    assert.equal(f.view.checkinSignedIn, false);
  }
});

test('a manual write cancels pending history, retains the unknown write and prevents new history reads', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  let resolve;
  f.history(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const old = f.controller.toggleHistory();
  f.write(async () => {
    throw new AppError('NETWORK_ERROR', 'synthetic offline');
  });
  f.controller.complete(PLACES[0].placeId);
  await settle();
  resolve(page(records(10), 1, 23));
  await old;
  assert.equal(f.controller.getWorkStatus().pending, true);
  assert.equal(f.view.checkinHistoryOpen, false);
  assert.deepEqual(f.view.checkinHistory, []);
  const calls = f.calls.length;
  await f.controller.toggleHistory();
  assert.equal(f.calls.length, calls);
});

test('disposed history cannot publish or dispatch again', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  let resolve;
  f.history(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const old = f.controller.toggleHistory();
  f.controller.dispose();
  const calls = f.calls.length;
  resolve(page(records(10), 1, 23));
  await old;
  await f.controller.toggleHistory();
  await f.controller.loadMoreHistory();
  assert.equal(f.calls.length, calls);
  assert.deepEqual(f.view.checkinHistory, []);
});

test('a failed full refresh retries page one even when old rows remain', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  await f.controller.toggleHistory();
  f.history(() => Promise.reject(null));
  await f.controller.refreshHistory();
  assert.equal(f.view.checkinHistory.length, 10);
  assert.ok(f.view.checkinHistoryError);
  f.history(async (request) => {
    assert.equal(request.payload.page, 1);
    return page(records(10), 1, 23);
  });
  await f.controller.retryHistory();
  assert.equal(f.view.checkinHistory.length, 10);
  assert.equal(f.view.checkinHistoryError, '');
});

test('an old A result cannot release the spinner for a new B history operation', async (t) => {
  const f = fixture(t);
  await f.controller.show();
  const deferred = [];
  f.history(
    () =>
      new Promise((resolve) => {
        deferred.push(resolve);
      }),
  );
  const old = f.controller.toggleHistory();
  f.session.accept(B);
  await settle();
  const next = f.controller.toggleHistory();
  assert.equal(f.view.checkinHistoryBusy, true);
  deferred[0](page(records(10), 1, 23));
  await old;
  assert.equal(f.view.checkinHistoryBusy, true);
  assert.deepEqual(f.view.checkinHistory, []);
  deferred[1](page([], 1, 0));
  await next;
  assert.equal(f.view.checkinHistoryBusy, false);
  assert.equal(f.view.checkinHistoryEmpty, true);
});
