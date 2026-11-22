// Production business entry and synthetic data only; never calls a live cloud.
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionCleanup } = require('../cloudfunctions/moodsky/production/cleanup');
const {
  readProductionConfig,
  accountId,
  registrationAccountId,
  sessionScope,
  APP_ID,
  ENV_ID,
} = require('../cloudfunctions/moodsky/production/config');

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const now = () => new Date('2026-11-22T02:00:00.000Z');
const A = 'synthetic_reregister_a';
const B = 'synthetic_reregister_b';
function client(db) {
  let serial = 0;
  const scopes = {};
  const entry = (who, identityPatch = {}) =>
    createProductionEntry({
      readConfig: () => config,
      readIdentity: () => ({
        APPID: APP_ID,
        ENV: ENV_ID,
        SOURCE: 'wx_client',
        OPENID: who,
        identityFromCurrentInvocation: true,
        ...identityPatch,
      }),
      openDatabase: () => db,
      now,
      tasksWritesEnabled: true,
    });
  const request = (action, payload = {}) => ({
    apiVersion: '1',
    requestId: 'req_register_' + ++serial,
    action,
    payload,
  });
  async function call(who, action, payload = {}, extra = {}) {
    const result = await entry(who)({
      ...request(action, payload),
      sessionScope: scopes[who],
      ...extra,
    });
    if (result.ok && ['account.session', 'account.register'].includes(action)) {
      scopes[who] = result.data.scope;
    }
    return result;
  }
  return { call, entry, request, scopes };
}
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
};
const denied = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code);
};
const save = (f, who, text) =>
  f.call(who, 'journal.upsert', { date: '2026-11-22', weather: 'SUNNY', text, expectedVersion: 0 });
const confirm = (previousScope) => ({ confirm: 'REGISTER', previousScope });
async function close(f, who = A) {
  ok(await f.call(who, 'account.session'));
  return ok(await f.call(who, 'account.close', { confirm: 'CLOSE' }));
}
async function drain(db, jobId) {
  const worker = createProductionCleanup({ db, now });
  for (let i = 0; i < 30; i++) {
    if ((await worker.step(jobId)).state === 'completed') {
      return;
    }
  }
  assert.fail('synthetic cleanup did not finish');
}

