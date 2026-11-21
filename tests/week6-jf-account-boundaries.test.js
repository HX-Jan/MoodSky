// W6-JF - account preference, deactivation, deletion request and cleanup progress boundaries.
// Synthetic local doubles only: no cloud, no network, no real account.
const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseFixture } = require('./helpers/w2-database');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');
const { COLLECTIONS } = require('../cloudfunctions/moodsky/production/cleanup');
const {
  readProductionConfig,
  APP_ID,
  ENV_ID,
  accountId,
} = require('../cloudfunctions/moodsky/production/config');

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
const template = {
  _id: 'synthetic_task',
  enabled: true,
  title: '合成任务',
  steps: ['合成步骤'],
  durationMin: 5,
  tags: [],
};
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
};
const error = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code, JSON.stringify(result));
};

function world({ seed = { 'task_templates:synthetic_task': template }, fail = () => false } = {}) {
  const fixture = databaseFixture(seed, { fail });
  let now = new Date('2026-11-18T04:00:00.000Z');
  let serial = 0;
  const scopes = {};
  const entry = (who) =>
    createProductionEntry({
      tasksWritesEnabled: true,
      readIdentity: () => identity(who),
      readConfig: () => config,
      openDatabase: () => fixture.db,
      now: () => now,
    });
  async function call(who, action, payload = {}, extra = {}) {
    const result = await entry(who)({
      apiVersion: '1',
      requestId: extra.requestId || 'req_w6_jf_account_' + ++serial,
      action,
      payload,
      ...(scopes[who] ? { sessionScope: scopes[who] } : {}),
      ...extra,
    });
    if (action === 'account.session' && result.ok) {
      scopes[who] = result.data.scope;
    }
    return result;
  }
  return {
    fixture,
    call,
    setNow: (value) => {
      now = new Date(value);
    },
  };
}

function rowsOf(rows, collection, ownerId) {
  return Object.entries(rows)
    .filter(([key, row]) => key.startsWith(collection + ':') && row.ownerId === ownerId)
    .map(([, row]) => row);
}
function cleanupJobs(rows) {
  return Object.entries(rows)
    .filter(([key]) => key.startsWith('cleanup_jobs:'))
    .map(([, row]) => row);
}

test('W6-JF-P01 preferences stay owner-scoped and a partial write never resets the other field', async () => {
  const f = world();
  const ownerA = accountId(config, 'synthetic_a');
  const ownerB = accountId(config, 'synthetic_b');
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));

  const defaults = ok(await f.call('synthetic_a', 'account.preferences', { operation: 'get' }));
  assert.deepEqual(defaults, {
    cardTextPreview: false,
    decorationsEnabled: true,
    updatedAt: null,
  });
  const saved = ok(
    await f.call('synthetic_a', 'account.preferences', {
      operation: 'set',
      cardTextPreview: true,
    }),
  );
  assert.equal(saved.cardTextPreview, true);
  assert.equal(saved.decorationsEnabled, true);
  const reread = ok(await f.call('synthetic_a', 'account.preferences', { operation: 'get' }));
  assert.equal(reread.cardTextPreview, true);
  assert.equal(reread.decorationsEnabled, true);
  assert.equal(typeof reread.updatedAt, 'string');

  const other = ok(await f.call('synthetic_b', 'account.preferences', { operation: 'get' }));
  assert.deepEqual(other, {
    cardTextPreview: false,
    decorationsEnabled: true,
    updatedAt: null,
  });
  const rows = f.fixture.inspect();
  assert.equal(rowsOf(rows, 'preferences', ownerA).length, 1);
  assert.equal(rowsOf(rows, 'preferences', ownerB).length, 0);
});

test('W6-JF-C01 close disables the account, revokes private access and enqueues one job', async () => {
  const f = world();
  const ownerA = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));
  ok(
    await f.call('synthetic_a', 'account.preferences', {
      operation: 'set',
      cardTextPreview: true,
    }),
  );
  ok(
    await f.call(
      'synthetic_a',
      'tasks.transition',
      { taskId: 'synthetic_task', transition: 'select', expectedDate: '2026-11-18' },
      { requestId: 'req_w6_jf_close_task' },
    ),
  );

  const closed = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  assert.equal(closed.accountStatus, 'disabled');
  assert.equal(closed.privateActionsDenied, true);
  assert.equal(closed.sessionRevoked, false);
  assert.equal(closed.sessionRevocation, 'not_implemented');
  assert.equal(closed.cleanup.state, 'pending');
  assert.equal(typeof closed.cleanup.jobId, 'string');
  assert.equal(typeof closed.receipt, 'string');
  const jobs = cleanupJobs(f.fixture.inspect());
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, 'pending');
  assert.equal(jobs[0].exportAccessRevoked, true);
  assert.deepEqual(jobs[0].progress, {});
  assert.equal(f.fixture.inspect()['accounts:' + ownerA].status, 'disabled');

  for (const action of [
    'account.session',
    'account.preferences',
    'journal.get',
    'tasks.mine',
    'tasks.history',
    'account.requestExport',
    'account.exportStatus',
    'account.downloadExport',
    'tasks.transition',
  ]) {
    const payload =
      action === 'account.preferences'
        ? { operation: 'get' }
        : action === 'journal.get'
          ? { date: '2026-11-18' }
          : action === 'tasks.history'
            ? { from: '2026-11-18', to: '2026-11-18' }
            : action === 'account.exportStatus' || action === 'account.downloadExport'
              ? { jobId: 'synthetic_export' }
              : action === 'tasks.transition'
                ? { taskId: 'synthetic_task', transition: 'complete' }
                : {};
    error(await f.call('synthetic_a', action, payload), 'ACCOUNT_DISABLED');
  }
  // Public catalogue reads carry no private state and still work.
  ok(await f.call('synthetic_a', 'tasks.suggestions'));
  // The second account keeps its own private access.
  ok(await f.call('synthetic_b', 'account.preferences', { operation: 'get' }));
});

