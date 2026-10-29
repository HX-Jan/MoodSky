const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { createMemoryRepositories } = require('./support/campus-repository');
const fixtures = require('./support/campus-fixtures');
require('../admin/auth');
require('../admin/session-boundary');
require('../admin/places');
const { createClient } = globalThis.MoodSkyAdminAuth;
const { createSessionBoundary } = globalThis.MoodSkyAdminSession;
const { createPlaceController } = globalThis.MoodSkyAdminPlaces;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture({ enabled = true, unwired = false } = {}) {
  const repositories = createMemoryRepositories({ places: fixtures.places });
  let operatorGrant = true;
  const router = createRouter({
    ...(!unwired ? { repositories } : {}),
    now: () => fixtures.NOW,
    resolveAccount: async (openid) =>
      openid === 'absent'
        ? null
        : { id: 'internal_' + openid, status: openid === 'disabled' ? 'disabled' : 'active' },
    resolveOperatorRoles: async (id) =>
      operatorGrant && id === 'internal_operator' ? ['data_operator'] : [],
  });
  const calls = [];
  const state = {};
  let principal = 'operator';
  let sdkSession = true;
  let listener;
  let unsubscriptions = 0;
  let before = async () => {};
  let after = async (_request, result) => result;
  let getSession = async () =>
    sdkSession
      ? { data: { session: {}, user: { id: principal, role: 'data_operator' } } }
      : { data: {} };
  const client = createClient({
    config: { envId: 'synthetic-local-only' },
    cloudbase: {
      init: () => ({
        auth: {
          getSession: () => getSession(),
          onAuthStateChange: (callback) => {
            listener = callback;
            return { data: { subscription: { unsubscribe: () => unsubscriptions++ } } };
          },
        },
        async callFunction({ data }) {
          calls.push(data);
          await before(data);
          const result = await router(data, { OPENID: principal });
          return { result: await after(data, result) };
        },
      }),
    },
  });
  const session = createSessionBoundary(client);
  const controller = createPlaceController({
    api: client,
    session,
    enabled,
    publish: (value) => Object.assign(state, value),
  });
  return {
    state,
    controller,
    client,
    session,
    calls,
    repositories,
    identity(value, event = true) {
      principal = value;
      if (event) {
        listener('SIGNED_IN');
      }
    },
    expire() {
      sdkSession = false;
      listener('SIGNED_OUT');
    },
    sdkError() {
      getSession = async () => {
        throw new Error('invalid synthetic credential');
      };
    },
    slowSession(promise) {
      getSession = () => promise;
    },
    before(callback) {
      before = callback;
    },
    after(callback) {
      after = callback;
    },
    unsubscriptions: () => unsubscriptions,
    revokeRole() {
      operatorGrant = false;
    },
  };
}
async function draft(f) {
  await f.controller.select('p_library');
  assert.equal(f.state.selected.placeId, 'p_library');
  f.controller.edit('name', '合成维护结果');
  assert.equal(f.state.canSave, true);
}

test('places UI controller uses actual auth envelope, router and repository for list/detail/save/reread', async () => {
  const f = fixture();
  await f.controller.list({ page: 1, pageSize: 2 });
  assert.equal(f.state.items.length, 2);
  assert.equal(f.state.hasMore, true);
  await draft(f);
  f.controller.edit('openHours', null);
  f.controller.edit('markVerified', true);
  await f.controller.save();
  assert.equal(f.state.noticeType, 'success');
  assert.equal(f.state.dirty, false);
  assert.equal(f.state.pending, false);
  assert.equal(f.state.draft.name, '合成维护结果');
  assert.equal(f.state.draft.openHours, null);
  assert.deepEqual(
    f.calls.map((row) => row.action),
    ['admin.listPlaces', 'admin.getPlace', 'admin.updatePlace', 'admin.getPlace'],
  );
  const stored = await f.repositories.places.findByPlaceId('p_library');
  assert.equal(stored.name, f.state.draft.name);
  assert.equal(stored.updatedBy, 'internal_operator');
  assert.equal(stored.verifiedBy, 'internal_operator');
  assert.notEqual(stored.updatedAt, fixtures.places[0].updatedAt);
  assert.equal(f.calls[2].payload.expectedUpdatedAt, fixtures.places[0].updatedAt);
  for (const row of f.calls) {
    assert.equal(
      ['uid', 'OPENID', 'role', 'ownerId', 'token'].some((key) => Object.hasOwn(row.payload, key)),
      false,
    );
  }
});

test('place readiness flag fails closed while SDK session checking remains available', async () => {
  const f = fixture({ enabled: false });
  await f.controller.resume();
  assert.equal(f.session.isCurrent(f.session.capture()), true);
  await f.controller.list();
  await f.controller.select('p_library');
  assert.equal(f.state.errorCode, 'NOT_IMPLEMENTED');
  assert.equal(f.calls.length, 0);
});