test('explicit re-registration gives an empty owner and scope; old requests, exports and cleanup cannot reach the new account', async () => {
  const db = databaseFixture();
  const f = client(db.db);
  ok(await f.call(A, 'account.session'));
  ok(await f.call(B, 'account.session'));
  const oldEntry = ok(await save(f, A, 'SYNTHETIC OLD A')).entry;
  ok(await save(f, B, 'SYNTHETIC B'));
  ok(await f.call(A, 'account.preferences', { operation: 'set', cardTextPreview: true }));
  const oldExport = ok(await f.call(A, 'account.requestExport', { format: 'json' }));
  const oldScope = f.scopes[A];
  const rootId = accountId(config, A);
  const oldJournal = Object.values(db.inspect()).find(
    (r) => r.ownerId === rootId && r.text === 'SYNTHETIC OLD A',
  );
  const closed = await close(f);
  denied(await f.call(A, 'account.session'), 'ACCOUNT_DISABLED');
  const beforeStatus = db.inspect();
  assert.deepEqual(ok(await f.call(A, 'account.registration')), {
    canRegister: true,
    previousScope: oldScope,
  });
  assert.deepEqual(db.inspect(), beforeStatus);
  const registered = ok(await f.call(A, 'account.register', confirm(oldScope)));
  assert.notEqual(registered.scope, oldScope);
  assert.equal(registered.scope, sessionScope(config, registrationAccountId(config, A, 1)));
  assert.equal(db.inspect()['accounts:' + rootId].status, 'disabled');
  assert.equal(ok(await f.call(A, 'journal.get', { date: '2026-11-22' })).entry, null);
  assert.equal(
    ok(await f.call(A, 'account.preferences', { operation: 'get' })).cardTextPreview,
    false,
  );
  assert.equal(ok(await f.call(A, 'account.profile', { operation: 'get' })).nickname, '');
  assert.equal(ok(await f.call(A, 'review.calendar', { month: '2026-11' })).recordCount, 0);
  denied(await f.call(A, 'account.downloadExport', { jobId: oldExport.jobId }), 'FORBIDDEN');
  for (const [action, payload] of [
    ['journal.get', { date: '2026-11-22' }],
    ['journal.upsert', { date: '2026-11-22', weather: 'RAINY', expectedVersion: 0 }],
    ['account.close', { confirm: 'CLOSE' }],
  ]) {
    denied(await f.call(A, action, payload, { sessionScope: oldScope }), 'UNAUTHENTICATED');
  }
  ok(await save(f, A, 'SYNTHETIC NEW A'));
  const newScope = f.scopes[A];
  await drain(db.db, closed.cleanup.jobId);
  assert.equal(db.inspect()['accounts:' + rootId].registrationGeneration, 1);
  assert.equal(ok(await f.call(A, 'account.session')).scope, newScope);
  assert.equal(
    ok(await f.call(A, 'journal.get', { date: '2026-11-22' })).entry.text,
    'SYNTHETIC NEW A',
  );
  assert.equal(
    ok(await f.call(B, 'journal.get', { date: '2026-11-22' })).entry.text,
    'SYNTHETIC B',
  );
  // Restoring an old private document does not attach it to the new owner.
  const restored = { ...oldJournal };
  delete restored._id;
  await db.db.collection('journals').doc(oldJournal._id).set({ data: restored });
  const newExport = ok(await f.call(A, 'account.requestExport', { format: 'json' }));
  const content = ok(await f.call(A, 'account.downloadExport', { jobId: newExport.jobId })).content;
  assert.match(content, /SYNTHETIC NEW A/);
  assert.doesNotMatch(content, /SYNTHETIC OLD A|SYNTHETIC B/);
  assert.notEqual(ok(await f.call(A, 'journal.get', { date: '2026-11-22' })).entry.id, oldEntry.id);
});

test('concurrent confirmations and a lost response reuse one new account without clearing its later writes', async () => {
  const db = databaseFixture();
  const f = client(db.db);
  await close(f);
  const previousScope = f.scopes[A];
  const request = f.request('account.register', confirm(previousScope));
  const results = await Promise.all(Array.from({ length: 16 }, () => f.entry(A)(request)));
  assert.equal(new Set(results.map((r) => ok(r).scope)).size, 1);
  f.scopes[A] = results[0].data.scope;
  ok(await save(f, A, 'SYNTHETIC preserved after retry'));
  assert.equal(ok(await f.entry(A)(request)).scope, f.scopes[A]);
  assert.equal(
    ok(await f.call(A, 'journal.get', { date: '2026-11-22' })).entry.text,
    'SYNTHETIC preserved after retry',
  );
  assert.equal(Object.keys(db.inspect()).filter((k) => k.startsWith('accounts:')).length, 2);
});

test('a second closure creates another empty generation and rejects stale confirmations or close recovery from the first', async () => {
  const db = databaseFixture();
  const f = client(db.db);
  const firstClose = await close(f);
  const firstScope = f.scopes[A];
  ok(await f.call(A, 'account.register', confirm(firstScope)));
  ok(await save(f, A, 'SYNTHETIC generation one'));
  const secondScope = f.scopes[A];
  const secondClose = await close(f);
  denied(await f.call(A, 'account.register', confirm(firstScope)), 'CONFLICT');
  assert.equal(db.inspect()['accounts:' + accountId(config, A)].registrationGeneration, 1);
  ok(await f.call(A, 'account.register', confirm(secondScope)));
  const finalScope = f.scopes[A];
  denied(await f.call(A, 'account.register', confirm(firstScope)), 'CONFLICT');
  denied(
    await f.call(A, 'account.close', { confirm: 'CLOSE' }, { sessionScope: secondScope }),
    'UNAUTHENTICATED',
  );
  await drain(db.db, firstClose.cleanup.jobId);
  await drain(db.db, secondClose.cleanup.jobId);
  assert.equal(db.inspect()['accounts:' + accountId(config, A)].registrationGeneration, 2);
  assert.equal(ok(await f.call(A, 'account.session')).scope, finalScope);
  assert.equal(ok(await f.call(A, 'journal.get', { date: '2026-11-22' })).entry, null);
});