async function drainCleanup(f, who, closed) {
  let last = null;
  for (let count = 0; count < COLLECTIONS.length + 5; count++) {
    last = ok(
      await f.call(who, 'account.cleanupStatus', {
        jobId: closed.cleanup.jobId,
        receipt: closed.receipt,
      }),
    );
    if (last.state === 'completed') {
      return last;
    }
  }
  assert.fail('cleanup did not complete: ' + JSON.stringify(last));
}

test('W6-JF-C02 cleanup removes only the closing owner and B plus public data stay intact', async () => {
  const ownerA = accountId(config, 'synthetic_a');
  const ownerB = accountId(config, 'synthetic_b');
  const seed = { 'task_templates:synthetic_task': template };
  for (const collection of COLLECTIONS) {
    seed[collection + ':a_' + collection] = {
      _id: 'a_' + collection,
      ownerId: ownerA,
      synthetic: collection,
    };
    seed[collection + ':b_' + collection] = {
      _id: 'b_' + collection,
      ownerId: ownerB,
      synthetic: collection,
    };
  }
  const f = world({ seed });
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));
  const closed = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  const completed = await drainCleanup(f, 'synthetic_a', closed);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.jobId, closed.cleanup.jobId);

  const progress = completed.progress;
  assert.ok(progress && typeof progress === 'object');
  assert.equal(
    Object.values(progress).reduce((sum, count) => sum + count, 0),
    COLLECTIONS.length,
  );
  for (const collection of COLLECTIONS) {
    assert.equal(rowsOf(f.fixture.inspect(), collection, ownerA).length, 0, collection);
    assert.equal(rowsOf(f.fixture.inspect(), collection, ownerB).length, 1, collection);
  }
  const rows = f.fixture.inspect();
  assert.equal(rows['accounts:' + ownerA].status, 'disabled');
  assert.equal(rows['accounts:' + ownerB].status, 'active');
  assert.ok(rows['task_templates:synthetic_task']);
  assert.equal(cleanupJobs(rows).length, 1);
  assert.equal(cleanupJobs(rows)[0].state, 'completed');
  // A is still refused and a preference read never falls back to defaults.
  error(
    await f.call('synthetic_a', 'account.preferences', { operation: 'get' }),
    'ACCOUNT_DISABLED',
  );
  ok(await f.call('synthetic_b', 'account.preferences', { operation: 'get' }));
});

test('W6-JF-C03 a progress receipt only reads the job it was issued for', async () => {
  const f = world();
  ok(await f.call('synthetic_a', 'account.session'));
  ok(await f.call('synthetic_b', 'account.session'));
  const closed = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  error(
    await f.call('synthetic_a', 'account.cleanupStatus', {
      jobId: 'synthetic_other_job',
      receipt: closed.receipt,
    }),
    'FORBIDDEN',
  );
  error(
    await f.call('synthetic_a', 'account.cleanupStatus', {
      jobId: closed.cleanup.jobId,
      receipt: 'forged_receipt',
    }),
    'FORBIDDEN',
  );
  // The receipt is a bearer capability for progress counts only; another signed-in
  // account without the token is refused before any job read.
  error(
    await f.call('synthetic_b', 'account.cleanupStatus', {
      jobId: closed.cleanup.jobId,
    }),
    'FORBIDDEN',
  );
});

test('W6-JF-C04 a failed close commit leaves the account active and no orphan job', async () => {
  let failing = false;
  const f = world({
    fail: ({ collection, operation }) =>
      failing && collection === 'accounts' && operation === 'update',
  });
  const ownerA = accountId(config, 'synthetic_a');
  ok(await f.call('synthetic_a', 'account.session'));
  failing = true;
  error(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }), 'CONFLICT');
  failing = false;
  assert.equal(f.fixture.inspect()['accounts:' + ownerA].status, 'active');
  assert.equal(cleanupJobs(f.fixture.inspect()).length, 0);
  const closed = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  assert.equal(closed.cleanup.state, 'pending');
  assert.equal(cleanupJobs(f.fixture.inspect()).length, 1);
});

test('W6-JF-C05 repeated close reuses one job before and after cleanup', async () => {
  const f = world();
  ok(await f.call('synthetic_a', 'account.session'));
  const first = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  const second = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  assert.equal(second.cleanup.jobId, first.cleanup.jobId);
  assert.equal(second.cleanup.state, 'pending');
  // Same job and same clock produce the same deterministic receipt; a later
  // close after expiry issues a new one (covered by production-lifecycle).
  assert.equal(second.receipt, first.receipt);
  assert.equal(cleanupJobs(f.fixture.inspect()).length, 1);

  const completed = await drainCleanup(f, 'synthetic_a', first);
  assert.equal(completed.state, 'completed');
  const third = ok(await f.call('synthetic_a', 'account.close', { confirm: 'CLOSE' }));
  assert.equal(third.cleanup.jobId, first.cleanup.jobId);
  assert.equal(third.cleanup.state, 'completed');
  assert.equal(cleanupJobs(f.fixture.inspect()).length, 1);
});
