const test = require('node:test');
const assert = require('node:assert/strict');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createValidationDatabase } = require('../tools/business-validation/database');
const { runValidation, inspectValidation } = require('../tools/business-validation/suite');
const { createValidationEntry } = require('../tools/business-validation/index');
const { operatorFingerprint } = require('../tools/h03-probe/index');
const config = require('../tools/business-validation/config');
const options = { nativeDatabase: true, validationReads: true, conflictScope: 'written-documents' };

test('fixed business validation exercises actual locked SDK with offline transport only', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb, inspect, calls }) => {
      const db = createValidationDatabase(nativeDb);
      assert.deepEqual(await inspectValidation(db), { status: 'not-started', report: null });
      const report = await runValidation(db);
      assert.equal(report.failed, 0, JSON.stringify(report));
      assert.equal(report.passed, 9);
      assert.equal(report.productionEnabled, false);
      assert.equal((await inspectValidation(db)).status, 'completed');
      const original = inspect();
      await assert.rejects(runValidation(db), (error) => error.code === 'CONFLICT');
      assert.deepEqual(inspect(), original);
      assert.ok(
        calls
          .filter((c) => c.params.collectionName)
          .every((c) => Object.values(config.collections).includes(c.params.collectionName)),
      );
      assert.ok(
        Object.values(inspect()).every(
          (row) => row.runId === config.runId && row.probeTag === config.tag,
        ),
      );
    },
    options,
  );
});

test('validation adapter rejects unknown collections, nontransactional writes, tx scans and foreign rows', async () => {
  const foreign = { _id: 'old_batch', probeTag: 'old_tag', runId: 'old_run', status: 'retained' };
  await withOfflineWxDatabase(
    { [config.collections.accounts + ':old_batch']: foreign },
    async ({ nativeDb, inspect }) => {
      const db = createValidationDatabase(nativeDb);
      assert.throws(() => db.collection('preferences'), /prohibited/);
      await assert.rejects(
        db
          .collection('accounts')
          .doc('new_row')
          .set({ data: { status: 'active' } }),
        /transactional/,
      );
      await assert.rejects(
        db.runTransaction((tx) => tx.collection('accounts').where({ openid: 'spoof' }).get()),
        /deterministic/,
      );
      await assert.rejects(
        db.runTransaction((tx) =>
          tx
            .collection('accounts')
            .doc('old_batch')
            .set({ data: { status: 'replaced' } }),
        ),
        /Foreign/,
      );
      assert.deepEqual(inspect()[config.collections.accounts + ':old_batch'], foreign);
    },
    options,
  );
});

test('fixed validation controller denies cleanup, arbitrary batches and client-supplied identity before DB opens', async () => {
  let opened = 0;
  const entry = createValidationEntry({
    context: () => ({ ENV: config.environmentId, APPID: config.appId, OPENID: 'synthetic_caller' }),
    fingerprint: () => operatorFingerprint('different_caller'),
    openDatabase: () => {
      opened++;
      throw new Error('No database');
    },
  });
  assert.equal(
    (await entry({ operation: 'cleanup', runId: config.runId })).error.code,
    'INVALID_REQUEST',
  );
  assert.equal(
    (await entry({ operation: 'run', runId: 'h03_other_batch' })).error.code,
    'INVALID_REQUEST',
  );
  assert.equal(
    (
      await entry({
        operation: 'run',
        runId: config.runId,
        userInfo: { OPENID: 'different_caller' },
      })
    ).error.code,
    'FORBIDDEN',
  );
  assert.equal(opened, 0);
});

test('read-only inspection accepts trusted configured caller and ignores transport metadata', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const entry = createValidationEntry({
        context: () => ({
          ENV: config.environmentId,
          APPID: config.appId,
          OPENID: 'synthetic_caller',
        }),
        fingerprint: () => operatorFingerprint('synthetic_caller'),
        openDatabase: () => createValidationDatabase(nativeDb),
      });
      const result = await entry({
        operation: 'inspect',
        runId: config.runId,
        tcbContext: { ENV: 'spoof' },
      });
      assert.equal(result.ok, true);
      assert.equal(result.data.status, 'not-started');
    },
    options,
  );
});
