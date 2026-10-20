// Exercise the installed wx-server-sdk serializer/transaction wrapper, replacing only
// its transport. This fake server is NOT evidence of CloudBase isolation guarantees.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');
const https = require('node:https');
const cloudRequire = createRequire(
  path.resolve(__dirname, '../../cloudfunctions/moodsky/package.json'),
);
const cloud = cloudRequire('wx-server-sdk');
const { Db } = cloudRequire('@cloudbase/database');
const { EJSON } = cloudRequire('bson');
const clone = (value) => EJSON.parse(EJSON.stringify(value));

async function withOfflineWxDatabase(seed, work, { fail = () => null } = {}) {
  cloud.init({ env: 'synthetic-offline-journal-candidate' });
  const db = cloud.database({ throwOnNotFound: false });
  const originalTransport = Db.reqClass;
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
      throw new Error('Network forbidden in journal SDK fixture');
    };
  }
  let committed = clone(seed);
  let revision = 0;
  let serial = 0;
  const transactions = new Map();
  const calls = [];
  class OfflineRequest {
    async send(action, params = {}) {
      calls.push({ action, params: clone(params) });
      const failure = fail(action, params, calls);
      if (failure) {
        return { code: failure, message: 'SYNTHETIC injected transport failure' };
      }
      if (action === 'database.startTransaction') {
        const id = 'synthetic_tx_' + ++serial;
        transactions.set(id, { data: clone(committed), baseRevision: revision, writes: false });
        return { transactionId: id };
      }
      const tx = transactions.get(params.transactionId);
      assert.ok(tx, 'All operations must carry a current transaction ID');
      if (action === 'database.abortTransaction') {
        transactions.delete(params.transactionId);
        return {};
      }
      if (action === 'database.commitTransaction') {
        if (tx.baseRevision !== revision) {
          return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'SYNTHETIC commit conflict' };
        }
        if (tx.writes) {
          committed = tx.data;
          revision++;
        }
        transactions.delete(params.transactionId);
        return {};
      }
      assert.ok(
        ['database.getDocument', 'database.modifyDocument', 'database.removeDocument'].includes(
          action,
        ),
        action,
      );
      const query = EJSON.parse(params.query);
      assert.deepEqual(
        Object.keys(query),
        ['_id'],
        'Only deterministic document lookups are allowed',
      );
      const key = params.collectionName + ':' + query._id;
      if (action === 'database.removeDocument') {
        const exists = !!tx.data[key];
        if (exists) {
          delete tx.data[key];
          tx.writes = true;
        }
        return { data: { deleted: exists ? 1 : 0 } };
      }
      if (action === 'database.getDocument') {
        return { data: { list: tx.data[key] ? [EJSON.stringify(tx.data[key])] : [] } };
      }
      const data = EJSON.parse(params.data);
      if (params.merge) {
        assert.ok(
          data.$set && Object.keys(data).length === 1,
          'Only a partial field update is expected',
        );
        const exists = !!tx.data[key];
        if (exists) {
          tx.data[key] = { ...tx.data[key] };
          for (const [field, value] of Object.entries(data.$set)) {
            const parts = field.split('.');
            assert.ok(
              parts.every((part) => !['__proto__', 'constructor', 'prototype'].includes(part)),
            );
            let target = tx.data[key];
            for (const part of parts.slice(0, -1)) {
              if (!target[part]) {
                target[part] = {};
              }
              target = target[part];
            }
            target[parts.at(-1)] = value;
          }
          tx.writes = true;
        }
        return { data: { updated: exists ? 1 : 0 } };
      }
      assert.equal(params.upsert, true);
      tx.data[key] = { ...data, _id: query._id };
      tx.writes = true;
      return { data: { updated: 1 } };
    }
  }
  Db.reqClass = OfflineRequest;
  try {
    assert.equal(db._db.constructor, Db);
    return await work({ db, calls, inspect: () => clone(committed) });
  } finally {
    Db.reqClass = originalTransport;
    networkMethods.forEach(([module, name], index) => {
      module[name] = originals[index];
    });
    assert.equal(networkCalls, 0, 'Offline SDK checks must never attempt real network access');
  }
}
module.exports = { withOfflineWxDatabase };