test('ordinary, disabled and unmapped identities cannot gain permission from an SDK user role', async () => {
  for (const [identity, code] of [
    ['student', 'FORBIDDEN'],
    ['disabled', 'ACCOUNT_DISABLED'],
    ['absent', 'UNAUTHENTICATED'],
  ]) {
    const f = fixture();
    f.identity(identity);
    await f.controller.list();
    assert.equal(f.state.errorCode, code);
    assert.equal(f.state.noticeType, 'error');
    assert.equal(f.state.items.length, 0);
    assert.equal(f.repositories._state.writeLog.length, 0);
  }
});

test('expired and invalid SDK sessions clear private drafts before another cloud request', async () => {
  for (const expire of [(f) => f.expire(), (f) => f.sdkError()]) {
    const f = fixture();
    await draft(f);
    expire(f);
    await f.controller.resume();
    assert.equal(f.state.errorCode, 'UNAUTHENTICATED');
    assert.equal(f.state.draft, null);
    assert.equal(f.state.items.length, 0);
    await f.controller.save();
    assert.equal(f.calls.filter((row) => row.action === 'admin.updatePlace').length, 0);
  }
});

test('identity change discovered during save preflight never sends the previous account draft', async () => {
  const f = fixture();
  await draft(f);
  f.identity('student', false);
  await f.controller.save();
  assert.equal(f.state.draft, null);
  assert.equal(f.calls.filter((row) => row.action === 'admin.updatePlace').length, 0);
});

test('known place errors preserve input and cannot show a success notice', async () => {
  for (const code of ['FORBIDDEN', 'NOT_IMPLEMENTED', 'CONFLICT', 'INVALID_INPUT']) {
    const f = fixture();
    await draft(f);
    if (code === 'FORBIDDEN') {
      f.revokeRole();
    }
    if (code === 'NOT_IMPLEMENTED') {
      f.repositories.places = null;
    }
    if (code === 'CONFLICT') {
      f.repositories._state.places[0].updatedAt = '2026-10-24T00:00:00.000Z';
    }
    if (code === 'INVALID_INPUT') {
      f.controller.edit('name', '');
    }
    const input = f.state.draft.name;
    await f.controller.save();
    assert.equal(f.state.errorCode, code);
    assert.equal(f.state.noticeType, 'error');
    assert.equal(f.state.draft.name, input);
    assert.equal(f.state.pending, false);
    assert.equal(f.repositories._state.writeLog.length, 0);
  }
});

test('unwired admin router remains visibly unavailable', async () => {
  const f = fixture({ unwired: true });
  await f.controller.list();
  assert.equal(f.state.errorCode, 'NOT_IMPLEMENTED');
  assert.notEqual(f.state.noticeType, 'success');
});

test('network loss before or after a write keeps draft and never automatically resends an uncertain save', async () => {
  for (const committed of [false, true]) {
    const f = fixture();
    await draft(f);
    if (committed) {
      f.after(async (request, result) => {
        if (request.action === 'admin.updatePlace') {
          throw new Error('lost response');
        }
        return result;
      });
    } else {
      f.before(async (request) => {
        if (request.action === 'admin.updatePlace') {
          throw new Error('offline');
        }
      });
    }
    await f.controller.save();
    assert.equal(f.state.errorCode, 'NETWORK_ERROR');
    assert.equal(f.state.pending, true);
    assert.equal(f.state.draft.name, '合成维护结果');
    assert.equal(f.repositories._state.writeLog.length, committed ? 1 : 0);
    await f.controller.save();
    await f.controller.verifySaved();
    assert.equal(f.calls.filter((row) => row.action === 'admin.updatePlace').length, 1);
    assert.equal(f.state.pending, true);
    assert.equal(f.state.noticeType, 'warning');
    f.before(async () => {
      throw new Error('still offline');
    });
    await f.controller.select('p_library', true);
    assert.equal(f.state.pending, true);
    assert.equal(f.state.canSave, false);
    f.before(async () => {});
    await f.controller.select('p_library', true);
    assert.equal(f.state.pending, false);
    assert.equal(f.state.dirty, false);
  }
});

test('a confirmed save whose frontend reread fails can finish with a read-only retry', async () => {
  const f = fixture();
  await draft(f);
  f.before(async (request) => {
    if (request.action === 'admin.getPlace') {
      throw new Error('offline reread');
    }
  });
  await f.controller.save();
  assert.equal(f.state.noticeType, 'error');
  assert.equal(f.state.pending, true);
  f.before(async () => {});
  await f.controller.verifySaved();
  assert.equal(f.state.noticeType, 'success');
  assert.equal(f.state.pending, false);
  assert.equal(f.calls.filter((row) => row.action === 'admin.updatePlace').length, 1);
});

