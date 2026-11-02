const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createWeek3Entry } = require('../tools/week3-validation/index');
const { createValidationDatabase } = require('../tools/business-validation/database');
const config = require('../tools/week3-validation/config');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { buildWeek3Validation } = require('../scripts/package-week3-validation');
const { commandSources } = require('../tools/week3-validation/commands');
const vm = require('node:vm');
const context = { APPID: config.appId, ENV: config.environmentId, OPENID: 'synthetic_w3_operator' };
const fingerprint = crypto
  .createHash('sha256')
  .update('moodsky-h03-operator:' + context.OPENID)
  .digest('hex');
const event = (operation, extra = {}) => ({ operation, runId: config.runId, ...extra });
const options = { nativeDatabase: true, validationReads: true, conflictScope: 'written-documents' };
function entry(nativeDb, overrides = {}) {
  return createWeek3Entry({
    context: () => context,
    fingerprint: () => fingerprint,
    openDatabase: () => createValidationDatabase(nativeDb, config),
    now: () => new Date('2026-10-27T05:00:00.000Z'),
    instanceTag: 'a'.repeat(32),
    ...overrides,
  });
}
async function complete(call) {
  assert.equal((await call(event('prepare'))).data.seededDays, 90);
  for (let i = 0; i < 4; i++) {
    assert.equal((await call(event('worker', { worker: i }))).ok, true);
  }
  assert.equal((await call(event('read'))).data.passed, true);
  return (await call(event('inspect'))).data;
}

test('W3 fixed sequential SDK model reports capability success without inventing cross-instance proof', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, calls, inspect }) => {
      const report = await complete(entry(nativeDb));
      assert.equal(report.capabilityChecksPassed, true);
      assert.equal(report.distinctCreateRuntimeTagsObserved, false);
      assert.equal(report.distinctStopRuntimeTagsObserved, false);
      assert.equal(report.additionalCreateCallbacksObserved, false);
      assert.equal(report.providerInstanceIdentityVerified, false);
      assert.equal(report.crossInstanceValidationComplete, false);
      assert.equal(report.technicalValidationComplete, false);
      assert.deepEqual(
        report.windows.map((row) => row.recordCount),
        [7, 30, 90],
      );
      assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC W3|合成窗口名称|openid|weatherName/);
      assert.ok(
        Object.values(inspect()).every(
          (row) => row.probeTag === config.tag && row.runId === config.runId,
        ),
      );
      assert.ok(
        calls
          .filter((call) => call.params.collectionName)
          .every((call) =>
            [
              config.collections.accounts,
              config.collections.journals,
              config.collections.receipts,
            ].includes(call.params.collectionName),
          ),
      );
    },
    options,
  );
});

test('W3 independent synthetic entries share native transactions and preserve create/disable races', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const control = entry(nativeDb);
      await control(event('prepare'));
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, worker) =>
          entry(nativeDb, { instanceTag: String(worker).repeat(32) })(event('worker', { worker })),
        ),
      );
      assert.ok(results.every((result) => result.ok));
      assert.equal((await control(event('read'))).data.passed, true);
      const report = (await control(event('inspect'))).data;
      assert.equal(report.createPassed, true);
      assert.equal(report.stopPassed, true);
      assert.equal(report.capabilityChecksPassed, true);
      assert.equal(report.distinctCreateRuntimeTagsObserved, true); // Synthetic labels, not platform IDs.
      assert.equal(report.distinctStopRuntimeTagsObserved, true);
      assert.equal(report.additionalCreateCallbacksObserved, true);
      assert.equal(report.providerInstanceIdentityVerified, false);
    },
    options,
  );
});

test('W3 claimed prepare, worker and read never repeat writes; premature read does not claim or mutate', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const call = entry(nativeDb);
      await call(event('prepare'));
      const initial = inspect();
      assert.equal((await call(event('read'))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), initial);
      assert.equal((await call(event('prepare'))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), initial);
      await call(event('worker', { worker: 0 }));
      const first = inspect();
      assert.equal((await call(event('worker', { worker: 0 }))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), first);
      for (const worker of [1, 2, 3]) {
        await call(event('worker', { worker }));
      }
      await call(event('read'));
      const done = inspect();
      assert.equal((await call(event('read'))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), done);
    },
    options,
  );
});

