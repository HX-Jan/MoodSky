// Local synthetic database integration. This is not a real-cloud or phone result.
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
  sessionScope,
  digest,
} = require('../cloudfunctions/moodsky/production/config');
const { createWorkerEntry } = require('../cloudfunctions/moodsky/production/worker');
const { createProductionCleanup } = require('../cloudfunctions/moodsky/production/cleanup');
const { COLLECTIONS } = require('../cloudfunctions/moodsky/production/cleanup');
const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const identity = (who) => ({
  APPID: APP_ID,
  ENV: ENV_ID,
  SOURCE: 'wx_client',
  OPENID: who,
  identityFromCurrentInvocation: true,
});
function world(options = {}) {
  const fixture = databaseFixture({}, options);
  return { ...fixture, ...client(fixture.db) };
}
function client(db) {
  let serial = 0;
  let now = new Date('2026-10-30T02:00:00.000Z');
  const scopes = {};
  const entry = (who, overrides = {}) =>
    createProductionEntry({
      readIdentity: () => identity(who),
      readConfig: () => config,
      openDatabase: () => db,
      now: () => now,
      ...overrides,
    });
  const request = (action, payload = {}, id) => ({
    apiVersion: '1',
    requestId: id || 'req_production_' + ++serial,
    action,
    payload,
  });
  async function call(who, action, payload = {}, extra = {}) {
    const result = await entry(who)({
      ...request(action, payload, extra.requestId),
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
      ...extra,
    });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  }
  return {
    entry,
    request,
    call,
    scopes,
    setNow: (value) => {
      now = new Date(value);
    },
  };
}
function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
function error(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code, JSON.stringify(result));
}
const save = (world, who = 'synthetic_a', extra = {}) =>
  world.call(
    who,
    'journal.upsert',
    {
      date: '2026-10-30',
      weather: 'CUSTOM',
      weatherName: '合成彩虹',
      tags: ['CALM'],
      text: '合成私人正文',
      expectedVersion: 0,
    },
    extra,
  );

test('production config stays closed without three distinct valid server keys and never opens DB for health', async () => {
  assert.equal(readProductionConfig({}), null);
  assert.equal(readProductionConfig({ MOODSKY_PRODUCTION_ENABLED: 'true' }), null);
  const f = world();
  const closed = f.entry('synthetic_a', {
    readConfig: () => null,
    openDatabase: () => {
      throw new Error('must not open');
    },
  });
  assert.equal(ok(await closed(f.request('system.health'))).configured, false);
  error(await closed(f.request('account.session')), 'NOT_IMPLEMENTED');
  assert.equal(f.calls.length, 0);
});

test('production requires fresh platform identity and rejects forged metadata before touching storage', async () => {
  const f = world();
  const bad = [
    {},
    { ...identity('synthetic_a'), APPID: 'wrong' },
    { ...identity('synthetic_a'), SOURCE: 'api' },
    { ...identity('synthetic_a'), ENV: 'wrong' },
  ];
  for (const value of bad) {
    const result = await f.entry('synthetic_a', { readIdentity: () => value })({
      ...f.request('account.session'),
      userInfo: identity('synthetic_a'),
      tcbContext: identity('synthetic_a'),
    });
    error(result, 'FORBIDDEN');
  }
  error(
    await f.call('synthetic_a', 'account.session', {}, { ownerId: 'forged' }),
    'INVALID_REQUEST',
  );
  assert.equal(f.calls.length, 0);
});

test('concurrent first sessions converge on one pseudonymous account; a second identity stays isolated', async () => {
  const f = world();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => f.call('synthetic_a', 'account.session')),
  );
  results.forEach(ok);
  assert.equal(new Set(results.map((result) => result.data.scope)).size, 1);
  ok(await f.call('synthetic_b', 'account.session'));
  assert.notEqual(f.scopes.synthetic_a, f.scopes.synthetic_b);
  const rows = Object.entries(f.inspect()).filter(([key]) => key.startsWith('accounts:'));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(([, row]) => !JSON.stringify(row).includes('synthetic_a')));
});

