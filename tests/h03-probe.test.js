const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const config = require('../tools/h03-probe/config');
const { createProbe, operatorFingerprint } = require('../tools/h03-probe/index');
const {
  canonical,
  idFor,
  safeCode,
  cleanupRun,
  createHarness,
} = require('../tools/h03-probe/suite');
const { buildProbe } = require('../scripts/package-h03-probe');

const runId = 'h03_local_checks_001';
const trusted = {
  ENV: config.environmentId,
  APPID: config.appId,
  OPENID: 'synthetic-context-only',
};
function adapter(options = {}) {
  const calls = { database: 0, suite: 0 };
  const db = {};
  const probe = createProbe({
    readTrustedContext: () => options.context || trusted,
    readOperatorFingerprint: () => options.fingerprint,
    openDatabase: () => {
      calls.database += 1;
      return db;
    },
    executeSuite: async (actual, batch) => {
      calls.suite += 1;
      assert.equal(actual, db);
      assert.equal(batch, runId);
      if (options.failure !== undefined) {
        throw options.failure;
      }
      return { stage: 'injected-local-adapter', cloudTestsExecuted: false };
    },
  });
  return { probe, calls };
}

test('H03 identity registration returns only caller fingerprint without database access', async () => {
  const { probe, calls } = adapter();
  const result = await probe({ operation: 'identify' });
  assert.equal(result.data.operatorFingerprint, operatorFingerprint(trusted.OPENID));
  assert.equal(result.data.databaseAccessed, false);
  assert(!JSON.stringify(result).includes(trusted.OPENID));
  assert.equal(calls.database, 0);
});

test('H03 run stays closed without configured operator or with another operator', async () => {
  for (const fingerprint of [
    undefined,
    '',
    'bad',
    operatorFingerprint('another-synthetic-context'),
  ]) {
    const { probe, calls } = adapter({ fingerprint });
    assert.equal((await probe({ operation: 'run', runId })).error.code, 'FORBIDDEN');
    assert.equal(calls.database, 0);
  }
});

test('H03 trusted environment, app and platform identity must all match', async () => {
  for (const context of [
    {},
    { ...trusted, ENV: 'other-env' },
    { ...trusted, APPID: 'other-app' },
    { ...trusted, OPENID: '' },
  ]) {
    const { probe, calls } = adapter({ context, fingerprint: operatorFingerprint(trusted.OPENID) });
    assert.equal((await probe({ operation: 'run', runId })).error.code, 'FORBIDDEN');
    assert.equal(calls.database, 0);
  }
});

test('H03 rejects caller identity, resource names and arbitrary business input', async () => {
  for (const key of [
    'OPENID',
    'ownerId',
    'operatorFingerprint',
    'collection',
    'payload',
    'token',
  ]) {
    const { probe, calls } = adapter({ fingerprint: operatorFingerprint(trusted.OPENID) });
    assert.equal(
      (await probe({ operation: 'run', runId, [key]: 'synthetic' })).error.code,
      'INVALID_REQUEST',
    );
    assert.equal(calls.database, 0);
  }
});

test('H03 run ID is a bounded string and does not coerce arrays', async () => {
  for (const value of [undefined, '', [runId], 42, 'h03_../business', 'h03_' + 'a'.repeat(33)]) {
    const { probe, calls } = adapter({ fingerprint: operatorFingerprint(trusted.OPENID) });
    assert.equal((await probe({ operation: 'run', runId: value })).error.code, 'INVALID_REQUEST');
    assert.equal(calls.database, 0);
  }
});

test('H03 cleanup requires its exact separate confirmation', async () => {
  for (const confirm of [undefined, '', true, 'DELETE_BUSINESS']) {
    const { probe, calls } = adapter({ fingerprint: operatorFingerprint(trusted.OPENID) });
    assert.equal(
      (await probe({ operation: 'cleanup', runId, confirm })).error.code,
      'INVALID_REQUEST',
    );
    assert.equal(calls.database, 0);
  }
});

