const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const { createCheckinOutbox } = require('../miniprogram/modules/campus/checkin-outbox');
const { createCheckinController } = require('../miniprogram/modules/campus/checkin-controller');
const { createProductionAccountController } = require('../miniprogram/modules/account/production');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createRequest } = require('../miniprogram/services/api');
const { PLACES } = require('../miniprogram/shared/campus-checkins');
const { AppError } = require('../miniprogram/shared/result');
const A = 'scope_' + 'a'.repeat(64);
const B = 'scope_' + 'b'.repeat(64);
const placeId = PLACES[0].placeId;
const row = { placeId, date: '2026-11-05', completedAt: '2026-11-05T01:00:00.000Z' };
const environment = {
  cloudEnabled: true,
  cloudEnvId: 'SYNTHETIC_ENV_A',
  cloudFunctionName: 'moodsky-release',
  releaseProfile: 'production',
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
function storageFixture() {
  const values = new Map();
  const faults = { read: false, write: false, remove: false, dropWrite: false };
  const platform = {
    getStorageSync(key) {
      if (faults.read) {
        throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
      }
      const value = values.get(key);
      return value === undefined ? '' : JSON.parse(JSON.stringify(value));
    },
    setStorageSync(key, value) {
      if (faults.write) {
        throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
      }
      if (!faults.dropWrite) {
        values.set(key, JSON.parse(JSON.stringify(value)));
      }
    },
    removeStorageSync(key) {
      if (faults.remove) {
        throw new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
      }
      values.delete(key);
    },
  };
  return { values, faults, platform, outbox: createCheckinOutbox(platform, environment) };
}
function controllerFixture(storage, session = createSessionState()) {
  if (!session.capture()) {
    session.accept(A);
  }
  const calls = [],
    view = {};
  let write = async () => ({ ok: true, data: row });
  const controller = createCheckinController({
    session,
    pendingStorage: storage.outbox,
    service: {
      createRequest,
      async submit(request) {
        calls.push(request);
        return request.action === 'campus.checkins'
          ? { ok: true, data: { date: row.date, items: [] } }
          : write(request);
      },
    },
    clock: () => new Date(row.completedAt),
    publish: (patch) => Object.assign(view, patch),
    ensureSession: async () => false,
    login() {},
  });
  return {
    controller,
    session,
    calls,
    view,
    write: (handler) => {
      write = handler;
    },
  };
}

test('outbox isolates accounts and cloud destinations while preserving the member legacy key', () => {
  const f = storageFixture();
  const original = createRequest('campus.checkIn', { placeId });
  const legacy = { scope: A, request: { requestId: 'req_legacy', payload: { placeId } } };
  f.values.set('moodsky.campus.checkin.pending', legacy);
  f.outbox.save(A, original);
  assert.equal(f.outbox.read(B), null);
  for (const override of [
    { cloudEnvId: 'SYNTHETIC_ENV_B' },
    { cloudFunctionName: 'moodsky' },
    { cloudEnabled: false },
    { releaseProfile: 'candidate' },
  ]) {
    const other = createCheckinOutbox(f.platform, { ...environment, ...override });
    assert.equal(other.read(A), null);
    other.save(A, createRequest('campus.checkIn', { placeId: PLACES[1].placeId }));
    assert.deepEqual(f.outbox.read(A), original);
  }
  const restored = createCheckinOutbox(f.platform, environment).read(A);
  assert.deepEqual(restored, original);
  assert.equal(Object.isFrozen(restored.payload), true);
  assert.deepEqual(f.values.get('moodsky.campus.checkin.pending'), legacy);
});

test('corrupt or mismatched outbox records are retained and refused instead of becoming a new write', () => {
  for (const corrupt of [
    (record) => {
      record.scope = B;
    },
    (record) => {
      record.namespace = 'SYNTHETIC_OTHER';
    },
    (record) => {
      record.version = 2;
    },
    (record) => {
      record.request.action = 'campus.checkin';
    },
    (record) => {
      record.request.apiVersion = '999';
    },
    (record) => {
      record.request.requestId = '';
    },
    (record) => {
      record.request.payload.ownerId = 'SYNTHETIC_OTHER';
    },
    (record) => {
      record.request.payload.placeId = 'unknown_place';
    },
    (record) => {
      record.request.payload.photo = 'SYNTHETIC_PRIVATE';
    },
  ]) {
    const f = storageFixture();
    f.outbox.save(A, createRequest('campus.checkIn', { placeId }));
    const key = [...f.values.keys()][0];
    const record = f.values.get(key);
    corrupt(record);
    const original = JSON.stringify(record);
    assert.throws(() => f.outbox.read(A));
    assert.equal(JSON.stringify(f.values.get(key)), original);
  }
});

test('outbox refuses a replacement request and detects a local write that was not retained', () => {
  const f = storageFixture();
  const original = createRequest('campus.checkIn', { placeId });
  f.outbox.save(A, original);
  const replacement = createRequest('campus.checkIn', { placeId });
  assert.throws(() => f.outbox.save(A, replacement));
  assert.throws(() => f.outbox.clear(A, replacement));
  assert.deepEqual(f.outbox.read(A), original);
  f.outbox.clear(A, original);
  f.faults.dropWrite = true;
  assert.throws(() => f.outbox.save(A, original));
  assert.equal(f.outbox.read(A), null);
});

test('acknowledged write keeps its original request when local removal fails, then recovers safely', async () => {
  const storage = storageFixture();
  const first = controllerFixture(storage);
  await first.controller.show();
  storage.faults.remove = true;
  first.controller.complete(placeId);
  await settle();
  const request = first.calls.find((r) => r.action === 'campus.checkIn');
  assert.equal(first.controller.getWorkStatus().pending, true);
  assert.match(first.view.checkinError, /本机/);
  first.controller.dispose();
  const next = controllerFixture(storage);
  await next.controller.show();
  assert.equal(next.calls.length, 0);
  storage.faults.remove = false;
  await next.controller.retry();
  assert.deepEqual(
    next.calls.find((r) => r.action === 'campus.checkIn'),
    request,
  );
  assert.equal(next.controller.getWorkStatus().pending, false);
  assert.equal(storage.outbox.read(A), null);
  next.controller.dispose();
});

test('failed persistence never sends, and retrying storage recovery alone does not submit', async () => {
  const storage = storageFixture();
  const f = controllerFixture(storage);
  await f.controller.show();
  storage.faults.write = true;
  f.controller.complete(placeId);
  await settle();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  assert.equal(f.controller.getWorkStatus().pending, true);
  storage.faults.write = false;
  await f.controller.retry();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 0);
  assert.equal(f.controller.getWorkStatus().pending, false);
  f.controller.complete(placeId);
  await settle();
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 1);
  f.controller.dispose();
});