test('records survive a fresh server/client instance, preserve original retries, and advance export source versions once', async () => {
  const f = world();
  ok(await f.call('synthetic_a', 'account.session'));
  const requestId = 'req_production_original_save';
  ok(await save(f, 'synthetic_a', { requestId }));
  ok(await save(f, 'synthetic_a', { requestId }));
  const owner = f.inspect()['accounts:' + accountId(config, 'synthetic_a')];
  assert.equal(owner.journalRevision, 1);
  assert.equal(owner.sourceRevisions.journals, 1);
  const reopened = client(f.db);
  ok(await reopened.call('synthetic_a', 'account.session'));
  assert.equal(
    ok(await reopened.call('synthetic_a', 'journal.get', { date: '2026-10-30' })).entry.text,
    '合成私人正文',
  );
  assert.equal(
    ok(await reopened.call('synthetic_a', 'review.calendar', { month: '2026-10' })).recordCount,
    1,
  );
  ok(await reopened.call('synthetic_b', 'account.session'));
  assert.equal(
    ok(await reopened.call('synthetic_b', 'journal.get', { date: '2026-10-30' })).entry,
    null,
  );
  error(
    await reopened.call(
      'synthetic_b',
      'journal.get',
      { date: '2026-10-30' },
      { sessionScope: f.scopes.synthetic_a },
    ),
    'UNAUTHENTICATED',
  );
});

test('production JSON and Markdown exports are owner-only, bounded snapshots; preference changes revoke old artifacts', async () => {
  const f = world();
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));
  ok(await save(f));
  const exported = ok(
    await f.call(
      'synthetic_a',
      'account.requestExport',
      { format: 'json' },
      { requestId: 'req_production_export_original' },
    ),
  );
  assert.equal(exported.state, 'ready');
  const download = ok(
    await f.call('synthetic_a', 'account.downloadExport', { jobId: exported.jobId }),
  );
  assert.match(download.content, /合成私人正文/);
  assert.doesNotMatch(download.content, /acct_|scope_|synthetic_a|receiptKey/);
  error(
    await f.call('synthetic_b', 'account.downloadExport', { jobId: exported.jobId }),
    'FORBIDDEN',
  );
  const markdown = ok(await f.call('synthetic_a', 'account.requestExport', { format: 'markdown' }));
  assert.match(
    ok(await f.call('synthetic_a', 'account.downloadExport', { jobId: markdown.jobId })).content,
    /合成彩虹/,
  );
  ok(
    await f.call('synthetic_a', 'account.preferences', {
      operation: 'set',
      cardTextPreview: false,
    }),
  );
  assert.equal(
    f.inspect()['accounts:' + accountId(config, 'synthetic_a')].sourceRevisions.preferences,
    1,
  );
  assert.equal(
    ok(await f.call('synthetic_a', 'account.exportStatus', { jobId: exported.jobId })).state,
    'expired',
  );
  error(
    await f.call('synthetic_a', 'account.downloadExport', { jobId: exported.jobId }),
    'CONFLICT',
  );
});

test('close rollback keeps account active and leaves no orphan job when the account update fails', async () => {
  let failWrites = false;
  const f = world({
    fail: ({ collection, operation }) =>
      failWrites && collection === 'accounts' && operation === 'update',
  });
  ok(await f.call('synthetic_a', 'account.session'));
  failWrites = true;
  error(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }), 'CONFLICT');
  assert.equal(f.inspect()['accounts:' + accountId(config, 'synthetic_a')].status, 'active');
  assert.equal(Object.keys(f.inspect()).filter((key) => key.startsWith('cleanup_jobs:')).length, 0);
});

test('close denies writes immediately, recovers an ambiguous close, then cleans only its owner including journal generations', async () => {
  const f = world();
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));
  ok(await save(f));
  ok(await save(f, 'synthetic_b'));
  const ownerId = accountId(config, 'synthetic_a');
  for (const collection of COLLECTIONS) {
    if (collection !== 'journals') {
      f.put(collection, { _id: 'synthetic_' + collection, ownerId, privateBody: '合成待清理内容' });
    }
  }
  f.put('task_templates', { _id: 'public_template', enabled: true });
  const close = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  error(await f.call('synthetic_a', 'journal.get', { date: '2026-10-30' }), 'ACCOUNT_DISABLED');
  error(await f.call('synthetic_a', 'account.session'), 'ACCOUNT_DISABLED');
  const recovered = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  assert.equal(recovered.cleanup.jobId, close.cleanup.jobId);
  error(
    await f.call(
      'synthetic_b',
      'account.close',
      { confirm: 'CLOSE' },
      { sessionScope: f.scopes.synthetic_a },
    ),
    'UNAUTHENTICATED',
  );
  error(
    await f.call('synthetic_a', 'account.cleanupStatus', {
      jobId: 'another_job',
      receipt: close.receipt,
    }),
    'FORBIDDEN',
  );
  let result;
  for (let count = 0; count < 20; count++) {
    result = ok(
      await f.call('synthetic_a', 'account.cleanupStatus', {
        jobId: close.cleanup.jobId,
        receipt: close.receipt,
      }),
    );
    if (result.state === 'completed') {
      break;
    }
  }
  assert.equal(result.state, 'completed');
  assert.ok(
    !Object.entries(f.inspect()).some(
      ([key, row]) =>
        COLLECTIONS.some((name) => key.startsWith(name + ':')) && row.ownerId === ownerId,
    ),
  );
  assert.equal(
    ok(await f.call('synthetic_b', 'journal.get', { date: '2026-10-30' })).entry.text,
    '合成私人正文',
  );
  assert.ok(f.inspect()['task_templates:public_template']);
  error(await f.call('synthetic_a', 'account.session'), 'ACCOUNT_DISABLED');
  assert.equal(f.inspect()['accounts:' + ownerId].identityKind, 'wechat-hmac-v1');
});