test('H03 authorized run routes only to its isolated suite', async () => {
  const { probe, calls } = adapter({ fingerprint: operatorFingerprint(trusted.OPENID) });
  const result = await probe({ operation: 'run', runId });
  assert.equal(result.data.stage, 'injected-local-adapter');
  assert.equal(result.data.cloudTestsExecuted, false);
  assert.equal(calls.database, 1);
  assert.equal(calls.suite, 1);
});

test('H03 exceptions, null throws and raw platform messages do not leak', async () => {
  for (const failure of [
    new Error('synthetic-private-body-and-secret'),
    null,
    { code: 'UNKNOWN', message: 'synthetic-secret' },
  ]) {
    const { probe } = adapter({ fingerprint: operatorFingerprint(trusted.OPENID), failure });
    const result = await probe({ operation: 'run', runId });
    assert.equal(result.error.code, 'INTERNAL_ERROR');
    assert(!JSON.stringify(result).includes('synthetic-secret'));
    assert(!JSON.stringify(result).includes('private-body'));
  }
});

test('H03 canonical input keeps optional presence, tag order and exact Unicode text', () => {
  assert.equal(
    canonical({ date: '2026-10-14', weather: 'SUNNY' }),
    canonical({ weather: 'SUNNY', date: '2026-10-14' }),
  );
  assert.notEqual(canonical({ date: '2026-10-14' }), canonical({ date: '2026-10-14', text: '' }));
  assert.notEqual(canonical({ tags: ['REST', 'STUDY'] }), canonical({ tags: ['STUDY', 'REST'] }));
  assert.notEqual(canonical({ text: '\u00e9' }), canonical({ text: 'e\u0301' }));
  assert.notEqual(canonical({ text: ' ' }), canonical({ text: '' }));
});

test('H03 document keys distinguish batches, owners and actions', () => {
  const original = idFor(runId, 'receipt', 'owner-a', 'journal.upsert', 'req_a_001');
  assert(/^[a-f0-9]{32}$/.test(original));
  assert.equal(original, idFor(runId, 'receipt', 'owner-a', 'journal.upsert', 'req_a_001'));
  assert.notEqual(
    original,
    idFor('h03_other_batch_001', 'receipt', 'owner-a', 'journal.upsert', 'req_a_001'),
  );
  assert.notEqual(original, idFor(runId, 'receipt', 'owner-b', 'journal.upsert', 'req_a_001'));
  assert.notEqual(original, idFor(runId, 'receipt', 'owner-a', 'journal.delete', 'req_a_001'));
});

test('H03 safe error evidence never returns error messages or stacks', () => {
  assert.equal(
    safeCode({ code: 'DATABASE_TRANSACTION_CONFLICT', message: 'synthetic-secret' }),
    'DATABASE_TRANSACTION_CONFLICT',
  );
  assert.equal(safeCode({ errCode: -502001, errMsg: 'synthetic-secret' }), '-502001');
  assert.equal(safeCode({ code: 'http://secret/value' }), 'UNCLASSIFIED_SDK_ERROR');
  assert.equal(safeCode(null), 'UNCLASSIFIED_SDK_ERROR');
});