test('a campus storage recovery read restores the original request before a separate retry', async (t) => {
  const storage = storageFixture();
  const original = createRequest('campus.checkIn', { placeId });
  storage.outbox.save(A, original);
  storage.faults.read = true;
  const f = controllerFixture(storage);
  t.after(() => f.controller.dispose());
  await f.controller.show();
  assert.equal(f.view.checkinStorageBlocked, true);
  assert.equal(f.view.checkinPendingPlace, '');
  storage.faults.read = false;
  await f.controller.retry();
  assert.equal(f.view.checkinStorageBlocked, false);
  assert.equal(f.view.checkinPendingPlace, placeId);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(storage.outbox.read(A), original);
  await f.controller.retry();
  assert.deepEqual(
    f.calls.filter((r) => r.action === 'campus.checkIn'),
    [original],
  );
  assert.equal(storage.outbox.read(A), null);
});

test('bad local data blocks refresh and new writes without disclosing storage contents', async () => {
  const storage = storageFixture();
  storage.outbox.save(A, createRequest('campus.checkIn', { placeId }));
  const key = [...storage.values.keys()][0];
  storage.values.get(key).request.payload = { text: 'SYNTHETIC_PRIVATE' };
  const original = JSON.stringify(storage.values.get(key));
  const f = controllerFixture(storage);
  await f.controller.show();
  await f.controller.retry();
  f.controller.complete(placeId);
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.getWorkStatus().pending, true);
  assert.doesNotMatch(f.view.checkinError, /SYNTHETIC_PRIVATE/);
  assert.equal(JSON.stringify(storage.values.get(key)), original);
  f.controller.dispose();
});

