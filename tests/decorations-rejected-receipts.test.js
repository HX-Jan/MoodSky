const test = require('node:test');
const assert = require('node:assert/strict');
const { createDecorationService } = require('../cloudfunctions/moodsky/services/decorations');
const { createJournalService } = require('../cloudfunctions/moodsky/services/journal');
const { createMemoryJournalRepository } = require('./helpers/memory-journal-repository');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const {
  createCloudJournalRepository,
  LAYOUT,
  receiptId,
  decorationId,
} = require('../tools/journal-storage/cloudbase-candidate');
const ownerId = 'synthetic_decoration_rejection_owner';
const actor = { accountId: ownerId };
const catalogue = { stickers: ['synthetic_sticker'], backgrounds: ['synthetic_background'] };
const replace = {
  operation: 'replace',
  month: '2026-10',
  expectedVersion: 0,
  stickers: [],
  backgroundId: null,
};
const seed = {
  ['accounts:' + ownerId]: {
    _id: ownerId,
    status: 'active',
    journalLayout: LAYOUT,
    journalRevision: 0,
    operationFence: 0,
    exportEpoch: 0,
  },
};
function fixture(repository = createMemoryJournalRepository()) {
  let clock = new Date('2026-10-18T00:00:00.000Z');
  let serial = 0;
  const options = { repository, receiptPolicy: createSyntheticReceiptPolicy(), now: () => clock };
  const service = createDecorationService({ ...options, catalogue });
  const journal = createJournalService({ ...options, createId: () => 'synthetic_future_target' });
  return {
    repository,
    decorate: (payload, requestId = 'req_decoration_rejection_' + ++serial) =>
      service({ payload, actor, requestId }),
    createTarget: () =>
      journal({
        action: 'journal.upsert',
        actor,
        requestId: 'req_decoration_target_create',
        payload: {
          date: '2026-10-18',
          weather: 'SUNNY',
          text: 'SYNTHETIC private target body',
          expectedVersion: 0,
        },
      }),
    setClock: (value) => {
      clock = new Date(value);
    },
  };
}

test('rejected decoration version cannot execute later or accept a changed input with the same request ID', async () => {
  const f = fixture();
  const id = 'req_decoration_rejected_version';
  const stale = { ...replace, expectedVersion: 1 };
  await assert.rejects(f.decorate(stale, id), { code: 'CONFLICT' });
  await f.decorate(replace);
  await assert.rejects(f.decorate(stale, id), { code: 'CONFLICT' });
  await assert.rejects(f.decorate({ ...stale, backgroundId: 'synthetic_background' }, id), {
    code: 'CONFLICT',
  });
  const state = f.repository.inspect(ownerId);
  assert.equal(state.decorations['2026-10'].version, 1);
  assert.equal(state.exportEpoch, 1);
  assert.equal(state.revision, 0);
  assert.equal((await f.decorate(stale)).version, 2);
});

test('rejected missing decoration target stays rejected after that journal is created', async () => {
  const f = fixture();
  const payload = {
    ...replace,
    stickers: [{ stickerId: 'synthetic_sticker', targetEntryId: 'synthetic_future_target' }],
  };
  const id = 'req_decoration_rejected_target';
  await assert.rejects(f.decorate(payload, id), { code: 'INVALID_INPUT' });
  await f.createTarget();
  await assert.rejects(f.decorate(payload, id), { code: 'INVALID_INPUT' });
  assert.equal(f.repository.inspect(ownerId).decorations, undefined);
  const receipt = f.repository.inspect(ownerId).receipts['review.decorations:' + id];
  assert.equal(receipt.state, 'rejected');
  assert.equal(receipt.month, '2026-10');
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /private target body|future_target|stickers|payload/,
  );
  assert.equal((await f.decorate(payload)).version, 1);
});

test('expired rejected decoration requests remain occupied and do not become new writes', async () => {
  const f = fixture();
  const id = 'req_decoration_rejected_expired';
  const payload = {
    ...replace,
    stickers: [{ stickerId: 'synthetic_sticker', targetEntryId: 'synthetic_future_target' }],
  };
  await assert.rejects(f.decorate(payload, id), { code: 'INVALID_INPUT' });
  await f.createTarget();
  f.setClock('2026-10-18T01:00:00.000Z');
  await assert.rejects(f.decorate(payload, id), { code: 'CONFLICT' });
  assert.equal(f.repository.inspect(ownerId).decorations, undefined);
});

