const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { fixture: backendFixture } = require('./helpers/backend-fixture');
const now = () => new Date('2026-10-15T04:00:00.000Z');
const date = '2026-10-15';
const input = (expectedVersion = 0, text = '') => ({
  date,
  weather: 'SUNNY',
  tags: [],
  text,
  expectedVersion,
});
test('the explicit memory fixture can save, read and edit without exposing mutable internal records', async () => {
  const service = createMemoryJournalService({ now });
  const created = await service.submit(service.createSaveRequest(input()));
  created.data.entry.tags.push('REST');
  assert.deepEqual((await service.get(date)).data.entry.tags, []);
  const edited = await service.submit(service.createSaveRequest(input(1, '合成编辑')));
  assert.equal(edited.data.entry.id, created.data.entry.id);
  assert.equal(edited.data.entry.version, 2);
});
test('memory replay checks original input and cannot replay a save after deletion or editing', async () => {
  const service = createMemoryJournalService({ now });
  const request = service.createSaveRequest(input());
  await service.submit(request);
  assert.equal((await service.submit(request)).data.entry.version, 1);
  await assert.rejects(
    service.submit({ ...request, payload: { ...request.payload, text: '合成不同输入' } }),
    { code: 'CONFLICT' },
  );
  await service.submit(service.createSaveRequest(input(1, '合成后续编辑')));
  await assert.rejects(service.submit(request), { code: 'CONFLICT' });
});
test('memory deletion retains version generations and replay does not delete a later entry', async () => {
  const service = createMemoryJournalService({ now });
  const first = await service.submit(service.createSaveRequest(input()));
  const removal = service.createDeleteRequest({ date, expectedVersion: 1 });
  await service.submit(removal);
  assert.equal((await service.get(date)).data.entry, null);
  const next = await service.submit(service.createSaveRequest(input()));
  assert.equal(next.data.entry.version, 3);
  assert.notEqual(next.data.entry.id, first.data.entry.id);
  await assert.rejects(service.submit(removal), { code: 'CONFLICT' });
  assert.equal((await service.get(date)).data.entry.id, next.data.entry.id);
});

test('empty-delete replay after a later create reports conflict and keeps the new record', async () => {
  const service = createMemoryJournalService({ now });
  const removal = service.createDeleteRequest({ date, expectedVersion: 1 });
  assert.equal((await service.submit(removal)).data.deleted, false);
  assert.equal((await service.submit(removal)).data.deleted, false);
  const saved = await service.submit(service.createSaveRequest(input()));
  await assert.rejects(service.submit(removal), { code: 'CONFLICT' });
  assert.deepEqual((await service.get(date)).data.entry, saved.data.entry);
});