test('W3 control denies unapproved operations, batches, dates and identity spoofing before database opens', async () => {
  let opens = 0;
  const base = {
    openDatabase() {
      opens++;
      throw Error('Must not open');
    },
  };
  for (const value of [
    null,
    [],
    event('run'),
    event('cleanup'),
    event('worker', { worker: '0' }),
    event('worker', { worker: -1 }),
    event('worker', { worker: 4 }),
    event('prepare', { worker: 0 }),
    { ...event('prepare'), runId: 'h03_foreign_batch' },
    event('prepare', { ownerId: 'spoof' }),
  ]) {
    assert.equal((await entry(null, base)(value)).error.code, 'INVALID_REQUEST');
  }
  for (const overrides of [
    { context: () => ({ ...context, APPID: 'foreign' }) },
    { context: () => ({ ...context, ENV: 'foreign' }) },
    { context: () => ({ ...context, OPENID: 'foreign' }) },
    { fingerprint: () => undefined },
    { now: () => new Date('2026-10-27T16:00:00.000Z') },
    { now: () => new Date('2026-10-26T15:59:59.999Z') },
  ]) {
    assert.equal(
      (await entry(null, { ...base, ...overrides })(event('prepare'))).error.code,
      'FORBIDDEN',
    );
  }
  assert.equal(opens, 0);
});

test('W3 expired writes are denied but fixed authorized inspection remains read-only', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const call = entry(nativeDb, { now: () => new Date('2026-10-28T00:00:00.000Z') });
      for (const request of [event('prepare'), event('worker', { worker: 0 }), event('read')]) {
        assert.equal((await call(request)).error.code, 'FORBIDDEN');
      }
      assert.equal(
        (await call({ ...event('inspect'), userInfo: { openId: 'spoof' }, tcbContext: {} })).data
          .status,
        'not-started',
      );
      assert.deepEqual(inspect(), {});
    },
    options,
  );
});

test('W3 adapter cannot touch deletion collection, business collections or retained foreign rows', async () => {
  const foreign = { _id: 'retained', probeTag: 'old', runId: 'old', text: 'SYNTHETIC retained' };
  await withOfflineWxDatabase(
    { [config.collections.accounts + ':retained']: foreign },
    async ({ nativeDb, inspect }) => {
      const db = createValidationDatabase(nativeDb, config);
      for (const name of ['deletion_markers', 'task_history', 'preferences', 'accounts_private']) {
        assert.throws(() => db.collection(name), /prohibited/);
      }
      await assert.rejects(
        db.runTransaction((tx) =>
          tx
            .collection('accounts')
            .doc('retained')
            .set({ data: { status: 'replaced' } }),
        ),
        /Foreign/,
      );
      assert.deepEqual(inspect()[config.collections.accounts + ':retained'], foreign);
    },
    options,
  );
});

test('W3 failed large-window check is retained and never reported as validated', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const call = entry(nativeDb);
      await call(event('prepare'));
      for (const worker of [0, 1, 2, 3]) {
        await call(event('worker', { worker }));
      }
      const row = Object.entries(inspect()).find(([key]) =>
        key.startsWith(config.collections.journals + ':'),
      );
      const db = createValidationDatabase(nativeDb, config);
      await db.runTransaction((tx) =>
        tx
          .collection('journals')
          .doc(row[1]._id)
          .update({ data: { weather: 'CORRUPT' } }),
      );
      const result = await call(event('read'));
      assert.equal(result.data.passed, false);
      assert.equal(result.data.failedCheck.stage, 'window_90');
      assert.equal((await call(event('inspect'))).data.capabilityChecksPassed, false);
      const before = inspect();
      assert.equal((await call(event('read'))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), before);
    },
    options,
  );
});

test('W3 partial preparation stays retained and cannot be restarted after a non-conflict SDK error', async () => {
  let inject = true;
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const call = entry(nativeDb);
      assert.equal((await call(event('prepare'))).error.code, 'INTERNAL_ERROR');
      assert.equal((await call(event('inspect'))).data.status, 'preparing');
      inject = false;
      const before = inspect();
      assert.equal((await call(event('prepare'))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), before);
    },
    {
      ...options,
      fail: (action, params) =>
        inject &&
        action === 'database.modifyDocument' &&
        params.collectionName === config.collections.journals
          ? 'SYS_ERR'
          : null,
    },
  );
});