test('registration requires this invocation identity, explicit confirmation and its own closed-account scope', async () => {
  const db = databaseFixture();
  const f = client(db.db);
  await close(f);
  const previousScope = f.scopes[A];
  const original = db.inspect();
  denied(
    await f.entry(A, { identityFromCurrentInvocation: false })(
      f.request('account.register', confirm(previousScope)),
    ),
    'FORBIDDEN',
  );
  for (const payload of [{}, { ...confirm(previousScope), confirm: 'LOGIN' }]) {
    denied(await f.call(A, 'account.register', payload), 'INVALID_INPUT');
  }
  denied(
    await f.call(A, 'account.register', {
      ...confirm(previousScope),
      ownerId: accountId(config, A),
    }),
    'INVALID_REQUEST',
  );
  denied(await f.call(A, 'account.registration', { ownerId: 'forged' }), 'INVALID_REQUEST');
  denied(await f.call(B, 'account.register', confirm(previousScope)), 'CONFLICT');
  denied(await f.call(A, 'account.register', confirm('scope_' + 'f'.repeat(64))), 'CONFLICT');
  assert.deepEqual(db.inspect(), original);
  assert.deepEqual(ok(await f.call(B, 'account.registration')), { canRegister: false });
});

test('failure between new-account creation and routing update rolls back both sides', async () => {
  let fail = false;
  const db = databaseFixture(
    {},
    {
      fail: (event) =>
        fail &&
        event.operation === 'update' &&
        event.collection === 'accounts' &&
        event.id === accountId(config, A),
    },
  );
  const f = client(db.db);
  await close(f);
  const previous = db.inspect();
  const previousScope = f.scopes[A];
  fail = true;
  denied(await f.call(A, 'account.register', confirm(previousScope)), 'INTERNAL_ERROR');
  assert.deepEqual(db.inspect(), previous);
  fail = false;
  ok(await f.call(A, 'account.register', confirm(previousScope)));
  assert.equal(Object.keys(db.inspect()).filter((k) => k.startsWith('accounts:')).length, 2);
});

test('locked SDK runs re-registration and old cleanup with distinct owner scopes offline', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const db = createProductionDatabase(nativeDb);
      const f = client(db);
      ok(await f.call(A, 'account.session'));
      ok(await save(f, A, 'SYNTHETIC old SDK record'));
      const closed = await close(f);
      const previousScope = f.scopes[A];
      const results = await Promise.all(
        Array.from({ length: 8 }, () => f.call(A, 'account.register', confirm(previousScope))),
      );
      assert.equal(new Set(results.map((r) => ok(r).scope)).size, 1);
      ok(await save(f, A, 'SYNTHETIC new SDK record'));
      await drain(db, closed.cleanup.jobId);
      assert.equal(inspect()['accounts:' + accountId(config, A)].registrationGeneration, 1);
      assert.equal(
        ok(await f.call(A, 'journal.get', { date: '2026-11-22' })).entry.text,
        'SYNTHETIC new SDK record',
      );
    },
    { nativeDatabase: true, productionMaintenanceReads: true },
  );
});

test('locked SDK task history starts empty after registration even while the old history still exists', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const f = client(createProductionDatabase(nativeDb));
      ok(await f.call(A, 'account.session'));
      ok(await f.call(A, 'tasks.transition', { taskId: 'moodsky_01_walk', transition: 'select' }));
      assert.equal(
        ok(await f.call(A, 'tasks.history', { from: '2026-11-22', to: '2026-11-22' })).items.length,
        1,
      );
      await close(f);
      const previousScope = f.scopes[A];
      ok(await f.call(A, 'account.register', confirm(previousScope)));
      assert.deepEqual(
        ok(await f.call(A, 'tasks.history', { from: '2026-11-22', to: '2026-11-22' })).items,
        [],
      );
      assert.equal(
        Object.keys(inspect()).filter((key) => key.startsWith('task_history:')).length,
        1,
      );
    },
    { nativeDatabase: true, taskStoreReads: true },
  );
});