test('invalid write acknowledgement survives recreation while a definite unavailable action clears safely', async () => {
  const storage = storageFixture();
  const first = controllerFixture(storage);
  await first.controller.show();
  first.write(async () => ({ ok: true, data: { ...row, date: '2026-02-30' } }));
  first.controller.complete(placeId);
  await settle();
  const original = storage.outbox.read(A);
  assert.ok(original);
  first.controller.dispose();
  const next = controllerFixture(storage);
  await next.controller.show();
  next.write(async () => {
    throw new AppError('ACTION_NOT_FOUND', 'SYNTHETIC_PRIVATE');
  });
  await next.controller.retry();
  assert.deepEqual(next.calls[0], original);
  assert.equal(storage.outbox.read(A), null);
  assert.equal(next.controller.getWorkStatus().pending, false);
  assert.match(next.view.checkinError, /暂未开放/);
  next.controller.dispose();
});

test('late A success cannot delete A recovery or affect B after a session change', async () => {
  const storage = storageFixture();
  const f = controllerFixture(storage);
  await f.controller.show();
  let resolve;
  f.write(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  f.controller.complete(placeId);
  await settle();
  const original = storage.outbox.read(A);
  f.session.accept(B);
  await settle();
  resolve({ ok: true, data: row });
  await settle();
  assert.equal(f.controller.getWorkStatus().pending, false);
  assert.deepEqual(storage.outbox.read(A), original);
  f.session.accept(A);
  await settle();
  assert.equal(f.controller.getWorkStatus().pending, true);
  assert.equal(f.calls.filter((r) => r.action === 'campus.checkIn').length, 1);
  f.controller.dispose();
});

function accountFixture(storage) {
  const session = createSessionState();
  session.accept(A);
  const view = {};
  let acknowledge = false;
  const controller = createProductionAccountController({
    session,
    storage: storage.platform,
    publish: (patch) => Object.assign(view, patch),
    onClosed: (scope) => storage.outbox.purge(scope),
    service: {
      authenticate: async () => true,
      preferences: async () => ({ ok: true, data: {} }),
      createClose: () => createRequest('account.close', { confirm: 'CLOSE' }),
      async recoverClose() {
        if (!acknowledge) {
          throw new AppError('NETWORK_ERROR', '合成未确认');
        }
        return {
          ok: true,
          data: {
            accountStatus: 'disabled',
            cleanup: { jobId: 'synthetic_cleanup', state: 'pending' },
            receipt: 'synthetic_receipt',
          },
        };
      },
      cleanupStatus: async () => ({
        ok: true,
        data: { jobId: 'synthetic_cleanup', state: 'completed' },
      }),
    },
  });
  return {
    controller,
    view,
    acknowledge: () => {
      acknowledge = true;
    },
  };
}

test('only acknowledged account closure purges its local request while retaining B and legacy storage', async () => {
  const storage = storageFixture();
  const request = createRequest('campus.checkIn', { placeId });
  storage.outbox.save(A, request);
  storage.outbox.save(B, request);
  storage.values.set('moodsky.campus.checkin.pending', { scope: B, request });
  const f = accountFixture(storage);
  await f.controller.load();
  await f.controller.close();
  assert.deepEqual(storage.outbox.read(A), request);
  f.acknowledge();
  await f.controller.retry();
  assert.equal(storage.outbox.read(A), null);
  assert.deepEqual(storage.outbox.read(B), request);
  assert.ok(storage.values.has('moodsky.campus.checkin.pending'));
  f.controller.dispose();
});

test('closure preserves recovery and a Chinese notice when local removal fails, then progress query retries cleanup', async () => {
  const storage = storageFixture();
  storage.outbox.save(A, createRequest('campus.checkIn', { placeId }));
  const f = accountFixture(storage);
  await f.controller.load();
  f.acknowledge();
  storage.faults.remove = true;
  await f.controller.close();
  assert.ok(storage.outbox.read(A));
  assert.match(f.view.notice, /本机待确认操作暂未清除/);
  assert.doesNotMatch(f.view.notice, /SYNTHETIC_PRIVATE_STORAGE_ERROR/);
  storage.faults.remove = false;
  await f.controller.cleanupStatus();
  assert.equal(storage.outbox.read(A), null);
  f.controller.dispose();
});
