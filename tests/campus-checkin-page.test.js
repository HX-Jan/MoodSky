const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const { createPersistentService } = require('../tools/campus-checkin-candidate/persistent');
const service = require('../miniprogram/modules/campus/service');
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
  return { create, accounts };
}
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
test('actual campus Page saves through candidate adapter, rereads and clears on account change', async () => {
  const file = require.resolve('../miniprogram/pages/campus/index');
  const oldPage = globalThis.Page,
    oldWx = globalThis.wx;
  const oldAdapter = service.checkinAdapter;
  let definition;
  globalThis.Page = (value) => {
    definition = value;
  };
  globalThis.wx = {};
  const f = fixture();
  service.checkinAdapter = f.create();
  delete require.cache[file];
  require(file);
  const page = {
    ...definition,
    data: { ...definition.data, isProduction: false, isExperience: false },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    loadCloudPlaces() {},
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise(setImmediate);
    }
  };
  try {
    cloudSessionState.clear();
    page.onLoad();
    assert.equal(page.data.checkinReady, true);
    page.setData({ catalogMode: 'cloud', selectedPlace: { placeId: 'fixture' } });
    page.onCheckin();
    await settle();
    assert.equal(page.data.checkinState, 'login_required');
    cloudSessionState.accept('scope_' + 'a'.repeat(64));
    await settle();
    page.setData({ catalogMode: 'cloud', selectedPlace: { placeId: 'fixture' } });
    page.onCheckin();
    page.onCheckin();
    await settle();
    assert.equal(page.data.checkinState, 'completed');
    assert.equal(page.data.checkinHistory.length, 1);
    page.onRefreshCheckins();
    await settle();
    assert.equal(page.data.checkinHistory.length, 1);
    page.onHide();
    cloudSessionState.accept('scope_' + 'b'.repeat(64));
    await settle();
    assert.deepEqual(page.data.checkinHistory, []);
    page.onShow();
    await settle();
    assert.deepEqual(page.data.checkinHistory, []);
  } finally {
    page.onUnload();
    cloudSessionState.clear();
    globalThis.Page = oldPage;
    globalThis.wx = oldWx;
    service.checkinAdapter = oldAdapter;
    delete require.cache[file];
  }
});
