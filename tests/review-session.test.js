const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createReviewReader } = require('../miniprogram/modules/review/reader');
const { backendClient } = require('./helpers/backend-client');
const a = 'scope_' + 'a'.repeat(64);
const b = 'scope_' + 'b'.repeat(64);

for (const [method, input, source] of [
  ['calendar', '2026-10', 'review'],
  ['monthArchive', '2026-10', 'review'],
  ['distribution', 7, 'review'],
  ['timeline', 7, 'review'],
  ['getEntry', '2026-10-18', 'journal'],
]) {
  test(
    'review reader rejects late ' + method + ' after binding replacement, including A-B-A',
    async () => {
      const f = backendClient();
      await f.save();
      for (const switchBack of [false, true]) {
        const state = createSessionState();
        state.accept(a);
        let release;
        const serviceMethod = source === 'journal' ? 'get' : method;
        const reader = createReviewReader({
          sessionState: state,
          [source]: {
            [serviceMethod]: () =>
              new Promise((resolve) => {
                release = resolve;
              }),
          },
        });
        const pending = reader[method](input);
        state.accept(b);
        if (switchBack) {
          state.accept(a);
        }
        release(await f[source][serviceMethod](input));
        await assert.rejects(pending, { code: 'UNAUTHENTICATED' });
      }
    },
  );
}

test('first authentication during review read succeeds; clear/re-authentication cannot revive it', async () => {
  const f = backendClient();
  await f.save();
  for (const loseSession of [false, true]) {
    const state = createSessionState();
    let release;
    const reader = createReviewReader({
      sessionState: state,
      review: {
        calendar: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    });
    const pending = reader.calendar('2026-10');
    state.accept(a);
    if (loseSession) {
      state.clear();
      state.accept(a);
    }
    release(await f.review.calendar('2026-10'));
    if (loseSession) {
      await assert.rejects(pending, { code: 'UNAUTHENTICATED' });
    } else {
      assert.equal((await pending).data.recordCount, 1);
    }
  }
});

test('review subscriptions are released on success and service errors', async () => {
  const f = backendClient();
  const state = createSessionState();
  const original = state.subscribe;
  let listeners = 0;
  state.subscribe = (listener) => {
    listeners++;
    const unsubscribe = original(listener);
    return () => {
      listeners--;
      unsubscribe();
    };
  };
  const reader = createReviewReader({ sessionState: state, review: f.review });
  await reader.calendar('2026-10');
  assert.equal(listeners, 0);
  await assert.rejects(reader.calendar('invalid'), { code: 'INVALID_INPUT' });
  assert.equal(listeners, 0);
});
