const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, error } = require('./helpers/backend-fixture');

test('rejected create binds its request ID even after delete makes the original input valid', async () => {
  const f = fixture();
  await f.save();
  const id = 'req_rejected_create';
  error(await f.save({}, { id }), 'CONFLICT');
  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 1 });
  error(await f.save({}, { id }), 'CONFLICT');
  error(await f.save({ weather: 'RAINY' }, { id }), 'CONFLICT');
  assert.equal((await f.call('journal.get', { date: '2026-10-18' })).data.entry, null);
  assert.equal(f.repository.inspect('synthetic_a').revision, 2);
  assert.equal((await f.save()).data.entry.version, 3); // A genuinely new request may recreate.
});

test('rejected future-date input replays its rejection after China midnight and cannot change input', async () => {
  const f = fixture();
  f.setClock('2026-10-18T15:59:00.000Z');
  const options = { id: 'req_rejected_future' };
  const original = await f.save({ date: '2026-10-19', text: 'SYNTHETIC private' }, options);
  error(original, 'INVALID_INPUT');
  error(await f.save({ text: 'SYNTHETIC private' }, options), 'CONFLICT');
  f.setClock('2026-10-18T16:00:00.000Z');
  assert.deepEqual(
    await f.save({ date: '2026-10-19', text: 'SYNTHETIC private' }, options),
    original,
  );
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
  assert.equal((await f.save({ date: '2026-10-19' })).ok, true);
});

test('stale edits and deletes record only safe rejection metadata without changing sources', async () => {
  const f = fixture();
  await f.save({ text: 'SYNTHETIC original' });
  for (const [action, payload, id] of [
    [
      'journal.upsert',
      { date: '2026-10-18', weather: 'RAINY', expectedVersion: 2, text: 'SYNTHETIC refused' },
      'req_reject_edit',
    ],
    ['journal.delete', { date: '2026-10-18', expectedVersion: 2 }, 'req_reject_delete'],
  ]) {
    error(await f.call(action, payload, { id }), 'CONFLICT');
    error(await f.call(action, payload, { id }), 'CONFLICT');
    const receipt = f.repository.inspect('synthetic_a').receipts[action + ':' + id];
    assert.equal(receipt.state, 'rejected');
    assert.equal(receipt.code, 'CONFLICT');
    assert.doesNotMatch(JSON.stringify(receipt), /SYNTHETIC|RAINY|text|tags|payload/);
  }
  const state = f.repository.inspect('synthetic_a');
  assert.equal(state.revision, 1);
  assert.equal(state.exportEpoch, 1);
  assert.equal(state.operationFence, 5);
  assert.equal(state.days['2026-10-18'].entry.text, 'SYNTHETIC original');
});

test('expired rejected receipts remain occupied rather than allowing a late retry', async () => {
  const f = fixture();
  const options = { id: 'req_rejected_expired' };
  error(await f.save({ date: '2026-10-19' }, options), 'INVALID_INPUT');
  f.setClock('2026-10-18T17:00:00.000Z');
  error(await f.save({ date: '2026-10-19' }, options), 'CONFLICT');
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
});

test('input and identity failures do not reserve a business receipt', async () => {
  const f = fixture();
  error(await f.save({ weather: 'UNKNOWN' }, { id: 'req_invalid_input' }), 'INVALID_INPUT');
  error(await f.save({}, { id: 'req_invalid_identity', actor: 'disabled' }), 'ACCOUNT_DISABLED');
  assert.deepEqual(f.repository.inspect('synthetic_a'), { days: {}, receipts: {}, revision: 0 });
});
