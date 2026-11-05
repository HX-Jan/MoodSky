const test = require('node:test');
const assert = require('node:assert/strict');
const { createPersistentService } = require('../tools/campus-checkin-candidate/persistent');
const { cloudSessionState } = require('../miniprogram/services/session-state');
function fixture() {
  const docs = new Map();
  let tail = Promise.resolve();
  const database = {
    runTransaction(work) {
      const result = tail.then(() =>
        work({
          collection(name) {
            assert.equal(name, 'campus_checkin_states');
            return {
              doc(id) {
                return {
                  get: async () => ({
                    data: docs.has(id) ? globalThis.structuredClone(docs.get(id)) : null,
                  }),
                  set: async ({ data }) => {
                    docs.set(id, globalThis.structuredClone(data));
                  },
                };
              },
            };
          },
        }),
      );
      tail = result.catch(() => {});
      return result;
    },
  };
  const accounts = { A: true, B: true };
  const create = () =>
    createPersistentService({
      database,
      resolveIdentity: async (binding) =>
        typeof binding === 'string'
          ? binding
          : binding?.scope === 'scope_' + 'a'.repeat(64)
            ? 'A'
            : 'B',
      resolveActive: async (_tx, owner) => accounts[owner] === true,
      resolveDisabled: async (_tx, owner) => accounts[owner] === false,
      findPlace: async () => ({
        placeId: 'fixture',
        name: '合成候选',
        enabled: true,
        isSynthetic: false,
        source: 'synthetic fixture',
        verifiedAt: '2026-10-01T00:00:00Z',
        validUntil: '2027-01-01T00:00:00Z',
        openState: 'OPEN',
      }),
      now: () => Date.parse('2026-11-04T05:00:00Z'),
    });
  return { create, accounts, docs };
}

test('legacy persistent history sorts mixed UTC precision chronologically without rewriting stored visits', async () => {
  const { createHash } = require('node:crypto');
  const f = fixture();
  const id = createHash('sha256').update('A').digest('hex');
  const visits = ['Z', '.900Z'].map((stamp, index) => ({
    placeId: 'fixture_' + index,
    date: '2026-11-04',
    completedAt: '2026-11-04T01:00:00' + stamp,
  }));
  f.docs.set(id, { owner: 'A', visits, requests: [], revision: 2 });
  const service = f.create();
  const first = await service.history({ page: 1, pageSize: 1 }, 'A');
  const second = await service.history({ page: 2, pageSize: 1 }, 'A');
  assert.equal(first.items[0].placeId, 'fixture_1');
  assert.equal(second.items[0].placeId, 'fixture_0');
  assert.deepEqual(f.docs.get(id).visits, visits);
  assert.equal((await service.history({}, 'B')).total, 0);
});
test('persistent adapter survives service reconstruction and enforces owner and repeat boundaries', async () => {
  const f = fixture();
  const first = f.create();
  const req = { requestId: 'req_one', payload: { placeId: 'fixture' } };
  const result = await first.complete(req, 'A');
  const second = f.create();
  assert.deepEqual(await second.complete(req, 'A'), result);
  assert.equal((await second.history({}, 'A')).total, 1);
  assert.equal((await second.history({}, 'B')).total, 0);
  assert.equal((await second.exportMine('A')).revision, 1);
  f.accounts.A = false;
  await assert.rejects(second.complete(req, 'A'), { code: 'ACCOUNT_DISABLED' });
  assert.equal((await second.cleanupDisabled('A')).removed, 1);
  assert.equal((await second.cleanupDisabled('A')).removed, 0);
  assert.equal((await second.history({}, 'B')).total, 0);
});
test('legacy Page bridge forwards unresolved pending after hide and retries the identical request', async () => {
  const { mountCheckin } = require('../miniprogram/modules/campus/checkin/page');
  const { workStatus } = require('../miniprogram/modules/system/runtime');
  const oldWx = globalThis.wx;
  const stored = new Map(),
    calls = [];
  globalThis.wx = {
    getStorageSync: (k) => stored.get(k),
    setStorageSync: (k, v) => stored.set(k, v),
    removeStorageSync: (k) => stored.delete(k),
  };
  const page = {
    data: { selectedPlace: { placeId: 'fixture' } },
    setData(p) {
      Object.assign(this.data, p);
    },
  };
  let fail = true;
  cloudSessionState.accept('scope_' + 'a'.repeat(64));
  try {
    const c = mountCheckin(page, {
      async complete(request) {
        calls.push(request);
        if (fail) {
          throw new Error('offline');
        }
        return {
          visit: {
            placeId: 'fixture',
            date: '2026-11-04',
            completedAt: '2026-11-04T01:00:00.000Z',
          },
        };
      },
    });
    await c.complete('fixture');
    assert.equal(page.data.checkinState, 'unknown');
    assert.equal(workStatus([page]).pending, true);
    c.hide();
    assert.equal(workStatus([page]).pending, true);
    fail = false;
    await c.complete('fixture');
    assert.strictEqual(calls[0], calls[1]);
    assert.equal(workStatus([page]).pending, false);
  } finally {
    globalThis.wx = oldWx;
    cloudSessionState.clear();
  }
});
