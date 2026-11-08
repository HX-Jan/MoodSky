const test = require('node:test');
const assert = require('node:assert/strict');
const clone = (value) => JSON.parse(JSON.stringify(value));
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('./support/campus-repository');
const fixtures = require('./support/campus-fixtures');
require('../admin/auth');
require('../admin/session-boundary');
require('../admin/catalogue');
function fixture({ enabled = true, unwired = false } = {}) {
  const repositories = createMemoryRepositories(fixtures),
    calls = [],
    state = {};
  let principal = 'operator',
    signedIn = true,
    grant = true,
    listener;
  let before = async () => {},
    after = async (_request, result) => result;
  const router = createRouter({
    ...(!unwired ? { repositories } : {}),
    now: () => fixtures.NOW,
    resolveAccount: async (openid) =>
      openid === 'absent'
        ? null
        : { id: 'internal_' + openid, status: openid === 'disabled' ? 'disabled' : 'active' },
    resolveOperatorRoles: async (id) =>
      grant && id === 'internal_operator' ? ['data_operator'] : [],
  });
  const client = globalThis.MoodSkyAdminAuth.createClient({
    config: { envId: 'synthetic-only' },
    cloudbase: {
      init: () => ({
        auth: {
          getSession: async () =>
            signedIn
              ? { data: { session: {}, user: { id: principal, role: 'data_operator' } } }
              : { data: {} },
          onAuthStateChange(callback) {
            listener = callback;
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
        async callFunction({ data }) {
          calls.push(data);
          await before(data);
          return { result: await after(data, await router(data, { OPENID: principal })) };
        },
      }),
    },
  });
  const session = globalThis.MoodSkyAdminSession.createSessionBoundary(client);
  const controller = globalThis.MoodSkyAdminCatalogue.createCatalogueController({
    api: client,
    session,
    enabled,
    publish: (value) => Object.assign(state, value),
  });
  return {
    repositories,
    calls,
    state,
    controller,
    session,
    identity(value, event = true) {
      principal = value;
      if (event) {
        listener('SIGNED_IN');
      }
    },
    expire() {
      signedIn = false;
      listener('SIGNED_OUT');
    },
    revoke() {
      grant = false;
    },
    before(fn) {
      before = fn;
    },
    after(fn) {
      after = fn;
    },
  };
}
async function draft(f) {
  await f.controller.list('corrections');
  f.controller.select(f.state.items[0].correctionId);
  f.controller.edit('decision', 'approved');
  f.controller.edit('note', '合成审核备注');
  assert.equal(f.state.canReview, true);
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test('catalogue uses actual auth/router for three reads and confirmed correction review+reread', async () => {
  const f = fixture();
  await f.controller.list('templates');
  assert.equal(f.state.items.length, 3);
  await f.controller.list('resources');
  assert.equal(f.state.items.length, 3);
  assert.match(f.state.notice, /保存服务尚未接通/);
  await draft(f);
  assert.doesNotMatch(JSON.stringify(f.state), /acc_other|reviewedBy/);
  const oldPlace = clone(f.repositories._state.places);
  await f.controller.review(false);
  assert.equal(f.repositories._state.writeLog.length, 0);
  await f.controller.review(true);
  assert.equal(f.state.noticeType, 'success');
  assert.equal(f.state.selected.status, 'approved');
  assert.equal(f.state.canReview, false);
  assert.equal(f.state.dirty, false);
  assert.deepEqual(
    f.calls.slice(-2).map((x) => x.action),
    ['admin.reviewCorrection', 'admin.listCorrections'],
  );
  assert.deepEqual(f.repositories._state.places, oldPlace);
  assert.equal(f.repositories._state.writeLog.length, 1);
});
test('catalogue readiness and unwired service cannot claim capability', async () => {
  for (const options of [{ enabled: false }, { unwired: true }]) {
    const f = fixture(options);
    await f.controller.resume();
    await f.controller.list('templates');
    assert.equal(f.state.errorCode, 'NOT_IMPLEMENTED');
    assert.notEqual(f.state.noticeType, 'success');
    assert.equal(f.repositories._state.writeLog.length, 0);
    if (options.enabled === false) {
      assert.equal(f.calls.length, 0);
    }
  }
});
test('catalogue rejects forged browser role for ordinary, disabled and unmapped accounts', async () => {
  for (const [who, code] of [
    ['student', 'FORBIDDEN'],
    ['disabled', 'ACCOUNT_DISABLED'],
    ['absent', 'UNAUTHENTICATED'],
  ]) {
    const f = fixture();
    f.identity(who);
    await f.controller.list('corrections');
    assert.equal(f.state.errorCode, code);
    assert.equal(f.state.items.length, 0);
    assert.equal(f.repositories._state.writeLog.length, 0);
  }
});
test('known review failure retains draft; identity invalidation removes it', async () => {
  const f = fixture();
  await draft(f);
  f.revoke();
  await f.controller.review(true);
  assert.equal(f.state.errorCode, 'FORBIDDEN');
  assert.equal(f.state.draft.note, '合成审核备注');
  assert.equal(f.state.pending, false);
  assert.equal(f.repositories._state.writeLog.length, 0);
  f.expire();
  await f.controller.resume();
  assert.equal(f.state.draft, null);
  assert.equal(f.state.items.length, 0);
});
test('unknown review results before/after commit block resubmit and only reread', async () => {
  for (const committed of [false, true]) {
    const f = fixture();
    await draft(f);
    const fail = async (request, result) => {
      if (request.action === 'admin.reviewCorrection') {
        throw new Error('synthetic response loss');
      }
      return result;
    };
    if (committed) {
      f.after(fail);
    } else {
      f.before(fail);
    }
    await f.controller.review(true);
    assert.equal(f.state.pending, true);
    assert.equal(f.state.draft.note, '合成审核备注');
    assert.notEqual(f.state.noticeType, 'success');
    await f.controller.review(true);
    await f.controller.verifySaved();
    assert.equal(f.calls.filter((x) => x.action === 'admin.reviewCorrection').length, 1);
    assert.equal(f.state.pending, true);
    assert.equal(f.state.noticeType, 'warning');
    assert.equal(f.repositories._state.writeLog.length, committed ? 1 : 0);
    f.before(async () => {});
    f.after(async (_request, result) => result);
    await f.controller.list('corrections', 1, true);
    assert.equal(f.state.pending, false);
    assert.equal(f.state.dirty, false);
    f.controller.select(f.state.items[0].correctionId);
    assert.equal(f.state.selected.status, committed ? 'approved' : 'pending');
    assert.equal(f.state.canReview, false);
  }
});
test('acknowledged review can finish by read-only retry after frontend reread fails', async () => {
  const f = fixture();
  await draft(f);
  f.before(async (request) => {
    if (request.action === 'admin.listCorrections') {
      throw new Error('offline');
    }
  });
  await f.controller.review(true);
  assert.equal(f.state.pending, true);
  f.before(async () => {});
  await f.controller.verifySaved();
  assert.equal(f.state.noticeType, 'success');
  assert.equal(f.calls.filter((x) => x.action === 'admin.reviewCorrection').length, 1);
});
test('mismatched correction and malformed acknowledgements never claim success', async () => {
  for (const mutate of [
    (x) => {
      x.correction.correctionId = 'other';
    },
    (x) => {
      x.correction.placeId = 'other';
    },
    (x) => {
      x.correction.text = 'different synthetic correction';
    },
    (x) => {
      x.placeUpdated = true;
    },
    (x) => {
      x.reviewed = false;
    },
    (x) => {
      x.correction.reviewedAt = null;
    },
  ]) {
    const f = fixture();
    await draft(f);
    f.after(async (request, result) => {
      if (request.action === 'admin.reviewCorrection') {
        mutate(result.data);
      }
      return result;
    });
    await f.controller.review(true);
    assert.equal(f.state.errorCode, 'INVALID_RESPONSE');
    assert.equal(f.state.pending, true);
    assert.equal(f.state.dirty, true);
  }
});
test('truncated, duplicate and wrong-page catalogues fail closed', async () => {
  for (const mutate of [
    (x) => {
      x.truncated = true;
    },
    (x) => {
      x.items.push(x.items[0]);
    },
    (x) => {
      x.page = 2;
    },
  ]) {
    const f = fixture();
    f.after(async (_request, result) => {
      mutate(result.data);
      return result;
    });
    await f.controller.list('templates');
    assert.equal(f.state.errorCode, 'INVALID_RESPONSE');
    assert.equal(f.state.items.length, 0);
  }
});
test('review repeated clicks are locked before authentication preflight and transport', async () => {
  const f = fixture();
  await draft(f);
  const blocked = deferred();
  f.before(async () => blocked.promise);
  const first = f.controller.review(true);
  const second = f.controller.review(true);
  await tick();
  blocked.resolve();
  await Promise.all([first, second]);
  assert.equal(f.repositories._state.writeLog.length, 1);
});
test('switch discovered during review preflight does not submit old draft', async () => {
  const f = fixture();
  await draft(f);
  f.identity('student', false);
  await f.controller.review(true);
  assert.equal(f.state.draft, null);
  assert.equal(f.repositories._state.writeLog.length, 0);
});
test('hidden review fences late results, preserves same-account draft and never auto replays', async () => {
  const f = fixture();
  await draft(f);
  const blocked = deferred();
  f.after(async (request, result) => {
    if (request.action === 'admin.reviewCorrection') {
      await blocked.promise;
    }
    return result;
  });
  const first = f.controller.review(true);
  await tick();
  f.controller.suspend();
  assert.equal(f.state.draft, null);
  blocked.resolve();
  await first;
  await f.controller.resume();
  assert.equal(f.state.draft.note, '合成审核备注');
  assert.equal(f.state.pending, true);
  assert.notEqual(f.state.noticeType, 'success');
  await f.controller.verifySaved();
  assert.equal(f.state.noticeType, 'warning');
  f.identity('student');
  assert.equal(f.state.draft, null);
  assert.equal(f.state.items.length, 0);
  assert.equal(f.calls.filter((x) => x.action === 'admin.reviewCorrection').length, 1);
});
test('late catalogue result cannot refill another account view', async () => {
  const f = fixture(),
    blocked = deferred();
  f.after(async (_request, result) => {
    await blocked.promise;
    return result;
  });
  const first = f.controller.list('corrections');
  await tick();
  f.identity('student');
  f.after(async (_request, result) => result);
  await f.controller.list('corrections');
  blocked.resolve();
  await first;
  assert.equal(f.state.errorCode, 'FORBIDDEN');
  assert.equal(f.state.items.length, 0);
});