test('W3 package is reproducible, fixed-scope, secret-free and never overwrites an output folder', () => {
  const first = buildWeek3Validation();
  const second = buildWeek3Validation();
  assert.deepEqual(first.manifest.hashes, second.manifest.hashes);
  assert.equal(first.manifest.workerCalls, 4);
  assert.equal(first.manifest.productionEnabled, false);
  assert.equal(first.manifest.newCloudAuthorizationRequired, true);
  assert.deepEqual(first.manifest.allowedCollections, ['accounts', 'journals', 'request_receipts']);
  for (const [file, expected] of Object.entries(first.manifest.hashes)) {
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(first.target, file)))
        .digest('hex'),
      expected,
    );
  }
  assert.throws(() => buildWeek3Validation({ outputRoot: first.target }), /new absolute/);
  assert.throws(
    () => buildWeek3Validation({ outputRoot: path.resolve(__dirname, '../not-a-deploy-folder') }),
    /outside/,
  );
  assert.equal(fs.existsSync(path.join(first.target, 'environment.local.js')), false);
});

test('W3 preparation never overwrites same-batch orphaned account or journal material', async () => {
  let retained;
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      await entry(nativeDb)(event('prepare'));
      const all = Object.entries(inspect());
      retained = [
        all.find(
          ([key, row]) => key.startsWith(config.collections.accounts + ':') && row.journalLayout,
        ),
        all.find(([key]) => key.startsWith(config.collections.journals + ':')),
      ];
    },
    options,
  );
  for (const [key, row] of retained) {
    await withOfflineWxDatabase(
      { [key]: row },
      async ({ nativeDb, inspect }) => {
        const call = entry(nativeDb);
        assert.equal((await call(event('prepare'))).error.code, 'CONFLICT');
        assert.deepEqual(inspect()[key], row);
      },
      options,
    );
  }
});

test('W3 read phase cannot create a replacement journal when disabling failed', async () => {
  let failDisable = false;
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect }) => {
      const call = entry(nativeDb);
      await call(event('prepare'));
      for (const worker of [0, 1, 2]) {
        await call(event('worker', { worker }));
      }
      failDisable = true;
      assert.equal((await call(event('worker', { worker: 3 }))).data.resultCode, 'INTERNAL_ERROR');
      const before = inspect();
      assert.equal((await call(event('read'))).error.code, 'CONFLICT');
      assert.deepEqual(inspect(), before);
      assert.equal((await call(event('inspect'))).data.stopPassed, false);
    },
    {
      ...options,
      fail: (action, params) =>
        failDisable &&
        action === 'database.modifyDocument' &&
        params.collectionName === config.collections.accounts &&
        params.data.includes('disabled')
          ? 'SYS_ERR'
          : null,
    },
  );
});

test('W3 IDE commands dispatch exactly four independent workers and never retry unknown results', async () => {
  const calls = [];
  const pending = [];
  const wx = {
    cloud: {
      init: (value) => assert.equal(value.env, config.environmentId),
      callFunction: (value) => {
        calls.push(JSON.parse(JSON.stringify(value)));
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      },
    },
  };
  const sources = commandSources();
  assert.deepEqual(Object.keys(sources), ['prepare', 'workers', 'read', 'inspect']);
  const result = vm.runInNewContext('(' + sources.workers + ')()', { wx });
  assert.equal(calls.length, 4); // All requests in flight before any one resolves.
  assert.deepEqual(
    calls.map((call) => call.data.worker),
    [0, 1, 2, 3],
  );
  assert.ok(
    calls.every((call) => call.name === config.functionName && call.data.runId === config.runId),
  );
  pending[0].reject({ errMsg: 'SENSITIVE_MESSAGE', errCode: -1 });
  for (const item of pending.slice(1)) {
    item.resolve({ result: { ok: true } });
  }
  const output = await result;
  assert.equal(output[0].state, 'unknown');
  assert.equal(calls.length, 4);
  assert.doesNotMatch(JSON.stringify(output), /SENSITIVE_MESSAGE/);
  for (const phase of ['prepare', 'read', 'inspect']) {
    let count = 0;
    await vm.runInNewContext('(' + sources[phase] + ')()', {
      wx: {
        cloud: {
          init() {},
          callFunction: async ({ data }) => {
            count++;
            assert.equal(data.operation, phase);
            assert.equal(data.runId, config.runId);
            return { result: { ok: true } };
          },
        },
      },
    });
    assert.equal(count, 1);
  }
});
