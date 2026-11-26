const test = require('node:test');
const assert = require('node:assert/strict');
const { phoneWorld } = require('./helpers/phone-world');
const { createPhoneSignIn } = require('../miniprogram/modules/account/phone-signin');
const { createSessionState } = require('../miniprogram/services/session-state');
const { createProductionCleanup } = require('../cloudfunctions/moodsky/production/cleanup');
const ok = (reply) => {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.data;
};
const error = (reply, code) => {
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, code);
};
const auth = (session) => ({ phoneSession: session.phoneSession, sessionScope: session.scope });
const start = async (world, code = 'primary', who = 'synthetic_wechat') =>
  ok(await world.call('account.phoneLogin', { mode: 'login', code }, {}, who));
const confirm = (world, decision, who = 'synthetic_wechat') =>
  world.call(
    'account.phoneLogin',
    {
      mode: decision.nextStep,
      ticket: decision.phoneTicket,
      confirm: decision.nextStep === 'link' ? 'LINK' : 'REGISTER',
    },
    {},
    who,
  );

test('a new phone creates one account immediately, and the same phone returns it on another WeChat', async () => {
  const f = phoneWorld();
  const first = await start(f);
  assert.equal(first.authenticated, true);
  assert.equal(first.phoneLabel, '138****0001');
  const otherWechat = await start(f, 'primary', 'another_verified_wechat');
  assert.equal(otherWechat.scope, first.scope);
  const repeat = await Promise.all([start(f), start(f)]);
  repeat.forEach((s) => assert.equal(s.scope, first.scope));
  assert.equal(Object.values(f.inspect()).filter((r) => r.status === 'active').length, 1);
  assert.equal(Object.values(f.inspect()).filter((r) => r.status === 'mapping').length, 1);
  error(
    await f.call(
      'account.session',
      {},
      { phoneSession: first.phoneSession },
      'another_verified_wechat',
    ),
    'UNAUTHENTICATED',
  );
  const restored = ok(await f.call('account.session', {}, auth(first)));
  assert.equal(restored.phoneLabel, first.phoneLabel);
  assert.doesNotMatch(JSON.stringify(f.inspect()), /13800000001|primary|phoneTicket|phoneSession/);
});

test('legacy records are linked only after explicit confirmation, without consuming a second phone code', async () => {
  const f = phoneWorld();
  const legacy = ok(await f.call('account.session'));
  ok(
    await f.call(
      'account.preferences',
      { operation: 'set', cardTextPreview: true },
      { sessionScope: legacy.scope },
    ),
  );
  const before = f.inspect();
  const decision = await start(f);
  assert.equal(decision.nextStep, 'link');
  assert.equal(decision.authenticated, false);
  assert.deepEqual(f.inspect(), before);
  const linked = ok(await confirm(f, decision));
  assert.equal(linked.scope, legacy.scope);
  assert.equal(f.exchanges(), 1);
  const again = ok(await confirm(f, decision));
  assert.equal(again.scope, legacy.scope);
  assert.equal(f.exchanges(), 1);
  assert.equal(
    ok(await f.call('account.preferences', { operation: 'get' }, auth(linked))).cardTextPreview,
    true,
  );
});

test('cancelling a legacy association changes no account and a late confirmation cannot mutate after leaving', async () => {
  const f = phoneWorld();
  ok(await f.call('account.session'));
  const before = f.inspect();
  let visits = 0;
  const cancelled = createPhoneSignIn({
    call: (request) => f.call(request.action, request.payload),
    platform: {
      showModal: (options) => {
        visits++;
        options.success({ confirm: false });
      },
    },
    isCurrent: () => true,
    isAgreed: () => true,
  });
  await assert.rejects(cancelled('primary'), /已取消登录/);
  assert.equal(visits, 1);
  assert.deepEqual(f.inspect(), before);
  let current = true;
  const left = createPhoneSignIn({
    call: (request) => f.call(request.action, request.payload),
    platform: {
      showModal: (options) => {
        current = false;
        options.success({ confirm: true });
      },
    },
    isCurrent: () => current,
    isAgreed: () => true,
  });
  await assert.rejects(left('primary'), /登录已取消/);
  assert.deepEqual(f.inspect(), before);
});