function cleanupFixture(status, moveBeforeRemoval = false) {
  const tables = {};
  const deleted = [];
  const markerId = idFor(runId, 'manifest');
  for (const collection of Object.values(config.collections)) {
    tables[collection] = new Map();
    tables[collection].set('own-record', { _id: 'own-record', probeTag: config.probeTag, runId });
    tables[collection].set('other-record', {
      _id: 'other-record',
      probeTag: config.probeTag,
      runId: 'h03_other_batch_001',
    });
  }
  tables[config.collections.accounts].set(markerId, {
    _id: markerId,
    probeTag: config.probeTag,
    runId,
    status,
  });
  const db = {
    collection(name) {
      assert(Object.values(config.collections).includes(name));
      const table = tables[name];
      return {
        doc(id) {
          return {
            async get() {
              return { data: table.get(id) || null };
            },
            async update(options) {
              assert.deepEqual(Object.keys(options), ['data']);
              table.set(id, { ...table.get(id), ...options.data });
            },
            async remove() {
              deleted.push({ name, id });
              table.delete(id);
            },
          };
        },
        where(filter) {
          const keys = Object.keys(filter).sort();
          assert(
            JSON.stringify(keys) === JSON.stringify(['probeTag', 'runId']) ||
              JSON.stringify(keys) === JSON.stringify(['_id', 'probeTag', 'runId']),
          );
          const matching = () =>
            [...table.values()].filter(
              (record) =>
                record.probeTag === filter.probeTag &&
                record.runId === filter.runId &&
                (filter._id === undefined || record._id === filter._id),
            );
          return {
            async remove() {
              assert.equal(typeof filter._id, 'string');
              if (moveBeforeRemoval) {
                table.set(filter._id, { ...table.get(filter._id), runId: 'h03_other_batch_001' });
              }
              const records = matching();
              for (const record of records) {
                deleted.push({ name, id: record._id });
                table.delete(record._id);
              }
              return { stats: { removed: records.length } };
            },
            async count() {
              return { total: matching().length };
            },
            limit() {
              return {
                async get() {
                  return { data: matching() };
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, tables, deleted, markerId };
}

test('H03 cleanup removes only matching synthetic batch and retains closed marker', async () => {
  const fixture = cleanupFixture('completed');
  const report = await cleanupRun(fixture.db, runId);
  assert.equal(fixture.deleted.length, 4);
  for (const table of Object.values(fixture.tables)) {
    assert(table.has('other-record'));
    assert(!table.has('own-record'));
  }
  assert.equal(fixture.tables[config.collections.accounts].get(fixture.markerId).status, 'cleaned');
  assert.equal(report.remaining[config.collections.accounts], 1);
  assert(report.retainsClosedRunMarker);
});

test('H03 cleanup refuses a running batch', async () => {
  const fixture = cleanupFixture('running');
  await assert.rejects(cleanupRun(fixture.db, runId), (error) => error.code === 'CONFLICT');
  assert.equal(fixture.deleted.length, 0);
});

test('H03 cleanup rechecks batch ownership in the atomic removal filter', async () => {
  const fixture = cleanupFixture('completed', true);
  const report = await cleanupRun(fixture.db, runId);
  assert.equal(fixture.deleted.length, 0);
  for (const count of Object.values(report.removed)) {
    assert.equal(count, 0);
  }
  for (const table of Object.values(fixture.tables)) {
    assert.equal(table.get('own-record').runId, 'h03_other_batch_001');
  }
});

function wxSdkFixture() {
  const cloudRequire = createRequire(
    path.resolve(__dirname, '../cloudfunctions/moodsky/package.json'),
  );
  const cloud = cloudRequire('wx-server-sdk');
  cloud.init({ env: 'synthetic-h03-sdk-envelope' });
  const db = cloud.database({ throwOnNotFound: false });
  const tables = {};
  const backendCollection = (name) => {
    assert(Object.values(config.collections).includes(name));
    const table = tables[name] || (tables[name] = new Map());
    return {
      async add(data) {
        assert.equal(typeof data, 'object');
        assert.equal(data.probeTag, config.probeTag);
        assert.equal(data.data, undefined);
        assert(!table.has(data._id));
        table.set(data._id, { ...data });
        return { id: data._id };
      },
      doc(id) {
        return {
          async get() {
            return { data: table.has(id) ? [{ ...table.get(id) }] : [] };
          },
          async set(data) {
            assert.equal(data.probeTag, config.probeTag);
            table.set(id, { ...data, _id: id });
            return { updated: 1 };
          },
          async update(data) {
            assert.equal(data.data, undefined);
            const record = { ...table.get(id) };
            for (const [key, value] of Object.entries(data)) {
              if (value && value.operator === 'remove') {
                delete record[key];
              } else {
                record[key] = value;
              }
            }
            table.set(id, record);
            return { updated: 1 };
          },
        };
      },
    };
  };
  // Only the transport boundary is injected; calls still use the locked wx SDK wrappers.
  db._db.collection = backendCollection;
  db._db.runTransaction = async (callback, retries) => {
    assert.equal(retries, config.retryCount);
    return callback({ collection: backendCollection });
  };
  return { db, tables };
}

test('H03 locked wx SDK accepts probe write envelopes and empty reads without a network', async () => {
  const { db, tables } = wxSdkFixture();
  const harness = createHarness(db, runId);
  const actor = await harness.actor('sdk-envelope');
  const first = {
    apiVersion: '1',
    requestId: 'req_sdk_shape_001',
    action: 'journal.upsert',
    payload: { date: '2026-10-14', weather: 'SUNNY', expectedVersion: 0 },
  };
  const created = await harness.mutate(actor, first);
  assert(created.ok && created.version === 1);
  const replay = await harness.mutate(actor, first);
  assert(replay.replayed && replay.version === 1);
  const receipt = [...tables[config.collections.receipts].values()][0];
  assert.equal(receipt.text, undefined);
  assert.equal(receipt.weather, undefined);
  assert.equal(receipt.tags, undefined);
  assert.equal(receipt.result.text, undefined);
});

test('H03 locked wx SDK forwards explicit field removal and keeps recreation generations', async () => {
  const { db, tables } = wxSdkFixture();
  const harness = createHarness(db, runId);
  const actor = await harness.actor('sdk-deletion');
  const save = (requestId) => ({
    apiVersion: '1',
    requestId,
    action: 'journal.upsert',
    payload: { date: '2026-10-14', weather: 'SUNNY', text: '合成 SDK 样例', expectedVersion: 0 },
  });
  const initialRequest = save('req_sdk_delete_seed');
  const first = await harness.mutate(actor, initialRequest);
  const deletion = {
    apiVersion: '1',
    requestId: 'req_sdk_delete_001',
    action: 'journal.delete',
    payload: { date: '2026-10-14', expectedVersion: 1 },
  };
  assert((await harness.mutate(actor, deletion)).deleted);
  const tombstone = [...tables[config.collections.journals].values()][0];
  assert.equal(tombstone.version, 2);
  for (const key of ['text', 'weather', 'tags', 'entryId']) {
    assert.equal(tombstone[key], undefined);
  }
  const next = await harness.mutate(actor, save('req_sdk_delete_new'));
  assert(next.ok && next.version === 3 && next.entryId !== first.entryId);
  assert.equal((await harness.mutate(actor, initialRequest)).code, 'CONFLICT');
  assert((await harness.mutate(actor, deletion)).deleted);
  assert.equal([...tables[config.collections.journals].values()][0].version, 3);
});

test('H03 bundle is complete, retains exact dependency locks and rejects invalid request before SDK load', async () => {
  const { target, manifest } = buildProbe();
  const probeLock = require('../tools/h03-probe/package-lock.json');
  const cloudRequire = createRequire(
    path.resolve(__dirname, '../cloudfunctions/moodsky/package.json'),
  );
  for (const name of ['wx-server-sdk', '@cloudbase/node-sdk', '@cloudbase/database']) {
    assert.equal(
      cloudRequire(name + '/package.json').version,
      probeLock.packages['node_modules/' + name].version,
      'Offline SDK tests must use the actual probe lock: ' + name,
    );
  }
  assert.equal(manifest.databaseAdapter, 'cloudbase-native-symbolic-v1');
  assert.deepEqual(fs.readdirSync(target).sort(), [
    'index.js',
    'package-lock.json',
    'package.json',
    'probe-manifest.json',
  ]);
  assert.deepEqual(
    fs.readFileSync(path.join(target, 'package-lock.json')),
    fs.readFileSync(path.resolve(__dirname, '../tools/h03-probe/package-lock.json')),
  );
  for (const [file, digest] of Object.entries(manifest.hashes)) {
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(target, file)))
        .digest('hex'),
      digest,
    );
  }
  assert(manifest.collections.every((name) => name.startsWith('h03_probe_')));
  assert.equal(manifest.indexes.length, 2);
  assert.deepEqual(manifest.clientRule, { read: false, write: false });
  assert.equal(manifest.businessCollectionsAllowed, false);
  const bundled = require(path.join(target, 'index.js'));
  assert.equal((await bundled.main({ operation: 'journal.upsert' })).error.code, 'INVALID_REQUEST');
});
