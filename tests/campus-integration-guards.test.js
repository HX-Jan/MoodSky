const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const { createRepositories } = require('../cloudfunctions/moodsky/repositories');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const adminRules = require('../cloudfunctions/moodsky/domains/admin-rules');
const { createMemoryRepositories } = require('./support/campus-repository');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const api = require('../miniprogram/services/api');
const campusService = require('../miniprogram/modules/campus/service');
const { campusResult } = require('../miniprogram/modules/campus/cloud-result');
const { classification } = require('../cloudfunctions/moodsky/domains/campus-rules');
const instant = '2026-10-28T04:00:00.000Z';
const now = Date.parse(instant);
const place = {
  _id: 'synthetic_place_doc',
  placeId: 'synthetic_place',
  name: '合成资料',
  campus: '合成校区',
  tags: ['安静'],
  openState: 'OPEN',
  enabled: true,
  isSynthetic: false,
  source: 'SYNTHETIC review fixture',
  verifiedAt: '2026-10-01T00:00:00.000Z',
  validUntil: '2027-01-01T00:00:00.000Z',
  updatedAt: instant,
};
const clone = (value) => globalThis.structuredClone(value);
let serial = 0;
const request = (action, payload) => ({
  apiVersion: '1',
  requestId: 'req_campus_guard_' + ++serial,
  action,
  payload,
});
const router = (repositories, extra = {}) =>
  createRouter({
    repositories,
    now: () => now,
    resolveAccount: async () => ({ id: 'synthetic_operator', status: 'active' }),
    resolveOperatorRoles: async () => ['data_operator'],
    ...extra,
  });
const update = (name, extra = {}) =>
  request('admin.updatePlace', {
    placeId: place.placeId,
    changes: { name },
    expectedUpdatedAt: instant,
    ...extra,
  });
const invoke = (handler, input) => handler(input, { OPENID: 'synthetic_trusted_context' });