test('a confirmed decision response cannot authenticate after consent withdrawal or an account change', async () => {
  for (const reason of ['consent', 'account']) {
    const f = phoneWorld();
    ok(await f.call('account.session'));
    let agreed = true,
      current = true;
    const signin = createPhoneSignIn({
      call: async (request) => {
        const reply = await f.call(request.action, request.payload);
        if (request.payload.mode === 'link') {
          // The explicit decision has committed; only its late UI result is cancelled.
          if (reason === 'consent') {
            agreed = false;
          } else {
            current = false;
          }
        }
        return reply;
      },
      platform: { showModal: (options) => options.success({ confirm: true }) },
      isCurrent: () => current,
      isAgreed: () => agreed,
    });
    await assert.rejects(signin('primary'), /登录已取消/);
    assert.equal(f.exchanges(), 1);
  }
});

test('decision tickets reject tampering, another WeChat, purpose changes and expiry without changing data', async () => {
  const f = phoneWorld();
  ok(await f.call('account.session'));
  const link = await start(f);
  const before = f.inspect();
  error(await confirm(f, { ...link, phoneTicket: link.phoneTicket + 'x' }), 'UNAUTHENTICATED');
  error(await confirm(f, link, 'different_wechat'), 'UNAUTHENTICATED');
  error(await confirm(f, { ...link, nextStep: 'register' }), 'UNAUTHENTICATED');
  error(
    await f.call('account.phoneLogin', {
      mode: 'link',
      ticket: link.phoneTicket,
      confirm: 'LINK',
      phone: '13800000002',
    }),
    'INVALID_INPUT',
  );
  f.advanceMinutes(6);
  error(await confirm(f, link), 'UNAUTHENTICATED');
  assert.deepEqual(f.inspect(), before);
});

test('different verified phone accounts keep journal content, preferences and signed labels separate', async () => {
  const f = phoneWorld();
  const a = await start(f),
    b = await start(f, 'other');
  ok(
    await f.call(
      'journal.upsert',
      {
        date: '2026-11-22',
        weather: 'SUNNY',
        tags: [],
        text: 'SYNTHETIC PRIVATE A',
        expectedVersion: 0,
      },
      auth(a),
    ),
  );
  assert.equal(
    ok(await f.call('journal.get', { date: '2026-11-22' }, auth(a))).entry.text,
    'SYNTHETIC PRIVATE A',
  );
  assert.equal(ok(await f.call('journal.get', { date: '2026-11-22' }, auth(b))).entry, null);
  assert.notEqual(a.scope, b.scope);
  assert.equal(a.phoneLabel, '138****0001');
  assert.equal(b.phoneLabel, '138****0002');
  error(
    await f.call(
      'journal.get',
      { date: '2026-11-22' },
      { phoneSession: a.phoneSession, sessionScope: b.scope },
    ),
    'UNAUTHENTICATED',
  );
});