test('failed decoration rejection persistence rolls back its account fence and does not reserve the ID', async () => {
  const repository = createMemoryJournalRepository();
  let armed = true;
  const f = fixture({
    ...repository,
    transact: (id, work) =>
      repository.transact(id, (tx) =>
        work({
          ...tx,
          setReceipt: async (...args) => {
            if (armed) {
              throw Error('SYNTHETIC rejection write failure');
            }
            return tx.setReceipt(...args);
          },
        }),
      ),
  });
  await assert.rejects(
    f.decorate({ ...replace, expectedVersion: 1 }, 'req_decoration_failed_rejection'),
    /SYNTHETIC/,
  );
  assert.deepEqual(repository.inspect(ownerId), { days: {}, receipts: {}, revision: 0 });
  armed = false;
  assert.equal((await f.decorate(replace, 'req_decoration_failed_rejection')).version, 1);
});

test('locked SDK persists decoration rejection metadata without advancing sources or accepting later input', async () => {
  await withOfflineWxDatabase(seed, async ({ db, inspect }) => {
    const f = fixture(createCloudJournalRepository(db));
    const id = 'req_sdk_decoration_rejected';
    const stale = { ...replace, expectedVersion: 1 };
    await assert.rejects(f.decorate(stale, id), { code: 'CONFLICT' });
    const first = inspect();
    const receipt = first['request_receipts:' + receiptId(ownerId, 'review.decorations', id)];
    assert.equal(receipt.state, 'rejected');
    assert.equal(receipt.code, 'CONFLICT');
    assert.equal(receipt.month, '2026-10');
    assert.equal(first['accounts:' + ownerId].operationFence, 1);
    assert.equal(first['accounts:' + ownerId].exportEpoch, 0);
    assert.equal(first['accounts:' + ownerId].journalRevision, 0);
    assert.equal(first['month_decorations:' + decorationId(ownerId, '2026-10')], undefined);
    await f.decorate(replace);
    await assert.rejects(f.decorate(stale, id), { code: 'CONFLICT' });
    assert.equal(inspect()['month_decorations:' + decorationId(ownerId, '2026-10')].version, 1);
    assert.equal(inspect()['accounts:' + ownerId].exportEpoch, 1);
  });
});

test('locked SDK rolls back a failed decoration rejection write and retries the original request', async () => {
  let armed = true;
  await withOfflineWxDatabase(
    seed,
    async ({ db, inspect }) => {
      const f = fixture(createCloudJournalRepository(db));
      const id = 'req_sdk_decoration_rejected_failure';
      const payload = { ...replace, expectedVersion: 1 };
      await assert.rejects(f.decorate(payload, id));
      assert.deepEqual(inspect(), seed);
      armed = false;
      await assert.rejects(f.decorate(payload, id), { code: 'CONFLICT' });
      assert.equal(inspect()['accounts:' + ownerId].operationFence, 1);
      assert.equal(
        inspect()['request_receipts:' + receiptId(ownerId, 'review.decorations', id)].state,
        'rejected',
      );
    },
    {
      fail: (action, params) =>
        armed &&
        action === 'database.modifyDocument' &&
        params.collectionName === 'request_receipts'
          ? 'SYNTHETIC_RECEIPT_FAILURE'
          : null,
    },
  );
});

test('locked SDK rejects corrupted decoration rejection metadata and disabled-account replays', async () => {
  const id = 'req_sdk_decoration_rejected_corrupt';
  const payload = { ...replace, expectedVersion: 1 };
  const row = {
    layout: LAYOUT,
    ownerId,
    action: 'review.decorations',
    requestId: id,
    ...createSyntheticReceiptPolicy().bind(
      'review.decorations',
      payload,
      new Date('2026-10-18T00:00:00.000Z'),
    ).stamp,
    state: 'rejected',
    code: 'CONFLICT',
    version: 0,
    month: '2026-10',
  };
  const key = 'request_receipts:' + receiptId(ownerId, 'review.decorations', id);
  for (const changes of [
    { code: 'INTERNAL_ERROR' },
    { month: undefined },
    { month: '2026-13' },
    { month: '2026-09' },
    { stickers: [] },
    { payload: 'SYNTHETIC private body must not be stored' },
    { ownerId: 'synthetic_other_owner' },
  ]) {
    await withOfflineWxDatabase(
      { ...seed, [key]: { ...row, ...changes } },
      async ({ db, inspect }) => {
        const f = fixture(createCloudJournalRepository(db));
        await assert.rejects(f.decorate(payload, id), /Invalid/);
        assert.equal(inspect()['accounts:' + ownerId].operationFence, 0);
      },
    );
  }
  await withOfflineWxDatabase(
    {
      ...seed,
      ['accounts:' + ownerId]: { ...seed['accounts:' + ownerId], status: 'disabled' },
      [key]: row,
    },
    async ({ db, inspect }) => {
      await assert.rejects(fixture(createCloudJournalRepository(db)).decorate(payload, id), {
        code: 'ACCOUNT_DISABLED',
      });
      assert.equal(inspect()['accounts:' + ownerId].operationFence, 0);
    },
  );
});
