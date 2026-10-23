const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');
const https = require('node:https');
const { createProbeDatabase } = require('../tools/h03-probe/database');
const config = require('../tools/h03-probe/config');
const cloudRequire = createRequire(
  path.resolve(__dirname, '../cloudfunctions/moodsky/package.json'),
);
const nativeSdk = cloudRequire('@cloudbase/node-sdk');
const { Db } = cloudRequire('@cloudbase/database');
const { EJSON } = cloudRequire('bson');

async function offline(work, fail = () => null) {
  // Construct the public native client before replacing its synthetic transport.
  const native = nativeSdk.init({ env: 'synthetic-h03-symbolic' }).database();
  const original = Db.reqClass;
  const calls = [];
  let serial = 0;
  const row = { _id: 'synthetic_document', probeTag: config.probeTag, value: 1 };
  class Request {
    async send(action, params = {}) {
      calls.push({ action, params });
      assert(
        [
          'database.startTransaction',
          'database.modifyDocument',
          'database.commitTransaction',
          'database.abortTransaction',
          'database.getDocument',
          'database.insertDocument',
          'database.calculateDocument',
          'database.removeDocument',
        ].includes(action),
      );
      const code = fail(action, params, calls);
      if (code) {
        return { code, message: 'SYNTHETIC private backend detail' };
      }
      if (action === 'database.startTransaction') {
        return { transactionId: 'synthetic_' + ++serial };
      }
      if (action === 'database.modifyDocument') {
        return { data: { updated: 1, upsert_id: row._id } };
      }
      if (action === 'database.getDocument') {
        return { data: { list: [EJSON.stringify(row)] } };
      }
      if (action === 'database.insertDocument') {
        return { data: { insertedIds: [row._id] } };
      }
      if (action === 'database.calculateDocument') {
        return { data: { total: 1 } };
      }
      if (action === 'database.removeDocument') {
        return { data: { deleted: 1 } };
      }
      return {};
    }
  }
  const methods = [
    [http, 'request'],
    [http, 'get'],
    [https, 'request'],
    [https, 'get'],
  ];
  const originals = methods.map(([module, key]) => module[key]);
  let networkCalls = 0;
  methods.forEach(([module, key]) => {
    module[key] = () => {
      networkCalls++;
      throw new Error('Real network forbidden.');
    };
  });
  Db.reqClass = Request;
  try {
    return await work(createProbeDatabase(native), calls, row);
  } finally {
    Db.reqClass = original;
    methods.forEach(([module, key], index) => {
      module[key] = originals[index];
    });
    assert.equal(networkCalls, 0);
  }
}

for (const action of ['database.modifyDocument', 'database.commitTransaction']) {
  test('H03 native symbolic boundary retries exact conflict at ' + action, async () => {
    let failed = false;
    await offline(
      async (db, calls) => {
        let callbacks = 0;
        const result = await db.runTransaction(async (tx) => {
          callbacks++;
          await tx
            .collection(config.collections.accounts)
            .doc('synthetic_document')
            .update({ data: { operationFence: 1 } });
          return 'synthetic-success';
        }, config.retryCount);
        assert.equal(result, 'synthetic-success');
        assert.equal(callbacks, 2);
        assert.equal(
          calls.filter((item) => item.action === 'database.commitTransaction').length,
          action === 'database.commitTransaction' ? 2 : 1,
        );
      },
      (current) => {
        if (current === action && !failed) {
          failed = true;
          return 'DATABASE_TRANSACTION_CONFLICT';
        }
        return null;
      },
    );
  });
}

