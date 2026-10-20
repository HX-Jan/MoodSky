const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
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
  assert.equal((await service.submit(removal)).data.deleted, true);
  assert.equal((await service.get(date)).data.entry.id, next.data.entry.id);
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
});
test('clearing the demo drops in-memory records and leaves later operations with a fresh empty state', async () => {
  const service = createMemoryJournalService({ now });
  await service.submit(service.createSaveRequest(input()));
  service.clear();
  assert.equal((await service.get(date)).data.entry, null);
  assert.equal((await service.submit(service.createSaveRequest(input()))).data.entry.version, 1);
});