test('closed phone needs confirmation; concurrent confirmations converge, and old cleanup cannot touch the new account', async () => {
  const f = phoneWorld();
  const a = await start(f),
    b = await start(f, 'other');
  ok(
    await f.call(
      'journal.upsert',
      {
        date: '2026-11-22',
        weather: 'SUNNY',
        tags: [],
        text: 'SYNTHETIC OLD PHONE',
        expectedVersion: 0,
      },
      auth(a),
    ),
  );
  const closed = ok(await f.call('account.close', { confirm: 'CLOSE' }, auth(a)));
  const decision = await start(f);
  assert.equal(decision.authenticated, false);
  assert.equal(decision.nextStep, 'register');
  error(await f.call('account.session', {}, auth(a)), 'ACCOUNT_DISABLED');
  error(
    await f.call('account.register', { confirm: 'REGISTER', previousScope: a.scope }, auth(a)),
    'UNAUTHENTICATED',
  );
  const accountsBefore = Object.values(f.inspect()).filter((r) => r.status === 'active').length;
  assert.equal(accountsBefore, 1);
  const registered = await Promise.all([confirm(f, decision), confirm(f, decision)]);
  const fresh = ok(registered[0]);
  assert.equal(fresh.scope, ok(registered[1]).scope);
  assert.notEqual(fresh.scope, a.scope);
  assert.equal(ok(await f.call('journal.get', { date: '2026-11-22' }, auth(fresh))).entry, null);
  ok(
    await f.call(
      'journal.upsert',
      {
        date: '2026-11-22',
        weather: 'RAINY',
        tags: [],
        text: 'SYNTHETIC NEW PHONE',
        expectedVersion: 0,
      },
      auth(fresh),
    ),
  );
  const worker = createProductionCleanup({ db: f.db });
  let complete = false;
  for (let i = 0; i < 30; i++) {
    if ((await worker.step(closed.cleanup.jobId)).state === 'completed') {
      complete = true;
      break;
    }
  }
  assert.equal(complete, true);
  assert.equal(
    ok(await f.call('journal.get', { date: '2026-11-22' }, auth(fresh))).entry.text,
    'SYNTHETIC NEW PHONE',
  );
  assert.equal(ok(await f.call('account.session', {}, auth(b))).scope, b.scope);
  error(await f.call('journal.get', { date: '2026-11-22' }, auth(a)), 'ACCOUNT_DISABLED');
  assert.equal((await start(f)).scope, fresh.scope);
});

test('a deleted legacy-linked phone registers independently and stale confirmations cannot create a third account', async () => {
  const f = phoneWorld();
  const legacy = ok(await f.call('account.session'));
  const link = await start(f);
  const first = ok(await confirm(f, link));
  ok(await f.call('account.close', { confirm: 'CLOSE' }, auth(first)));
  const firstDecision = await start(f);
  const second = ok(await confirm(f, firstDecision));
  assert.notEqual(second.scope, legacy.scope);
  assert.equal(ok(await f.call('journal.get', { date: '2026-11-22' }, auth(second))).entry, null);
  ok(await f.call('account.close', { confirm: 'CLOSE' }, auth(second)));
  error(await confirm(f, firstDecision), 'CONFLICT');
  const thirdDecision = await start(f);
  const third = ok(await confirm(f, thirdDecision));
  assert.notEqual(third.scope, second.scope);
  assert.equal((await start(f)).scope, third.scope);
  error(await f.call('account.session', {}, auth(second)), 'ACCOUNT_DISABLED');
});

test('client confirmation flow performs one phone exchange, then a signed re-registration request', async () => {
  const f = phoneWorld();
  const first = await start(f);
  ok(await f.call('account.close', { confirm: 'CLOSE' }, auth(first)));
  const exchanges = f.exchanges();
  const requests = [];
  const signin = createPhoneSignIn({
    call: (request) => {
      requests.push(request);
      return f.call(request.action, request.payload);
    },
    platform: {
      showModal: (options) => {
        assert.match(options.content, /旧|原有记录/);
        options.success({ confirm: true });
      },
    },
    isCurrent: () => true,
    isAgreed: () => true,
  });
  const next = ok(await signin('primary'));
  assert.notEqual(next.scope, first.scope);
  assert.deepEqual(
    requests.map((r) => r.payload.mode),
    ['login', 'register'],
  );
  assert.equal(f.exchanges(), exchanges + 1);
  assert.equal(requests[1].payload.code, undefined);
});

test('phone label and credential disappear together on logout or another account selection', () => {
  const state = createSessionState();
  state.accept('scope_' + 'a'.repeat(64), 'signed_a', '138****0001');
  assert.equal(state.capture().phoneLabel, '138****0001');
  state.accept('scope_' + 'b'.repeat(64));
  assert.equal(state.capture().phoneLabel, undefined);
  state.accept('scope_' + 'a'.repeat(64), 'signed_a', '13800000001');
  assert.equal(state.capture().phoneLabel, undefined);
  state.clear();
  assert.equal(state.capture(), null);
});