test('an original delete whose response was lost replays only until the date is recreated', async () => {
  const service = createMemoryJournalService({ now });
  await service.submit(service.createSaveRequest(input()));
  const removal = service.createDeleteRequest({ date, expectedVersion: 1 });
  service.failNext('after-save');
  await assert.rejects(service.submit(removal), { code: 'NETWORK_ERROR' });
  assert.equal((await service.submit(removal)).data.deleted, true);
  await service.submit(service.createSaveRequest(input()));
  await assert.rejects(service.submit(removal), { code: 'CONFLICT' });
  assert.equal((await service.get(date)).data.entry.version, 3);
});
test('synthetic response loss can be recovered with the original request without another increment', async () => {
  const service = createMemoryJournalService({ now });
  const request = service.createSaveRequest(input());
  service.failNext('after-save');
  await assert.rejects(service.submit(request), { code: 'NETWORK_ERROR' });
  assert.equal((await service.get(date)).data.entry.version, 1);
  assert.equal((await service.submit(request)).data.entry.version, 1);
});
test('the fixture rejects invalid delete controls, caller identity and out-of-window creation', async () => {
  const service = createMemoryJournalService({ now });
  await assert.rejects(service.submit(service.createDeleteRequest({ date, expectedVersion: 0 })), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(
    service.submit(service.createDeleteRequest({ date, expectedVersion: 1, uid: 'synthetic' })),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(() => service.createSaveRequest({ ...input(), ownerId: 'synthetic' }), {
    code: 'INVALID_REQUEST',
  });
  await assert.rejects(
    service.submit(service.createSaveRequest({ ...input(), date: '2026-09-15' })),
    { code: 'INVALID_INPUT' },
  );
  await assert.rejects(
    service.submit(service.createSaveRequest(input(Number.MAX_SAFE_INTEGER + 1))),
    { code: 'INVALID_INPUT' },
  );
  const last = {
    id: 'synthetic_last_generation',
    ...input(Number.MAX_SAFE_INTEGER),
    version: Number.MAX_SAFE_INTEGER,
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
  };
  delete last.expectedVersion;
  const limited = createMemoryJournalService({ now, seedEntries: [last] });
  await assert.rejects(limited.submit(limited.createSaveRequest(input(Number.MAX_SAFE_INTEGER))), {
    code: 'CONFLICT',
  });
  await assert.rejects(
    limited.submit(limited.createDeleteRequest({ date, expectedVersion: Number.MAX_SAFE_INTEGER })),
    { code: 'CONFLICT' },
  );
  assert.equal((await limited.get(date)).data.entry.version, Number.MAX_SAFE_INTEGER);
});
test('clearing the demo drops in-memory records and leaves later operations with a fresh empty state', async () => {
  const service = createMemoryJournalService({ now });
  await service.submit(service.createSaveRequest(input()));
  service.clear();
  assert.equal((await service.get(date)).data.entry, null);
  assert.equal((await service.submit(service.createSaveRequest(input()))).data.entry.version, 1);
});

test('memory request bindings cannot be altered through a mutable caller request after success', async () => {
  const service = createMemoryJournalService({ now });
  const request = JSON.parse(
    JSON.stringify(service.createSaveRequest(input(0, 'SYNTHETIC original input'))),
  );
  await service.submit(request);
  request.payload.text = 'SYNTHETIC mutated caller object';
  await assert.rejects(service.submit(request), { code: 'CONFLICT' });
  request.payload.text = 'SYNTHETIC original input';
  request.payload.tags.push('REST');
  await assert.rejects(service.submit(request), { code: 'CONFLICT' });
  assert.equal((await service.get(date)).data.entry.text, 'SYNTHETIC original input');
  assert.deepEqual((await service.get(date)).data.entry.tags, []);
  const removal = JSON.parse(
    JSON.stringify(service.createDeleteRequest({ date, expectedVersion: 1 })),
  );
  await service.submit(removal);
  removal.payload.expectedVersion = 7;
  await assert.rejects(service.submit(removal), { code: 'CONFLICT' });
  assert.equal((await service.get(date)).data.entry, null);
});

test('memory bindings ignore JSON object key order while preserving raw optional fields and array order', async () => {
  const service = createMemoryJournalService({ now });
  const request = service.createSaveRequest({ date, weather: 'SUNNY', expectedVersion: 0 });
  const first = await service.submit(request);
  const reordered = {
    ...request,
    payload: Object.fromEntries(Object.entries(request.payload).reverse()),
  };
  assert.deepEqual(await service.submit(reordered), first);
  await assert.rejects(
    service.submit({ ...request, payload: { ...request.payload, tags: [], text: '' } }),
    { code: 'CONFLICT' },
  );
  const second = createMemoryJournalService({ now });
  const tagged = second.createSaveRequest({
    ...input(),
    tags: ['REST', 'STUDY'],
    text: 'caf\u00e9',
  });
  await second.submit(tagged);
  for (const change of [
    { tags: ['STUDY', 'REST'] },
    { text: 'cafe\u0301' },
    { text: 'caf\u00e9 ' },
  ]) {
    await assert.rejects(second.submit({ ...tagged, payload: { ...tagged.payload, ...change } }), {
      code: 'CONFLICT',
    });
  }
});

test('memory seed validation keeps entry IDs unique and does not reuse a seed ID for a new date', async () => {
  const seed = {
    id: 'demo_entry_1',
    date: '2026-10-14',
    weather: 'SUNNY',
    tags: [],
    text: '',
    version: 1,
    createdAt: '2026-10-14T04:00:00.000Z',
    updatedAt: '2026-10-14T04:00:00.000Z',
    ownerId: 'SYNTHETIC not a public field',
  };
  const service = createMemoryJournalService({ now, seedEntries: [seed] });
  const saved = await service.submit(service.createSaveRequest(input()));
  assert.notEqual(saved.data.entry.id, seed.id);
  assert.equal((await service.get(seed.date)).data.entry.ownerId, undefined);
  const issued = new Set([seed.id, saved.data.entry.id]);
  for (let round = 0; round < 50; round++) {
    service.clear();
    const next = await service.submit(service.createSaveRequest(input()));
    assert.equal(issued.has(next.data.entry.id), false, 'clear must not reuse an earlier ID');
    issued.add(next.data.entry.id);
  }
  assert.throws(() => createMemoryJournalService({ now, seedEntries: [seed, { ...seed, date }] }), {
    code: 'INVALID_INPUT',
  });
  assert.throws(
    () => createMemoryJournalService({ now, seedEntries: [{ ...seed, createdAt: '1' }] }),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(
    () => createMemoryJournalService({ now, seedEntries: [{ ...seed, id: undefined }] }),
    { code: 'INVALID_INPUT' },
  );
  assert.equal(seed.ownerId, 'SYNTHETIC not a public field');
});

test('memory journal and transactional backend agree across retries, rejected writes and date rollover', async () => {
  let clock = new Date('2026-10-18T15:59:00.000Z');
  const backend = backendFixture();
  backend.setClock(clock.toISOString());
  const service = createMemoryJournalService({ now: () => clock });
  const ids = [new Map(), new Map()];
  function view(response, side) {
    if (!response.ok) {
      return { ok: false, code: response.error.code };
    }
    if (!Object.hasOwn(response.data, 'entry')) {
      return { ok: true, data: response.data };
    }
    const entry = response.data.entry;
    if (!entry) {
      return { ok: true, data: { entry: null } };
    }
    if (!ids[side].has(entry.id)) {
      ids[side].set(entry.id, ids[side].size + 1);
    }
    return { ok: true, data: { entry: { ...entry, id: ids[side].get(entry.id) } } };
  }
  async function run(request) {
    const expected = await backend.router(request, { OPENID: 'a' });
    let actual;
    try {
      actual = await service.submit(request);
    } catch (error) {
      actual = { ok: false, error: { code: error.code } };
    }
    assert.deepEqual(view(actual, 0), view(expected, 1), request.requestId);
    for (const selected of ['2026-10-18', '2026-10-19']) {
      assert.deepEqual(
        view(await service.get(selected), 0),
        view(await backend.call('journal.get', { date: selected }), 1),
      );
    }
  }
  const create = service.createSaveRequest({
    date: '2026-10-18',
    weather: 'SUNNY',
    expectedVersion: 0,
  });
  await run(create);
  await run({ ...create, payload: Object.fromEntries(Object.entries(create.payload).reverse()) });
  const rejected = service.createSaveRequest({
    date: '2026-10-18',
    weather: 'RAINY',
    expectedVersion: 5,
  });
  await run(rejected);
  const removal = service.createDeleteRequest({ date: '2026-10-18', expectedVersion: 1 });
  await run(removal);
  const emptyDelete = service.createDeleteRequest({ date: '2026-10-18', expectedVersion: 1 });
  await run(emptyDelete);
  await run(service.createSaveRequest({ ...create.payload, text: 'SYNTHETIC recreated' }));
  await run(removal);
  await run(emptyDelete);
  await run(create);
  for (const version of [3, 4]) {
    await run(
      service.createSaveRequest({
        date: '2026-10-18',
        weather: 'CLOUDY',
        text: 'SYNTHETIC edit',
        expectedVersion: version,
      }),
    );
  }
  await run(rejected);
  await run({
    ...rejected,
    payload: { ...rejected.payload, text: 'SYNTHETIC cannot change input' },
  });
  const future = service.createSaveRequest({
    date: '2026-10-19',
    weather: 'SUNNY',
    expectedVersion: 0,
  });
  await run(future);
  clock = new Date('2026-10-18T16:00:00.000Z');
  backend.setClock(clock.toISOString());
  await run(future);
  await run(service.createSaveRequest(future.payload));
});