test('unverified, mismatched and superseded saves never clear draft or claim success', async () => {
  for (const kind of ['unverified', 'mismatch', 'superseded']) {
    const f = fixture();
    await draft(f);
    f.after(async (request, result) => {
      if (request.action === 'admin.updatePlace' && kind === 'unverified') {
        result.data.verified = false;
      }
      if (request.action === 'admin.updatePlace' && kind === 'mismatch') {
        result.data.place.placeId = 'p_other';
      }
      if (request.action === 'admin.getPlace' && kind === 'superseded') {
        result.data.name = 'another operator';
      }
      return result;
    });
    await f.controller.save();
    assert.notEqual(f.state.noticeType, 'success');
    assert.equal(f.state.draft.name, '合成维护结果');
    assert.equal(f.state.pending, true);
  }
});

test('missing versions are read-only and stale versions receive a real conflict without writing', async () => {
  const f = fixture();
  await f.controller.select('p_old');
  f.controller.edit('name', 'must not save');
  await f.controller.save();
  assert.equal(f.state.canSave, false);
  assert.equal(f.repositories._state.writeLog.length, 0);
  await f.controller.select('p_library', true);
  f.controller.edit('name', 'stale input');
  f.repositories._state.places.find((row) => row.placeId === 'p_library').updatedAt =
    '2026-10-24T00:00:00.000Z';
  await f.controller.save();
  assert.equal(f.state.errorCode, 'CONFLICT');
  assert.equal(f.state.draft.name, 'stale input');
  assert.equal(f.repositories._state.writeLog.length, 0);
});

test('truncated and duplicate lists do not present an apparently complete catalogue', async () => {
  for (const kind of ['truncated', 'duplicates']) {
    const f = fixture();
    f.after(async (_request, result) => {
      if (kind === 'truncated') {
        result.data.truncated = true;
      } else {
        result.data.items = [result.data.items[0], result.data.items[0]];
      }
      return result;
    });
    await f.controller.list();
    assert.equal(f.state.items.length, 0);
    assert.equal(f.state.errorCode, 'INVALID_RESPONSE');
  }
});

test('duplicate saves during SDK preflight and transport dispatch only once', async () => {
  const f = fixture();
  await draft(f);
  const auth = deferred();
  f.slowSession(auth.promise);
  const first = f.controller.save();
  const second = f.controller.save();
  auth.resolve({ data: { session: {}, user: { id: 'operator' } } });
  await Promise.all([first, second]);
  assert.equal(f.repositories._state.writeLog.length, 1);
  assert.equal(f.state.noticeType, 'success');
});

test('late read errors and results cannot replace a newer account view', async () => {
  for (const reject of [false, true]) {
    const f = fixture();
    const blocked = deferred();
    f.before(async () => {
      await blocked.promise;
      if (reject) {
        throw new Error('late failure');
      }
    });
    const first = f.controller.select('p_library');
    await tick();
    f.identity('student');
    f.before(async () => {});
    await f.controller.list();
    assert.equal(f.state.errorCode, 'FORBIDDEN');
    blocked.resolve();
    await first;
    assert.equal(f.state.errorCode, 'FORBIDDEN');
    assert.equal(f.state.draft, null);
    assert.equal(f.state.loading, false);
  }
});

test('hide during save hides input, fences late success and resumes without repeating write', async () => {
  const f = fixture();
  await draft(f);
  const blocked = deferred();
  f.after(async (request, result) => {
    if (request.action === 'admin.updatePlace') {
      await blocked.promise;
    }
    return result;
  });
  const saving = f.controller.save();
  await tick();
  f.controller.suspend();
  assert.equal(f.state.draft, null);
  blocked.resolve();
  await saving;
  assert.notEqual(f.state.noticeType, 'success');
  await f.controller.resume();
  assert.equal(f.state.draft.name, '合成维护结果');
  assert.equal(f.state.pending, true);
  assert.equal(f.calls.filter((row) => row.action === 'admin.updatePlace').length, 1);
  await f.controller.verifySaved();
  assert.equal(f.state.noticeType, 'warning');
});

test('session boundary rejects late authentication and unsubscribes SDK events on dispose', async () => {
  const f = fixture();
  await f.session.refresh();
  const scope = f.session.capture();
  assert.equal(await f.session.refresh(), scope);
  const blocked = deferred();
  f.slowSession(blocked.promise);
  const refreshing = f.session.refresh();
  f.expire();
  blocked.resolve({ data: { session: {}, user: { id: 'operator' } } });
  assert.equal(await refreshing, null);
  assert.equal(f.session.isCurrent(scope), false);
  f.controller.dispose();
  f.session.dispose();
  assert.equal(f.unsubscriptions(), 1);
});
