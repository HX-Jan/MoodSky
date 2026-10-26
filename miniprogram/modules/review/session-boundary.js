const { cloudSessionState } = require('../../services/session-state');
const { AppError } = require('../../shared/result');

// The first authentication can finish during a read. Only replacing or losing an
// established binding invalidates it; returning to the same scope is a new session.
function subscribeReviewSession(listener, state = cloudSessionState) {
  let previous = state.capture();
  return state.subscribe(() => {
    const next = state.capture();
    const invalidated = previous !== null;
    previous = next;
    if (invalidated) {
      listener();
    }
  });
}

async function readInReviewSession(work, state = cloudSessionState) {
  let invalidated = false;
  const unsubscribe = subscribeReviewSession(() => {
    invalidated = true;
  }, state);
  try {
    const result = await work();
    if (invalidated) {
      throw new AppError('UNAUTHENTICATED', '登录状态已变化，请重新读取。');
    }
    return result;
  } finally {
    unsubscribe();
  }
}
module.exports = { subscribeReviewSession, readInReviewSession };
