const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createDecorationService } = require('../cloudfunctions/moodsky/services/decorations');
const { fixture, error } = require('./helpers/backend-fixture');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const catalogue = {
  stickers: [
    'synthetic_s1',
    'synthetic_s2',
    'synthetic_s3',
    'synthetic_s4',
    'synthetic_s5',
    'synthetic_s6',
  ],
  backgrounds: ['synthetic_b1', 'synthetic_b2'],
};
function decorated({ repository, assets = catalogue } = {}) {
  const f = fixture();
  const store = repository || f.repository;
  let serial = 0;
  const router = createRouter({
    journalRepository: store,
    journalReceiptPolicy: createSyntheticReceiptPolicy(),
    decorationCatalogue: assets,
    now: () => new Date('2026-10-18T00:00:00Z'),
    resolveAccount: async (openid) => ({
      id: openid === 'b' ? 'synthetic_b' : 'synthetic_a',
      status: openid === 'disabled' ? 'disabled' : 'active',
    }),
  });
  return {
    ...f,
    repository: store,
    decorate: (payload, { requestId = 'req_decor_' + ++serial, actor = 'a' } = {}) =>
      router(
        { apiVersion: '1', requestId, action: 'review.decorations', payload },
        { OPENID: actor },
      ),
  };
}
const get = { operation: 'get', month: '2026-10' };
const replace = {
  operation: 'replace',
  month: '2026-10',
  expectedVersion: 0,
  stickers: [{ stickerId: 'synthetic_s1' }],
  backgroundId: 'synthetic_b1',
};

test('backend decorations require explicit server catalogue and preserve empty get/reset semantics', async () => {
  const base = fixture();
  error(await base.call('review.decorations', get), 'NOT_IMPLEMENTED');
  const f = decorated();
  const empty = { month: '2026-10', version: 0, stickers: [], backgroundId: null };
  assert.deepEqual((await f.decorate(get)).data, empty);
  assert.deepEqual(f.repository.inspect('synthetic_a'), { days: {}, receipts: {}, revision: 0 });
  const options = { requestId: 'req_decor_reset_empty' };
  const payload = { operation: 'reset', month: '2026-10', expectedVersion: 0 };
  assert.deepEqual((await f.decorate(payload, options)).data, empty);
  assert.deepEqual((await f.decorate(payload, options)).data, empty);
  assert.equal(f.repository.inspect('synthetic_a').decorations, undefined);
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
});

test('backend decorations accept six approved placements and two approved backgrounds without journal writes', async () => {
  const f = decorated();
  const payload = {
    ...replace,
    stickers: catalogue.stickers.map((stickerId) => ({ stickerId })),
    backgroundId: 'synthetic_b2',
  };
  const options = { requestId: 'req_decor_six' };
  const saved = await f.decorate(payload, options);
  assert.equal(saved.ok, true);
  assert.equal(saved.data.version, 1);
  assert.equal(saved.data.stickers.length, 6);
  assert.deepEqual(await f.decorate(payload, options), saved);
  assert.deepEqual((await f.decorate(get)).data, saved.data);
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
  error(await f.decorate({ ...payload, backgroundId: 'synthetic_b1' }, options), 'CONFLICT');
  assert.equal((await f.decorate(get, { actor: 'b' })).data.version, 0);
  error(await f.decorate(get, { actor: 'disabled' }), 'ACCOUNT_DISABLED');
});

test('backend decoration targets belong to the current account and month and disappear after deletion', async () => {
  const f = decorated();
  const saved = await f.save({ text: 'SYNTHETIC private target' });
  const other = await f.save({}, { actor: 'b' });
  const payload = {
    ...replace,
    stickers: [
      { stickerId: 'synthetic_s1', targetEntryId: saved.data.entry.id },
      { stickerId: 'synthetic_s2' },
    ],
  };
  assert.equal((await f.decorate(payload, { requestId: 'req_decor_bound' })).ok, true);
  error(
    await f.decorate({
      ...replace,
      expectedVersion: 1,
      stickers: [{ stickerId: 'synthetic_s1', targetEntryId: other.data.entry.id }],
    }),
    'INVALID_INPUT',
  );
  error(
    await f.decorate({
      ...replace,
      month: '2026-09',
      stickers: [{ stickerId: 'synthetic_s1', targetEntryId: saved.data.entry.id }],
    }),
    'INVALID_INPUT',
  );
  await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 1 });
  const read = await f.decorate(get);
  assert.deepEqual(read.data.stickers, [{ stickerId: 'synthetic_s2' }]);
  const replay = await f.decorate(payload, { requestId: 'req_decor_bound' });
  assert.deepEqual(replay.data.stickers, read.data.stickers);
  await f.save({ text: 'SYNTHETIC recreated' });
  assert.deepEqual((await f.decorate(get)).data.stickers, read.data.stickers);
  assert.doesNotMatch(
    JSON.stringify(f.repository.inspect('synthetic_a').decorations),
    /private target|recreated|weather|text/,
  );
});

