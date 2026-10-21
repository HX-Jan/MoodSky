const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const date = '2026-10-15';
const entry = (changes = {}) => ({
  id: 'synthetic_review_store_entry',
  date,
  weather: 'SUNNY',
  tags: [],
  text: 'SYNTHETIC original writing',
  version: 1,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  ...changes,
});
const response = (value) => ({ ok: true, data: { entry: value } });

test('malformed review events cannot delete, overwrite or publish changes for a valid record', () => {
  const original = entry();
  const store = createLocalStore([original], 3);
  let notices = 0;
  store.subscribe(() => {
    notices++;
  });
  for (const change of [
    { date, kind: 'failed', entry: null },
    { date },
    { date, kind: 'saved', entry: null },
    { date, kind: 'saved', entry: { date } },
    { date, kind: 'saved', entry: entry({ date: '2026-10-16' }) },
    { date, kind: 'saved', entry: entry({ weather: 'TYPHOON' }) },
    { date: '2026-02-30', kind: 'saved', entry: entry({ date: '2026-02-30' }) },
  ]) {
    assert.equal(store.applyChange(change), false);
    assert.deepEqual(store.listAll(), [original]);
    assert.equal(store.revision(), 3);
  }
  assert.equal(notices, 0);
});

test('review seeds and saved events validate full entries, unique dates and IDs without retaining extra fields', () => {
  const original = entry({ ownerId: 'SYNTHETIC internal field' });
  const store = createLocalStore([original]);
  assert.equal(store.getEntry(date).ownerId, undefined);
  for (const invalid of [
    [original, entry({ id: 'synthetic_other_id' })],
    [original, entry({ date: '2026-10-16' })],
    [entry({ date: '2026-02-30' })],
    [entry({ createdAt: '1' })],
    [entry({ weather: 'TYPHOON' })],
  ]) {
    assert.throws(() => createLocalStore(invalid));
  }
  assert.equal(
    store.applyChange({ date: '2026-10-16', kind: 'saved', entry: entry({ date: '2026-10-16' }) }),
    false,
  );
  const next = entry({
    date: '2026-10-16',
    id: 'synthetic_other_id',
    tags: ['REST'],
    ownerId: 'SYNTHETIC not in the view',
  });
  assert.equal(store.applyChange({ date: next.date, kind: 'saved', entry: next }), true);
  next.tags.push('STUDY');
  next.text = 'SYNTHETIC caller mutation';
  assert.deepEqual(store.getEntry(next.date).tags, ['REST']);
  assert.equal(store.getEntry(next.date).text, 'SYNTHETIC original writing');
  assert.equal(store.getEntry(next.date).ownerId, undefined);
  assert.equal(original.ownerId, 'SYNTHETIC internal field');
});

test('invalid review notifications cannot cancel a valid in-flight journal synchronization', async () => {
  const store = createLocalStore([entry()]);
  let release;
  const pending = store.syncFromJournal(
    {
      get: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    { date, kind: 'saved' },
  );
  const results = [];
  for (const service of [{}, { get: null }]) {
    try {
      results.push(await store.syncFromJournal(service, { date, kind: 'saved' }));
    } catch (error) {
      results.push(error);
    }
  }
  let reads = 0;
  const invalidDate = await store.syncFromJournal(
    {
      get: async () => {
        reads++;
        return response(null);
      },
    },
    { date: '2026-02-30', kind: 'saved' },
  );
  release(response(entry({ version: 2, text: 'SYNTHETIC current writing' })));
  const applied = await pending;
  assert.deepEqual(results, [false, false]);
  assert.equal(invalidDate, false);
  assert.equal(reads, 0);
  assert.equal(applied, true);
  assert.equal(store.getEntry(date).version, 2);
});

test('confirmed direct review changes invalidate older pending reads, including deletion of an already empty date', async () => {
  for (const mode of ['deleted-existing', 'deleted-empty', 'saved-newer']) {
    const store = createLocalStore(mode === 'deleted-empty' ? [] : [entry()], 3);
    let release;
    const pending = store.syncFromJournal(
      {
        get: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
      { date, kind: 'saved' },
    );
    const newer = entry({ version: 2, text: 'SYNTHETIC newer writing' });
    store.applyChange(
      mode === 'saved-newer' ? { date, kind: 'saved', entry: newer } : { date, kind: 'deleted' },
    );
    release(response(entry()));
    assert.equal(await pending, false, mode);
    assert.deepEqual(store.getEntry(date), mode === 'saved-newer' ? newer : null);
    assert.equal(store.revision(), mode === 'deleted-empty' ? 3 : 4);
  }
});
