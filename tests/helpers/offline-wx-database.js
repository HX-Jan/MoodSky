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

async function withOfflineWxDatabase(
  seed,
  work,
  {
    fail = () => null,
    conflictScope = 'database',
    nativeDatabase = false,
    taskStoreReads = false,
    validationReads = false,
  } = {},
) {
  if (!['database', 'written-documents'].includes(conflictScope)) {
    throw new TypeError('Unknown synthetic conflict scope');
  }
  cloud.init({ env: 'synthetic-offline-journal-candidate' });
  const nativeDb = nativeDatabase
    ? cloudRequire('@cloudbase/node-sdk')
        .init({ env: 'synthetic-offline-native-candidate' })
        .database()
    : null;
  const db = nativeDatabase
    ? require('../../tools/journal-storage/native-database').createNativeJournalDatabase(nativeDb)
    : cloud.database({ throwOnNotFound: false });
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
  const versions = new Map(Object.keys(seed).map((key) => [key, 0]));
  const advanceVersion = (key) => versions.set(key, (versions.get(key) || 0) + 1);
  let revision = 0;
  let serial = 0;
  const transactions = new Map();
  const calls = [];
  class OfflineRequest {
    async send(action, params = {}) {
      calls.push({ action, params: clone(params) });
      const failure = await fail(action, params, calls);
      if (failure) {
        return { code: failure, message: 'SYNTHETIC injected transport failure' };
      }
      if (action === 'database.startTransaction') {
        const id = 'synthetic_tx_' + ++serial;
        transactions.set(id, {
          data: clone(committed),
          baseRevision: revision,
          baseVersions: new Map(versions),
          touched: new Set(),
          writes: false,
        });
        return { transactionId: id };
      }
      if (action === 'database.insertDocument' && !params.transactionId) {
        assert.equal(params.collectionName, 'accounts');
        assert.equal(params.data.length, 1);
        const row = EJSON.parse(params.data[0]);
        assert.equal(typeof row.openid, 'string');
        assert.equal(row.status, 'active');
        if (
          Object.entries(committed).some(
            ([key, value]) => key.startsWith('accounts:') && value.openid === row.openid,
          )
        ) {
          return { code: 'DATABASE_DUPLICATE_KEY', message: 'SYNTHETIC unique identity collision' };
        }
        const id = 'synthetic_inserted_account_' + ++serial;
        committed['accounts:' + id] = { ...row, _id: id };
        advanceVersion('accounts:' + id);
        revision++;
        return { data: { insertedIds: [id] } };
      }
      if (action === 'database.getDocument' && !params.transactionId) {
        const query = EJSON.parse(params.query);
        if (
          params.collectionName === 'accounts' &&
          Object.keys(query).length === 1 &&
          typeof query._id === 'string'
        ) {
          const found = committed['accounts:' + query._id];
          return { data: { list: found ? [EJSON.stringify(found)] : [] } };
        }
        if (validationReads) {
          const config = require('../../tools/business-validation/config');
          assert.ok(Object.values(config.collections).includes(params.collectionName));
          if (Object.keys(query).length === 1 && typeof query._id === 'string') {
            const found = committed[params.collectionName + ':' + query._id];
            return { data: { list: found ? [EJSON.stringify(found)] : [] } };
          }
          const conjuncts = (filter, field) => [
            ...(Object.hasOwn(filter, field) ? [filter[field]] : []),
            ...(filter.$and || []).flatMap((part) => conjuncts(part, field)),
          ];
          assert.deepEqual(conjuncts(query, 'runId'), [config.runId]);
          assert.deepEqual(conjuncts(query, 'probeTag'), [config.tag]);
          assert.ok(Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= 201);
          const matches = (row, filter) =>
            Object.entries(filter).every(([field, value]) => {
              if (field === '$and') {
                return value.every((part) => matches(row, part));
              }
              if (field === '$or') {
                return value.some((part) => matches(row, part));
              }
              assert.ok(
                [
                  'ownerId',
                  'openid',
                  'date',
                  'createdAt',
                  '_id',
                  'probeTag',
                  'runId',
                  'enabled',
                ].includes(field),
              );
              if (typeof value !== 'object') {
                return row[field] === value;
              }
              return Object.entries(value).every(([op, bound]) => {
                if (op === '$gte') {
                  return row[field] >= bound;
                }
                if (op === '$lte') {
                  return row[field] <= bound;
                }
                assert.equal(op, '$lt');
                return row[field] < bound;
              });
            });
          const rows = Object.entries(committed)
            .filter(
              ([key, row]) => key.startsWith(params.collectionName + ':') && matches(row, query),
            )
            .map(([, row]) => row);
          if (params.order) {
            const order = EJSON.parse(params.order);
            rows.sort((a, b) => {
              for (const [field, direction] of Object.entries(order)) {
                if (a[field] !== b[field]) {
                  return (a[field] < b[field] ? -1 : 1) * direction;
                }
              }
              return 0;
            });
          }
          return { data: { list: rows.slice(0, params.limit).map((row) => EJSON.stringify(row)) } };
        }
        if (params.collectionName === 'task_templates') {
          assert.equal(params.queryType, 'WHERE');
          assert.deepEqual(query, { enabled: true });
          assert.deepEqual(EJSON.parse(params.order), { _id: 1 });
          if (taskStoreReads && params.limit === 51) {
            assert.equal(params.projection, undefined);
            const list = Object.entries(committed)
              .filter(([key, row]) => key.startsWith('task_templates:') && row.enabled === true)
              .map(([, row]) => row)
              .sort((a, b) => a._id.localeCompare(b._id))
              .slice(0, 51)
              .map((row) => EJSON.stringify(row));
            return { data: { list } };
          }
          assert.equal(params.limit, 3);
          const projection = EJSON.parse(params.projection);
          assert.deepEqual(Object.keys(projection).sort(), [
            '_id',
            'durationMin',
            'enabled',
            'steps',
            'tags',
            'title',
          ]);
          assert.ok(Object.values(projection).every((value) => value === 1));
          const list = Object.entries(committed)
            .filter(([key, row]) => key.startsWith('task_templates:') && row.enabled === true)
            .map(([, row]) => row)
            .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
            .slice(0, params.limit)
            .map((row) =>
              EJSON.stringify(
                Object.fromEntries(Object.entries(row).filter(([key]) => projection[key] === 1)),
              ),
            );
          return { data: { list } };
        }
        if (taskStoreReads && params.collectionName === 'task_history') {
          assert.equal(params.queryType, 'WHERE');
          const owners = (filter) => [
            ...(Object.hasOwn(filter, 'ownerId') ? [filter.ownerId] : []),
            ...(filter.$and || []).flatMap(owners),
          ];
          assert.equal(owners(query).length, 1);
          assert.equal(typeof owners(query)[0], 'string');
          assert.ok(Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= 201);
          const matches = (row, filter) =>
            Object.entries(filter).every(([field, value]) => {
              if (field === '$and') {
                return value.every((part) => matches(row, part));
              }
              if (field === '$or') {
                return value.some((part) => matches(row, part));
              }
              assert.ok(['ownerId', 'date', 'createdAt', '_id'].includes(field));
              if (typeof value !== 'object') {
                return row[field] === value;
              }
              return Object.entries(value).every(([operator, bound]) => {
                if (operator === '$gte') {
                  return row[field] >= bound;
                }
                if (operator === '$lte') {
                  return row[field] <= bound;
                }
                assert.equal(operator, '$lt');
                return row[field] < bound;
              });
            });
          const order = params.order ? EJSON.parse(params.order) : null;
          if (order) {
            assert.deepEqual(order, { createdAt: -1, _id: -1 });
          }
          const rows = Object.entries(committed)
            .filter(([key, row]) => key.startsWith('task_history:') && matches(row, query))
            .map(([, row]) => row);
          if (order) {
            rows.sort((a, b) =>
              a.createdAt !== b.createdAt
                ? a.createdAt > b.createdAt
                  ? -1
                  : 1
                : a._id > b._id
                  ? -1
                  : a._id < b._id
                    ? 1
                    : 0,
            );
          }
          return { data: { list: rows.slice(0, params.limit).map((row) => EJSON.stringify(row)) } };
        }
        if (params.collectionName !== 'accounts') {
          assert.ok(
            ['journals', 'favorites', 'task_history', 'preferences', 'month_decorations'].includes(
              params.collectionName,
            ),
          );
          assert.equal(params.queryType, 'WHERE');
          assert.deepEqual(Object.keys(query).sort(), query._id ? ['_id', 'ownerId'] : ['ownerId']);
          assert.equal(typeof query.ownerId, 'string');
          assert.deepEqual(EJSON.parse(params.order), { _id: 1 });
          assert.ok(Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= 100);
          if (query._id) {
            assert.deepEqual(Object.keys(query._id), ['$gt']);
            assert.equal(typeof query._id.$gt, 'string');
          }
          const list = Object.entries(committed)
            .filter(
              ([key, row]) =>
                key.startsWith(params.collectionName + ':') &&
                row.ownerId === query.ownerId &&
                (!query._id || row._id > query._id.$gt),
            )
            .map(([, row]) => row)
            .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
            .slice(0, params.limit)
            .map((row) => EJSON.stringify(row));
          return { data: { list } };
        }
        assert.equal(params.collectionName, 'accounts');
        assert.deepEqual(Object.keys(query), ['openid']);
        assert.equal(typeof query.openid, 'string');
        assert.equal(params.limit, 2);
        const list = Object.entries(committed)
          .filter(([key, row]) => key.startsWith('accounts:') && row.openid === query.openid)
          .slice(0, params.limit)
          .map(([, row]) => EJSON.stringify(row));
        return { data: { list } };
      }
      const tx = transactions.get(params.transactionId);
      assert.ok(tx, 'All operations must carry a current transaction ID');
      if (action === 'database.abortTransaction') {
        transactions.delete(params.transactionId);
        return {};
      }
      if (action === 'database.commitTransaction') {
        const conflict =
          conflictScope === 'database'
            ? tx.baseRevision !== revision
            : [...tx.touched].some(
                (key) => (tx.baseVersions.get(key) || 0) !== (versions.get(key) || 0),
              );
        if (conflict) {
          transactions.delete(params.transactionId);
          return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'SYNTHETIC commit conflict' };
        }
        if (tx.writes) {
          if (conflictScope === 'database') {
            committed = tx.data;
          } else {
            // A snapshot reader does not lock every document it read. Merge only its writes.
            for (const key of tx.touched) {
              if (Object.hasOwn(tx.data, key)) {
                committed[key] = clone(tx.data[key]);
              } else {
                delete committed[key];
              }
            }
          }
          tx.touched.forEach(advanceVersion);
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
          tx.touched.add(key);
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
          tx.touched.add(key);
        }
        return { data: { updated: exists ? 1 : 0 } };
      }
      assert.equal(params.upsert, true);
      tx.data[key] = { ...data, _id: query._id };
      tx.writes = true;
      tx.touched.add(key);
      return { data: { updated: 1 } };
    }
  }
  Db.reqClass = OfflineRequest;
  try {
    assert.equal(nativeDb ? nativeDb.constructor : db._db.constructor, Db);
    return await work({ db, nativeDb, calls, inspect: () => clone(committed) });
  } finally {
    Db.reqClass = originalTransport;
    networkMethods.forEach(([module, name], index) => {
      module[name] = originals[index];
    });
    assert.equal(networkCalls, 0, 'Offline SDK checks must never attempt real network access');
  }
}
module.exports = { withOfflineWxDatabase };