test('expired cleanup receipts can be renewed only with the original trusted identity binding', async () => {
  const f = world();
  ok(await f.call('synthetic_a', 'account.session'));
  const close = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  f.setNow('2026-10-30T02:16:00.000Z');
  error(
    await f.call('synthetic_a', 'account.cleanupStatus', {
      jobId: close.cleanup.jobId,
      receipt: close.receipt,
    }),
    'FORBIDDEN',
  );
  const renewed = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  assert.notEqual(renewed.receipt, close.receipt);
  ok(
    await f.call('synthetic_a', 'account.cleanupStatus', {
      jobId: renewed.cleanup.jobId,
      receipt: renewed.receipt,
    }),
  );
});

test('cleanup removal failure rolls back its progress and safely resumes later', async () => {
  let rejectRemoval = false;
  const f = world({
    fail: ({ operation, collection }) =>
      rejectRemoval && operation === 'remove' && collection === 'journals',
  });
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await save(f));
  const close = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  rejectRemoval = true;
  const cleanup = createProductionCleanup({ db: f.db });
  await assert.rejects(cleanup.step(close.cleanup.jobId));
  assert.deepEqual(f.inspect()['cleanup_jobs:' + close.cleanup.jobId].progress, {});
  rejectRemoval = false;
  assert.equal((await cleanup.step(close.cleanup.jobId)).progress.journals, 1);
});

test('cleanup scheduler rejects a forged token and every WeChat client invocation before opening DB', async () => {
  let opens = 0;
  const entry = (who) =>
    createWorkerEntry({
      readConfig: () => config,
      readIdentity: () => (who ? identity(who) : {}),
      openDatabase: () => {
        opens++;
        throw new Error('should remain closed');
      },
    });
  assert.equal((await entry(null)({ workerToken: 'forged' })).code, 'FORBIDDEN');
  assert.equal(
    (
      await entry('synthetic_a')({
        workerToken: digest(config.receiptKey, 'cleanup-worker-v1', ENV_ID),
      })
    ).code,
    'FORBIDDEN',
  );
  assert.equal(opens, 0);
});

test('installed native SDK runs production account initialization, journal save and source-fenced export offline', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const c = client(createProductionDatabase(nativeDb));
      ok(await c.call('synthetic_a', 'account.session'));
      ok(await save(c));
      assert.equal(
        ok(await c.call('synthetic_a', 'journal.get', { date: '2026-10-30' })).entry.text,
        '合成私人正文',
      );
      const job = ok(await c.call('synthetic_a', 'account.requestExport', { format: 'json' }));
      assert.match(
        ok(await c.call('synthetic_a', 'account.downloadExport', { jobId: job.jobId })).content,
        /合成私人正文/,
      );
    },
    { nativeDatabase: true },
  );
});

test('installed native SDK deletes deterministic journal documents with transaction.delete, not a WX remove call', async () => {
  const id = 'synthetic_remove';
  await withOfflineWxDatabase(
    { ['journals:' + id]: { _id: id, ownerId: 'synthetic_owner' } },
    async ({ nativeDb, inspect }) => {
      const db = createProductionDatabase(nativeDb);
      const result = await db.runTransaction((tx) => tx.collection('journals').doc(id).remove());
      assert.equal(result.stats.removed, 1);
      assert.equal(inspect()['journals:' + id], undefined);
    },
    { nativeDatabase: true },
  );
});

