const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviewReader } = require('../miniprogram/modules/review/reader');
const { createSessionState } = require('../miniprogram/services/session-state');
const { backendClient } = require('./helpers/backend-client');
const scopeA = 'scope_' + 'a'.repeat(64);
const scopeB = 'scope_' + 'b'.repeat(64);
const methods = [
  ['calendar', '2026-10'],
  ['monthArchive', '2026-10'],
  ['distribution', 7],
  ['timeline', 7],
];

test('a rejected response from the old account never raises the new account revision floor', async () => {
  const f = backendClient();
  await f.save();
  const stale = await f.review.monthArchive('2026-10');
  const state = createSessionState();
  state.accept(scopeA);
  let release;
  const reader = createReviewReader({
    sessionState: state,
    review: {
      ...f.review,
      monthArchive: () =>
        new Promise((resolve) => {
          release = () => resolve(stale);
        }),
    },
  });
  const pending = reader.monthArchive('2026-10');
  state.accept(scopeB);
  f.setActor('b');
  assert.equal((await reader.calendar('2026-10')).data.sourceRevision, 0);
  release();
  await assert.rejects(pending, { code: 'UNAUTHENTICATED' });
  assert.equal((await reader.timeline(7)).data.sourceRevision, 0);
});

for (const [method, input] of methods) {
  test(
    'same verified account refuses older ' + method + ' snapshot after a newer month read',
    async () => {
      const f = backendClient();
      await f.save({ weather: 'CUSTOM', weatherName: '合成已删除天气' });
      const stale = await f.review[method](input);
      await f.call('journal.delete', { date: '2026-10-18', expectedVersion: 1 });
      const state = createSessionState();
      state.accept(scopeA);
      let useStale = false;
      const reader = createReviewReader({
        sessionState: state,
        review: {
          ...f.review,
          [method]: (value) => (useStale ? Promise.resolve(stale) : f.review[method](value)),
        },
      });
      assert.equal((await reader.calendar('2026-11')).data.sourceRevision, 2);
      state.accept(scopeA); // Reconfirming the same binding must preserve the revision floor.
      useStale = true;
      await assert.rejects(reader[method](input), { code: 'CONFLICT' });
      useStale = false;
      assert.equal((await reader[method](input)).data.recordCount, 0);
    },
  );
}

test('concurrent old archive response cannot undo a newer insights snapshot', async () => {
  const f = backendClient();
  await f.save({ weather: 'CUSTOM', weatherName: '合成旧版本天气' });
  const old = await f.review.monthArchive('2026-10');
  const state = createSessionState();
  state.accept(scopeA);
  let release;
  const reader = createReviewReader({
    sessionState: state,
    review: {
      ...f.review,
      monthArchive: () =>
        new Promise((resolve) => {
          release = () => resolve(old);
        }),
    },
  });
  const pending = reader.monthArchive('2026-10');
  await f.save({ weather: 'SUNNY', expectedVersion: 1 });
  assert.equal((await reader.insights(7)).timeline.data.sourceRevision, 2);
  release();
  await assert.rejects(pending, { code: 'CONFLICT' });
});

test('equal revisions permit different months and windows without extra cloud reads', async () => {
  const f = backendClient();
  await f.save();
  const state = createSessionState();
  state.accept(scopeA);
  const reader = createReviewReader({ sessionState: state, review: f.review });
  const before = f.requests.length;
  for (const [method, input] of methods) {
    assert.equal((await reader[method](input)).data.sourceRevision, 1);
  }
  assert.equal((await reader.calendar('2026-09')).data.recordCount, 0);
  assert.equal((await reader.insights(90)).timeline.data.recordCount, 1);
  assert.equal(f.requests.length - before, 6);
});

test('revision floor belongs to verified binding, not another account or an unbound demo', async () => {
  const f = backendClient();
  await f.save();
  await f.save({ expectedVersion: 1, weather: 'TYPHOON' });
  const state = createSessionState();
  state.accept(scopeA);
  const reader = createReviewReader({ sessionState: state, review: f.review });
  assert.equal((await reader.timeline(7)).data.sourceRevision, 2);
  state.accept(scopeB);
  f.setActor('b');
  assert.equal((await reader.calendar('2026-10')).data.sourceRevision, 0);
  assert.equal((await reader.insights(30)).timeline.data.recordCount, 0);
  state.clear();
  f.setActor('a');
  assert.equal((await reader.calendar('2026-10')).data.sourceRevision, 2);
  f.setActor('b');
  assert.equal((await reader.calendar('2026-10')).data.sourceRevision, 0);
});

test('first authentication establishes the floor and malformed high revisions never poison it', async () => {
  const f = backendClient();
  await f.save();
  const stale = await f.review.calendar('2026-10');
  await f.save({ expectedVersion: 1 });
  const state = createSessionState();
  let mode = 'first';
  const reader = createReviewReader({
    sessionState: state,
    review: {
      ...f.review,
      async calendar(month) {
        if (mode === 'first') {
          state.accept(scopeA);
        }
        if (mode === 'stale') {
          return stale;
        }
        const response = await f.review.calendar(month);
        if (mode === 'malformed') {
          return {
            ...response,
            data: { ...response.data, sourceRevision: Number.MAX_SAFE_INTEGER, recordCount: -1 },
          };
        }
        return response;
      },
    },
  });
  assert.equal((await reader.calendar('2026-10')).data.sourceRevision, 2);
  mode = 'stale';
  await assert.rejects(reader.calendar('2026-10'), { code: 'CONFLICT' });
  mode = 'malformed';
  await assert.rejects(reader.calendar('2026-10'), { code: 'INVALID_RESPONSE' });
  mode = 'valid';
  assert.equal((await reader.calendar('2026-10')).data.sourceRevision, 2);
});