for (const code of ['SYS_ERR', 'SYNTHETIC_UNMAPPED_CODE', -501001]) {
  test('H03 native boundary does not retry or commit ambiguous error ' + code, async () => {
    await offline(
      async (db, calls) => {
        let callbacks = 0;
        await assert.rejects(
          db.runTransaction(async (tx) => {
            callbacks++;
            await tx
              .collection(config.collections.accounts)
              .doc('synthetic_document')
              .update({ data: { operationFence: 1 } });
          }, config.retryCount),
          (error) => {
            assert.equal(error.code, code);
            assert.doesNotMatch(error.message, /private backend detail/);
            return true;
          },
        );
        assert.equal(callbacks, 1);
        assert.equal(
          calls.filter((item) => item.action === 'database.commitTransaction').length,
          0,
        );
        assert.equal(calls.filter((item) => item.action === 'database.abortTransaction').length, 1);
      },
      (action) => (action === 'database.modifyDocument' ? code : null),
    );
  });
}

test('H03 native conflicts respect the existing retry budget', async () => {
  await offline(
    async (db, calls) => {
      let callbacks = 0;
      await assert.rejects(
        db.runTransaction(async (tx) => {
          callbacks++;
          await tx
            .collection(config.collections.accounts)
            .doc('synthetic_document')
            .update({ data: { operationFence: 1 } });
        }, config.retryCount),
        { code: 'DATABASE_TRANSACTION_CONFLICT' },
      );
      assert.equal(callbacks, config.retryCount + 1);
      assert.equal(calls.filter((item) => item.action === 'database.commitTransaction').length, 0);
    },
    (action) => (action === 'database.modifyDocument' ? 'DATABASE_TRANSACTION_CONFLICT' : null),
  );
});

test('H03 native adapter forwards data envelopes once, projects cleanup counts and rejects business collections', async () => {
  await offline(async (db, calls, row) => {
    const collection = db.collection(config.collections.accounts);
    const document = collection.doc(row._id);
    await collection.add({ data: row });
    assert.deepEqual((await document.get()).data, [row]);
    const content = { probeTag: row.probeTag, value: row.value };
    await document.set({ data: content });
    await db.runTransaction(async (tx) => {
      const target = tx.collection(config.collections.accounts).doc(row._id);
      assert.deepEqual((await target.get()).data, row);
      await target.update({ data: { value: 2 } });
    }, config.retryCount);
    const query = collection.where({ probeTag: config.probeTag });
    assert.equal((await query.count()).total, 1);
    assert.deepEqual((await query.limit(100).get()).data, [row]);
    assert.deepEqual(await query.remove(), { stats: { removed: 1 } });
    assert.deepEqual(
      EJSON.parse(calls.find((item) => item.action === 'database.insertDocument').params.data[0]),
      row,
    );
    const writes = calls.filter((item) => item.action === 'database.modifyDocument');
    assert.deepEqual(EJSON.parse(writes[0].params.data), content);
    assert.deepEqual(EJSON.parse(writes[1].params.data), { $set: { value: 2 } });
    const before = calls.length;
    assert.throws(() => db.collection('journals'), /isolated probe collections/);
    await assert.rejects(
      db.runTransaction((tx) => tx.collection('accounts'), 0),
      /isolated probe collections/,
    );
    assert(calls.slice(before).every((item) => !item.params.collectionName));
  });
});

for (const action of [
  'database.getDocument',
  'database.insertDocument',
  'database.calculateDocument',
  'database.removeDocument',
]) {
  test('H03 native boundary rejects returned errors for ' + action, async () => {
    await offline(
      async (db) => {
        const collection = db.collection(config.collections.accounts);
        const operations = {
          'database.getDocument': () => collection.doc('synthetic_document').get(),
          'database.insertDocument': () => collection.add({ data: { value: 1 } }),
          'database.calculateDocument': () =>
            collection.where({ probeTag: config.probeTag }).count(),
          'database.removeDocument': () => collection.where({ probeTag: config.probeTag }).remove(),
        };
        await assert.rejects(operations[action](), { code: 'SYNTHETIC_UNMAPPED_CODE' });
      },
      (current) => (current === action ? 'SYNTHETIC_UNMAPPED_CODE' : null),
    );
  });
}
