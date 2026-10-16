const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');
const https = require('node:https');
const cloudRequire = createRequire(
  path.resolve(__dirname, '../cloudfunctions/moodsky/package.json'),
);
const cloud = cloudRequire('wx-server-sdk');
const { Db } = cloudRequire('@cloudbase/database');
cloud.init({ env: 'synthetic-offline-sdk-errors' });

// WX database construction resets Db.reqClass. Replace it afterwards, before
// operations, and block network fallback independently of the SDK transport.
async function characterize(failAction, backendCode) {
  const db = cloud.database({ throwOnNotFound: false });
  const original = Db.reqClass;
  const networkMethods = [
    [http, 'request'],
    [http, 'get'],
    [https, 'request'],
    [https, 'get'],
  ];
  const originals = networkMethods.map(([module, name]) => module[name]);
  let networkCalls = 0;
  for (const [module, name] of networkMethods) {
    module[name] = () => {
      networkCalls++;
      throw new Error('Network forbidden in offline fixture');
    };
  }
  const actions = [];
  const unexpected = [];
  let callbacks = 0;
  let failures = 0;
  class OfflineRequest {
    async send(action) {
      actions.push(action);
      if (
        ![
          'database.startTransaction',
          'database.modifyDocument',
          'database.commitTransaction',
          'database.abortTransaction',
        ].includes(action)
      ) {
        unexpected.push(action);
        throw new Error('Unexpected offline operation');
      }
      if (action === failAction && failures === 0) {
        failures++;
        return { code: backendCode, message: 'synthetic error fixture' };
      }
      if (action === 'database.startTransaction') {
        return { transactionId: 'synthetic_' + actions.length };
      }
      return action === 'database.modifyDocument' ? { data: { updated: 1 } } : {};
    }
  }
  Db.reqClass = OfflineRequest;
  let result = null;
  let caught = null;
  try {
    assert.equal(db._db.constructor, Db);
    result = await db.runTransaction(async (transaction) => {
      callbacks++;
      await transaction
        .collection('synthetic_only')
        .doc('synthetic_doc')
        .update({ data: { value: 1 } });
      return 'synthetic-success';
    }, 2);
  } catch (error) {
    caught = { code: error.code || null, errCode: error.errCode ?? null };
  } finally {
    Db.reqClass = original;
    networkMethods.forEach(([module, name], index) => {
      module[name] = originals[index];
    });
  }
  assert.equal(networkCalls, 0);
  assert.deepEqual(unexpected, []);
  assert.equal(failures, 1);
  return { result, caught, callbacks, actions };
}

for (const [code, expected] of [
  ['DATABASE_TRANSACTION_CONFLICT', -501001],
  ['SYS_ERR', -501001],
  ['SYNTHETIC_UNMAPPED_CODE', -501001],
  ['DATABASE_REQUEST_FAILED', -502001],
]) {
  test('locked SDK update boundary preserves ambiguity for ' + code, async () => {
    const observed = await characterize('database.modifyDocument', code);
    assert.deepEqual(observed.caught, { code: null, errCode: expected });
    assert.equal(observed.callbacks, 1);
    assert.equal(observed.result, null);
    assert.deepEqual(observed.actions, [
      'database.startTransaction',
      'database.modifyDocument',
      'database.abortTransaction',
    ]);
  });
}

test('locked SDK recognizes a symbolic conflict at commit and retries its callback', async () => {
  const observed = await characterize(
    'database.commitTransaction',
    'DATABASE_TRANSACTION_CONFLICT',
  );
  assert.equal(observed.caught, null);
  assert.equal(observed.result, 'synthetic-success');
  assert.equal(observed.callbacks, 2);
  assert.deepEqual(observed.actions, [
    'database.startTransaction',
    'database.modifyDocument',
    'database.commitTransaction',
    'database.startTransaction',
    'database.modifyDocument',
    'database.commitTransaction',
  ]);
});