// Root lookups use the committed synthetic view. Mutations cross the installed
// WX SDK transaction serializer, with its transport replaced and HTTP blocked.
function campusDatabase(db, inspect) {
  return {
    runTransaction: (work) => db.runTransaction(work),
    collection(name) {
      assert.equal(name, 'places');
      return {
        where(filter) {
          return {
            limit(count) {
              return {
                async get() {
                  return {
                    data: Object.entries(inspect())
                      .filter(
                        ([key, row]) => key.startsWith('places:') && row.placeId === filter.placeId,
                      )
                      .map(([, row]) => row)
                      .slice(0, count),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('actual campus repository and locked SDK reject one same-version racer even within the same millisecond', async () => {
  await withOfflineWxDatabase(
    { ['places:' + place._id]: place },
    async ({ db, inspect, calls }) => {
      const repositories = createRepositories({ database: () => campusDatabase(db, inspect) });
      const handler = router(repositories);
      const results = await Promise.all([
        invoke(handler, update('first')),
        invoke(handler, update('second')),
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      assert.equal(results.find((result) => !result.ok).error.code, 'CONFLICT');
      assert.equal(inspect()['places:' + place._id].updatedAt, new Date(now + 1).toISOString());
      assert.ok(
        calls.some(
          (call) => call.action === 'database.modifyDocument' && call.params.transactionId,
        ),
      );
      assert.ok(calls.filter((call) => call.action === 'database.startTransaction').length >= 3);
    },
    { conflictScope: 'written-documents' },
  );
});

test('locked SDK mutation failure rolls back and a fresh retry rechecks the expected version', async () => {
  let armed = true;
  await withOfflineWxDatabase(
    { ['places:' + place._id]: place },
    async ({ db, inspect }) => {
      const repositories = createRepositories({ database: () => campusDatabase(db, inspect) });
      const handler = router(repositories);
      assert.equal((await invoke(handler, update('must_not_commit'))).error.code, 'INTERNAL_ERROR');
      assert.deepEqual(inspect()['places:' + place._id], place);
      armed = false;
      const saved = await invoke(handler, update('after_retry'));
      assert.equal(saved.data.verified, true);
      assert.equal(saved.data.place.name, 'after_retry');
    },
    { fail: (action) => (action === 'database.modifyDocument' && armed ? 'SYS_ERR' : null) },
  );
});

function controlledRepository({ updated = 1, timestampsOnly = false } = {}) {
  let stored = clone(place);
  let transactions = 0;
  const document = {
    get: async () => ({ data: clone(stored) }),
    async update({ data }) {
      if (updated === 1) {
        stored = { ...stored, ...(timestampsOnly ? { updatedAt: data.updatedAt } : clone(data)) };
      }
      return { stats: { updated } };
    },
  };
  const collection = {
    where: () => ({ limit: () => ({ get: async () => ({ data: [clone(stored)] }) }) }),
    doc: () => document,
  };
  return {
    repositories: createRepositories({
      database: () => ({
        collection: () => collection,
        async runTransaction(work) {
          transactions++;
          return work({ collection: () => collection });
        },
      }),
    }),
    inspect: () => clone(stored),
    transactions: () => transactions,
  };
}

test('zero, multiple or missing updated row acknowledgements never report a successful place save', async () => {
  for (const updated of [0, 2, null]) {
    const f = controlledRepository({ updated });
    const result = await invoke(router(f.repositories), update('not_applied'));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CONFLICT');
    assert.equal(f.inspect().name, place.name);
    assert.equal(f.transactions(), 1);
  }
});

test('matching updatedAt cannot verify a write whose actual changed fields were not applied', async () => {
  const f = controlledRepository({ timestampsOnly: true });
  const result = await invoke(router(f.repositories), update('not_applied'));
  assert.equal(result.data.saved, true);
  assert.equal(result.data.verified, false);
  assert.equal(f.inspect().name, place.name);
});

test('malformed scans and duplicate place IDs fail instead of becoming an empty list or an arbitrary write target', async () => {
  const collection = (data) => ({
    orderBy() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    where() {
      return this;
    },
    async get() {
      return { data };
    },
  });
  const malformed = createRepositories({
    database: () => ({ collection: () => collection(null) }),
  });
  await assert.rejects(malformed.places.listAll(), /Invalid campus database response/);
  const duplicate = createRepositories({
    database: () => ({ collection: () => collection([place, place]) }),
  });
  await assert.rejects(duplicate.places.findByPlaceId(place.placeId), { code: 'CONFLICT' });
});

test('favorite and correction writes require valid create and removal acknowledgements', async () => {
  const collection = {
    add: async () => ({}),
    where: () => ({
      limit: () => ({ get: async () => ({ data: [] }) }),
      remove: async () => ({ stats: { removed: null } }),
    }),
  };
  const repositories = createRepositories({ database: () => ({ collection: () => collection }) });
  await assert.rejects(
    repositories.favorites.add('synthetic_owner', place.placeId, instant),
    /acknowledgement/,
  );
  await assert.rejects(repositories.corrections.create({}), /acknowledgement/);
  await assert.rejects(
    repositories.favorites.remove('synthetic_owner', place.placeId),
    /acknowledgement/,
  );
});

test('future verification, blank sources and nonfinite maintenance coordinates are rejected', () => {
  assert.equal(
    classification({ ...place, verifiedAt: new Date(now + 1).toISOString() }, now),
    'unverified',
  );
  assert.equal(classification({ ...place, source: '   ' }, now), 'unverified');
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(
      () =>
        adminRules.validateUpdatePlace({
          placeId: place.placeId,
          changes: { location: { latitude: value, longitude: 1 } },
        }),
      { code: 'INVALID_INPUT' },
    );
    assert.throws(
      () =>
        adminRules.validateUpdatePlace({
          placeId: place.placeId,
          changes: { location: { latitude: 1, longitude: value } },
        }),
      { code: 'INVALID_INPUT' },
    );
  }
});

test('new campus clock seam never reads or changes an existing domain handler clock', async () => {
  const handler = router(
    {},
    {
      now: () => {
        throw Error('Unrelated clock invoked');
      },
      domainHandlers: { journal: async () => ({ existingHandler: true }) },
    },
  );
  assert.equal(
    (await invoke(handler, request('journal.get', { date: '2026-10-28' }))).data.existingHandler,
    true,
  );
  assert.equal((await handler(request('campus.weatherPreview', {}))).ok, true);
});

test('existing service and actual campus Page consume empty filters, Chinese tags and wrapped detail without enabling navigation', async () => {
  const originalCall = api.call,
    originalPage = globalThis.Page,
    originalWx = globalThis.wx;
  const handler = router(
    createMemoryRepositories({
      places: [place],
      supportResources: [
        { ...place, resourceId: 'synthetic_resource', description: '合成支持说明' },
      ],
    }),
  );
  api.call = async (input) => {
    const result = await invoke(handler, input);
    if (!result.ok) {
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    return result;
  };
  const file = require.resolve('../miniprogram/pages/campus/index');
  let definition;
  globalThis.Page = (page) => {
    definition = page;
  };
  globalThis.wx = {};
  delete require.cache[file];
  try {
    require(file);
    const page = {
      ...definition,
      data: clone(definition.data),
      setData(values) {
        this.data = { ...this.data, ...values };
      },
    };
    page.onLoad();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.listState, 'ready');
    assert.equal(page.data.places[0].tagText, '安静');
    assert.equal(page.data.places[0].sourceText, place.source);
    const filtered = await campusService.listPlaces({ tags: ['安静'], page: 1, pageSize: 2 });
    assert.equal(filtered.data.total, 1);
    const result = await campusService.getPlace(place.placeId);
    page._selectedPlaceId = place.placeId;
    page._detailGeneration = 1;
    page.applyPlaceDetail(result, place.placeId, 1);
    assert.equal(page.data.detailState, 'ready');
    assert.equal(page.data.selectedPlace.navigationAvailable, false);
    assert.equal(campusService.privateActionsReady, false);
    page.onSupportResources();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.data.supportState, 'ready');
    assert.equal(page.data.supportItems[0].id, 'synthetic_resource');
    assert.equal(page.data.supportItems[0].description, '合成支持说明');
    page.onUnload();
  } finally {
    api.call = originalCall;
    globalThis.Page = originalPage;
    globalThis.wx = originalWx;
    delete require.cache[file];
  }
});

test('the client refuses truncated campus results rather than publishing a partial total', () => {
  for (const action of ['campus.listPlaces', 'campus.getPlace', 'campus.supportResources']) {
    assert.throws(() => campusResult(action, { data: { items: [], truncated: true } }), {
      code: 'INVALID_RESPONSE',
    });
  }
});