test('session bindings differ between identities and remain stable across fresh servers', () => {
  assert.notEqual(
    sessionScope(config, accountId(config, 'synthetic_a')),
    sessionScope(config, accountId(config, 'synthetic_b')),
  );
});

test('installed native SDK scheduled worker clears expired artifact bodies and drains deterministic cleanup jobs', async () => {
  const ownerId = accountId(config, 'synthetic_closed');
  const jobId = 'synthetic_cleanup_job';
  const seed = {
    ['accounts:' + ownerId]: {
      _id: ownerId,
      identityKind: 'wechat-hmac-v1',
      status: 'disabled',
      journalLayout: 'deterministic-days-v1',
    },
    ['cleanup_jobs:' + jobId]: {
      _id: jobId,
      ownerId,
      state: 'pending',
      exportAccessRevoked: true,
      progress: {},
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    'journals:synthetic_private': { _id: 'synthetic_private', ownerId, text: '合成待清理正文' },
    'export_jobs:synthetic_expired': {
      _id: 'synthetic_expired',
      ownerId: 'synthetic_other_owner',
      state: 'ready',
      expiresAt: '2020-01-02T00:00:00.000Z',
      content: '合成到期文件正文',
    },
  };
  await withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      const db = createProductionDatabase(nativeDb);
      const worker = createWorkerEntry({
        readConfig: () => config,
        readIdentity: () => ({}),
        openDatabase: () => db,
      });
      const event = { workerToken: digest(config.receiptKey, 'cleanup-worker-v1', ENV_ID) };
      const first = await worker(event);
      assert.equal(first.ok, true);
      assert.equal(first.expiredExports, 1);
      assert.equal(inspect()['export_jobs:synthetic_expired'].content, undefined);
      assert.equal(inspect()['journals:synthetic_private'], undefined);
      assert.equal((await worker(event)).completed, 1);
      assert.equal(inspect()['cleanup_jobs:' + jobId].state, 'completed');
      assert.doesNotMatch(JSON.stringify(first), /synthetic_closed|acct_|合成待清理/);
    },
    { nativeDatabase: true, productionMaintenanceReads: true },
  );
});

test('installed native SDK enforces one account under concurrent first sessions with written-document conflicts', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const c = client(createProductionDatabase(nativeDb));
      const results = await Promise.all(
        Array.from({ length: 8 }, () => c.call('synthetic_concurrent', 'account.session')),
      );
      results.forEach(ok);
      assert.equal(Object.keys(inspect()).filter((key) => key.startsWith('accounts:')).length, 1);
      assert.equal(new Set(results.map((result) => result.data.scope)).size, 1);
    },
    { nativeDatabase: true, conflictScope: 'written-documents' },
  );
});

test('production native task writes persist once, invalidate exports, and return private history in the current client shape', async () => {
  const seed = {
    'task_templates:synthetic_task': {
      _id: 'synthetic_task',
      enabled: true,
      title: '合成小任务',
      steps: ['合成步骤'],
      durationMin: 5,
      tags: [],
    },
  };
  await withOfflineWxDatabase(
    seed,
    async ({ nativeDb, inspect }) => {
      const c = client(createProductionDatabase(nativeDb));
      ok(await c.call('synthetic_a', 'account.session'));
      const job = ok(await c.call('synthetic_a', 'account.requestExport', { format: 'json' }));
      ok(await c.call('synthetic_a', 'tasks.mine'));
      const payload = { taskId: 'synthetic_task', transition: 'select' };
      ok(
        await c.call('synthetic_a', 'tasks.transition', payload, {
          requestId: 'req_production_task_original',
        }),
      );
      ok(
        await c.call('synthetic_a', 'tasks.transition', payload, {
          requestId: 'req_production_task_original',
        }),
      );
      assert.equal(
        inspect()['accounts:' + accountId(config, 'synthetic_a')].sourceRevisions.tasks,
        1,
      );
      assert.equal(
        ok(await c.call('synthetic_a', 'account.exportStatus', { jobId: job.jobId })).state,
        'expired',
      );
      const history = ok(
        await c.call('synthetic_a', 'tasks.history', { from: '2026-10-30', to: '2026-10-30' }),
      );
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0].taskId, 'synthetic_task');
    },
    { nativeDatabase: true, taskStoreReads: true },
  );
});