test('backend decorations reject forged assets, invalid targets, duplicate placements and unknown fields', async () => {
  const f = decorated();
  for (const payload of [
    { ...replace, month: '2026-13' },
    { ...replace, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...replace, backgroundId: 'unapproved' },
    { ...replace, stickers: [{ stickerId: 'unapproved' }] },
    { ...replace, stickers: Array(7).fill({ stickerId: 'synthetic_s1' }) },
    { ...replace, stickers: [{ stickerId: 'synthetic_s1' }, { stickerId: 'synthetic_s1' }] },
    { ...replace, stickers: [{ stickerId: 'synthetic_s1', targetEntryId: '' }] },
    { ...replace, stickers: [{ stickerId: 'synthetic_s1', text: 'SYNTHETIC unexpected' }] },
    { ...replace, stickers: [{ stickerId: 'synthetic_s1', targetEntryId: 'synthetic_missing' }] },
    { ...get, expectedVersion: 0 },
    { ...get, operation: 'constructor' },
  ]) {
    error(await f.decorate(payload), 'INVALID_INPUT');
  }
  error(await f.decorate({ ...replace, ownerId: 'synthetic_b' }), 'INVALID_REQUEST');
  assert.equal(f.repository.inspect('synthetic_a').decorations, undefined);
});

test('backend decoration concurrent updates have one winner, while identical retries commit once', async () => {
  const f = decorated();
  const results = await Promise.all(Array.from({ length: 16 }, () => f.decorate(replace)));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.ok(
    results.filter((result) => !result.ok).every((result) => result.error.code === 'CONFLICT'),
  );
  const payload = { ...replace, expectedVersion: 1, backgroundId: null };
  const replies = await Promise.all(
    Array.from({ length: 16 }, () => f.decorate(payload, { requestId: 'req_decor_same' })),
  );
  for (const reply of replies) {
    assert.deepEqual(reply, replies[0]);
  }
  assert.equal((await f.decorate(get)).data.version, 2);
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
});

test('backend decoration reset is versioned and stale reset retries cannot erase a newer config', async () => {
  const f = decorated();
  await f.decorate(replace);
  const reset = { operation: 'reset', month: '2026-10', expectedVersion: 1 };
  const options = { requestId: 'req_decor_reset' };
  const cleared = await f.decorate(reset, options);
  assert.deepEqual(cleared.data, {
    month: '2026-10',
    version: 2,
    stickers: [],
    backgroundId: null,
  });
  assert.deepEqual(await f.decorate(reset, options), cleared);
  await f.decorate({ ...replace, expectedVersion: 2 });
  error(await f.decorate(reset, options), 'CONFLICT');
  assert.equal((await f.decorate(get)).data.version, 3);
});

test('backend decorations hide withdrawn catalogue assets without silently changing stored versions', async () => {
  const f = decorated();
  await f.decorate(replace);
  const restricted = decorated({
    repository: f.repository,
    assets: { stickers: [], backgrounds: [] },
  });
  const result = await restricted.decorate(get);
  assert.deepEqual(result.data, { month: '2026-10', version: 1, stickers: [], backgroundId: null });
  assert.equal(f.repository.inspect('synthetic_a').decorations['2026-10'].stickers.length, 1);
  assert.throws(
    () =>
      createDecorationService({
        repository: f.repository,
        catalogue: { stickers: ['duplicate', 'duplicate'], backgrounds: [] },
      }),
    TypeError,
  );
});

test('backend decoration transaction rollback removes a partial update if receipt storage fails', async () => {
  const base = fixture();
  const repository = {
    ...base.repository,
    transact: (ownerId, work) =>
      base.repository.transact(ownerId, (tx) =>
        work({
          ...tx,
          setReceipt: async () => {
            throw new Error('SYNTHETIC private failure');
          },
        }),
      ),
  };
  const f = decorated({ repository });
  error(await f.decorate(replace), 'INTERNAL_ERROR');
  assert.deepEqual(base.repository.inspect('synthetic_a'), { days: {}, receipts: {}, revision: 0 });
});
