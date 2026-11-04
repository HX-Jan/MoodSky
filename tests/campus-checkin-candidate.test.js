const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLocalStore,
  createCheckinCandidate,
} = require('../tools/campus-checkin-candidate/backend');
const { createCheckinController } = require('../tools/campus-checkin-candidate/controller');
function setup() {
  let instant = Date.parse('2026-11-04T15:59:00Z');
  const store = createLocalStore({
    accounts: [
      { id: 'A', status: 'active' },
      { id: 'B', status: 'active' },
    ],
    places: [
      {
        placeId: 'local_fixture',
        name: '合成地点，仅隔离测试',
        enabled: true,
        isSynthetic: false,
        source: 'SYNTHETIC fixture, not real verified material',
        verifiedAt: '2026-10-01T00:00:00Z',
        validUntil: '2027-01-01T00:00:00Z',
        openState: 'OPEN',
      },
    ],
  });
  const service = createCheckinCandidate({
    store,
    now: () => instant,
    resolveIdentity: async (credential) => (['A', 'B'].includes(credential) ? credential : null),
  });
  return {
    store,
    service,
    clock: (value) => {
      instant = Date.parse(value);
    },
  };
}
const request = (id = 'one') => ({ requestId: 'req_' + id, payload: { placeId: 'local_fixture' } });

test('same-day concurrency, original request replay across midnight, history and export ownership', async () => {
  const { service, clock } = setup();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => service.complete(request('r' + i), 'A')),
  );
  assert.equal(results.filter((r) => !r.duplicated).length, 1);
  assert.equal((await service.history({}, 'A')).total, 1);
  assert.equal((await service.history({}, 'B')).total, 0);
  const original = await service.complete(request('r0'), 'A');
  clock('2026-11-04T16:01:00Z');
  assert.deepEqual(await service.complete(request('r0'), 'A'), original);
  const next = await service.complete(request('tomorrow'), 'A');
  assert.equal(next.visit.date, '2026-11-05');
  assert.equal((await service.history({ page: 1, pageSize: 1 }, 'A')).hasMore, true);
  assert.equal((await service.exportMine('A')).revision, 2);
  assert.equal((await service.exportMine('B')).visits.length, 0);
  await assert.rejects(
    service.complete({ ...request(), payload: { placeId: 'local_fixture', owner: 'B' } }, 'A'),
  );
  await assert.rejects(service.complete(request(), null), { code: 'UNAUTHENTICATED' });
});

test('request conflicts, expired or closed place rejection and atomic disabled cleanup', async () => {
  const { service, store, clock } = setup();
  await service.complete(request(), 'A');
  await assert.rejects(service.complete({ ...request(), payload: { placeId: 'different' } }, 'A'), {
    code: 'CONFLICT',
  });
  await store.transaction((state) => {
    state.places[0].openState = 'CLOSED';
    return null;
  });
  await assert.rejects(service.complete(request('closed'), 'B'), { code: 'NOT_FOUND' });
  await store.transaction((state) => {
    state.places[0].openState = 'OPEN';
    return null;
  });
  clock('2027-01-02T00:00:00Z');
  await assert.rejects(service.complete(request('expired'), 'B'), { code: 'NOT_FOUND' });
  clock('2026-11-04T10:00:00Z');
  await service.complete(request('b'), 'B');
  await store.transaction((state) => {
    state.accounts[0].status = 'disabled';
    return null;
  });
  await assert.rejects(service.complete(request(), 'A'), { code: 'ACCOUNT_DISABLED' });
  await assert.rejects(service.history({}, 'A'), { code: 'ACCOUNT_DISABLED' });
  assert.equal((await service.cleanupDisabled('A')).removed, 1);
  assert.equal((await service.cleanupDisabled('A')).removed, 0);
  assert.equal((await service.history({}, 'B')).total, 1);
  await store.transaction((state) => {
    assert.equal(state.places.length, 1);
    return null;
  });
});

test('controller retains original request after lost response and reads history after reopening', async () => {
  const { service } = setup();
  const dispatched = [];
  let lost = true;
  const transport = {
    history: service.history,
    async complete(input, scope) {
      dispatched.push(input);
      const result = await service.complete(input, scope);
      if (lost) {
        lost = false;
        throw new Error('response lost');
      }
      return result;
    },
  };
  let serial = 0;
  const controller = createCheckinController({
    service: transport,
    createRequest: () => request(String(++serial)),
  });
  await controller.complete('local_fixture');
  assert.equal(controller.snapshot().status, 'login_required');
  controller.session('A');
  await controller.complete('local_fixture');
  assert.equal(controller.snapshot().status, 'unknown');
  assert.equal(controller.snapshot().visits.length, 0);
  await controller.complete('other');
  assert.equal(dispatched.length, 1);
  await controller.complete('local_fixture');
  assert.equal(dispatched[0], dispatched[1]);
  assert.equal(controller.snapshot().status, 'completed');
  controller.session('A');
  await controller.refresh();
  assert.equal(controller.snapshot().visits.length, 1);
  controller.session('B');
  await controller.refresh();
  assert.equal(controller.snapshot().visits.length, 0);
});

test('controller blocks repeated taps, drops late private responses and preserves unknown request over hide', async () => {
  let resolve;
  const calls = [];
  const controller = createCheckinController({
    service: {
      history: async () => ({ items: [] }),
      complete: (input) => {
        calls.push(input);
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
    createRequest: () => request(),
  });
  controller.session('A');
  const a = controller.complete('local_fixture');
  await controller.complete('local_fixture');
  assert.equal(calls.length, 1);
  controller.hide();
  resolve({ visit: { placeId: 'local_fixture', date: '2026-11-04' } });
  await a;
  assert.equal(controller.snapshot().visits.length, 0);
  const retry = controller.complete('local_fixture');
  assert.equal(calls[0], calls[1]);
  controller.session('B');
  resolve({ visit: { placeId: 'local_fixture', date: '2026-11-04' } });
  await retry;
  assert.equal(controller.snapshot().visits.length, 0);
});

test('unknown request restores in the same session after controller reconstruction without replaying in B', async () => {
  let saved = null;
  const storage = {
    read: (scope) => (saved?.scope === scope ? saved.request : null),
    write: (scope, request) => {
      saved = { scope, request };
    },
    clear: () => {
      saved = null;
    },
  };
  const calls = [];
  const service = {
    complete: async (r) => {
      calls.push(r);
      throw new Error('offline');
    },
  };
  const make = () =>
    createCheckinController({ service, pendingStorage: storage, createRequest: () => request() });
  const first = make();
  first.session('A');
  await first.complete('local_fixture');
  const reopened = make();
  reopened.session('A');
  await reopened.complete('local_fixture');
  assert.equal(calls[0], calls[1]);
  reopened.session('B');
  assert.equal(saved, null);
});
