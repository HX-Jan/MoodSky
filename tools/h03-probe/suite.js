const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('./config');
const { validateRequest, validateJournalInput } = require('../../miniprogram/shared/validation');
const { canCreateEntry, isBusinessDate } = require('../../miniprogram/shared/date');

function idFor(runId, kind, ...parts) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([config.probeTag, runId, kind, ...parts]))
    .digest('hex')
    .slice(0, 32);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function safeCode(error) {
  const code = error && (error.code || error.errCode);
  const value = String(code === undefined ? '' : code);
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) || /^-?\d{1,12}$/.test(value)
    ? value
    : 'UNCLASSIFIED_SDK_ERROR';
}

function probeError(code) {
  const error = new Error('Isolated probe stopped.');
  error.code = code;
  return error;
}

async function readDoc(ref, runId) {
  const response = await ref.get();
  const raw = response.data;
  const record = Array.isArray(raw) ? (assert(raw.length <= 1), raw[0]) : raw;
  if (record === undefined || record === null) {
    return null;
  }
  assert.equal(typeof record, 'object');
  assert.equal(record.probeTag, config.probeTag);
  assert.equal(record.runId, runId);
  return record;
}

async function countRun(db, collection, runId) {
  assert(Object.values(config.collections).includes(collection));
  const result = await db
    .collection(collection)
    .where({ probeTag: config.probeTag, runId })
    .count();
  assert(Number.isInteger(result.total) && result.total >= 0);
  return result.total;
}

function manifestRef(db, runId) {
  return db.collection(config.collections.accounts).doc(idFor(runId, 'manifest'));
}

const LAST_OPERATIONS = Object.freeze([
  'input-validation',
  'transaction',
  'account-read',
  'receipt-read',
  'journal-read',
  'account-fence',
  'journal-write',
  'deletion-marker-write',
  'revision-write',
  'receipt-write',
  'post-commit',
]);

async function settleOperations(operations) {
  assert(Array.isArray(operations) && operations.length === 2);
  let failed = false;
  let firstError;
  const settled = await Promise.allSettled(
    operations.map((operation) =>
      Promise.resolve(operation).catch((error) => {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        throw error;
      }),
    ),
  );
  if (failed) {
    throw firstError;
  }
  return settled.map((item) => item.value);
}

const REPORT_CASE_IDS = Object.freeze([
  'V01-commit',
  'V06-afterJournal',
  'V06-afterReceipt',
  'V02-journals',
  'V02-receipts',
  'V03-create',
  'V03-edit',
  'V03-edit-delete',
  'V04-same-input',
  'V04-response-loss',
  'V05-different-input',
  'V05-rejection-replay',
  'V07-boundary',
  'V07-old-edit',
  'V07-midnight',
  'V08-delete-recreate',
  'V08-empty-delete',
]);
const REPORT_DEFERRED = Object.freeze(['V09', 'V10', 'V11', 'V12']);

function sanitizeReport(value) {
  const object = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  const count = (item) => Number.isSafeInteger(item) && item >= 0;
  const code = (item) =>
    typeof item === 'string' && (/^[A-Z][A-Z0-9_]{0,63}$/.test(item) || /^-?\d{1,12}$/.test(item));
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.stage !== 'isolated-capability-probe' ||
    typeof value.allAssertionsPassed !== 'boolean' ||
    value.callbackRetryCount !== config.retryCount ||
    !count(value.transactionCallbacks) ||
    !Array.isArray(value.results) ||
    value.results.length !== REPORT_CASE_IDS.length ||
    !Array.isArray(value.deferred) ||
    value.deferred.length !== REPORT_DEFERRED.length ||
    !REPORT_DEFERRED.every((id, i) => value.deferred[i] === id) ||
    value.productionJournalImplemented !== false ||
    value.duplicateErrorMappingConfirmed !== false ||
    value.technicalValidationComplete !== false
  ) {
    return null;
  }
  const results = [];
  for (const item of value.results) {
    if (
      !object(item) ||
      !REPORT_CASE_IDS.includes(item.id) ||
      results.some((prior) => prior.id === item.id) ||
      typeof item.passed !== 'boolean' ||
      !count(item.transactionCallbacks) ||
      (item.code !== undefined && !code(item.code)) ||
      (item.passed === false && !code(item.code)) ||
      (item.lastOperation !== undefined &&
        (item.passed || !LAST_OPERATIONS.includes(item.lastOperation))) ||
      ((item.observedSdkCode !== undefined || item.errorMappingConfirmed !== undefined) &&
        (!['V02-journals', 'V02-receipts'].includes(item.id) ||
          !code(item.observedSdkCode) ||
          item.errorMappingConfirmed !== false))
    ) {
      return null;
    }
    const result = {
      id: item.id,
      passed: item.passed,
      transactionCallbacks: item.transactionCallbacks,
    };
    if (item.code !== undefined) {
      result.code = item.code;
    }
    if (item.lastOperation !== undefined) {
      result.lastOperation = item.lastOperation;
    }
    if (item.observedSdkCode !== undefined) {
      result.observedSdkCode = item.observedSdkCode;
      result.errorMappingConfirmed = false;
    }
    results.push(result);
  }
  const caseCallbacks = results.reduce((total, item) => total + item.transactionCallbacks, 0);
  if (
    results.every((item) => item.passed) !== value.allAssertionsPassed ||
    !Number.isSafeInteger(caseCallbacks) ||
    caseCallbacks > value.transactionCallbacks
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    stage: 'isolated-capability-probe',
    allAssertionsPassed: value.allAssertionsPassed,
    results,
    callbackRetryCount: config.retryCount,
    transactionCallbacks: value.transactionCallbacks,
    deferred: [...REPORT_DEFERRED],
    productionJournalImplemented: false,
    duplicateErrorMappingConfirmed: false,
    technicalValidationComplete: false,
  };
}

async function persistRunReport(runRef, results, transactionCallbacks) {
  const report = sanitizeReport({
    schemaVersion: 1,
    stage: 'isolated-capability-probe',
    allAssertionsPassed: results.every((result) => result.passed),
    results,
    callbackRetryCount: config.retryCount,
    transactionCallbacks,
    deferred: [...REPORT_DEFERRED],
    productionJournalImplemented: false,
    duplicateErrorMappingConfirmed: false,
    technicalValidationComplete: false,
  });
  assert(report, 'Invalid isolated report shape.');
  await runRef.update({
    data: { status: report.allAssertionsPassed ? 'completed' : 'failed', report },
  });
  return report;
}

async function inspectRun(db, runId) {
  const manifest = await readDoc(manifestRef(db, runId), runId);
  const counts = {};
  for (const collection of Object.values(config.collections)) {
    counts[collection] = await countRun(db, collection, runId);
  }
  const hasStoredReport = manifest && manifest.report !== undefined && manifest.report !== null;
  let report = hasStoredReport ? sanitizeReport(manifest.report) : null;
  if (
    report &&
    (!['completed', 'failed', 'cleaning', 'cleaned'].includes(manifest.status) ||
      (['completed', 'failed'].includes(manifest.status) &&
        report.allAssertionsPassed !== (manifest.status === 'completed')))
  ) {
    report = null;
  }
  return {
    status: manifest ? manifest.status : 'not-found',
    reportAvailable: report !== null,
    reportValidation: hasStoredReport ? (report ? 'available' : 'invalid') : 'missing',
    report,
    counts,
    filter: { probeTag: config.probeTag, runId },
    retainsClosedRunMarker: true,
  };
}

async function cleanupRun(db, runId) {
  const ref = manifestRef(db, runId);
  const manifest = await readDoc(ref, runId);
  if (!manifest) {
    throw probeError('CONFLICT');
  }
  if (!['completed', 'failed', 'cleaning', 'cleaned'].includes(manifest.status)) {
    throw probeError('CONFLICT');
  }
  await ref.update({ data: { status: 'cleaning' } });
  const removed = {};
  const order = ['journals', 'receipts', 'deletions', 'accounts'];
  for (const role of order) {
    const collection = config.collections[role];
    removed[collection] = 0;
    while (true) {
      const response = await db
        .collection(collection)
        .where({ probeTag: config.probeTag, runId })
        .limit(100)
        .get();
      assert(Array.isArray(response.data));
      const records = response.data.filter((record) => record._id !== idFor(runId, 'manifest'));
      if (!records.length) {
        break;
      }
      for (const record of records) {
        assert.equal(record.probeTag, config.probeTag);
        assert.equal(record.runId, runId);
        assert.equal(typeof record._id, 'string');
        const result = await db
          .collection(collection)
          .where({ _id: record._id, probeTag: config.probeTag, runId })
          .remove();
        assert(result.stats && Number.isInteger(result.stats.removed));
        assert(result.stats.removed >= 0 && result.stats.removed <= 1);
        removed[collection] += result.stats.removed;
      }
    }
  }
  await ref.update({ data: { status: 'cleaned' } });
  return { removed, remaining: (await inspectRun(db, runId)).counts, retainsClosedRunMarker: true };
}

function createHarness(db, runId) {
  const digestKey = crypto.randomBytes(32);
  const calls = { transactionCallbacks: 0 };
  const lastOperations = new WeakMap();
  const lastOperationFor = (error) =>
    error !== null && (typeof error === 'object' || typeof error === 'function')
      ? lastOperations.get(error) || undefined
      : undefined;
  const scope = (ownerId, caseId, data) => ({
    probeTag: config.probeTag,
    runId,
    ownerId,
    caseId,
    ...data,
  });
  const doc = (source, role, kind, ...parts) =>
    source.collection(config.collections[role]).doc(idFor(runId, kind, ...parts));

  async function actor(caseId, name = 'a') {
    const ownerId = 'synthetic_' + idFor(runId, 'actor', caseId, name).slice(0, 20);
    const accountId = idFor(runId, 'account', ownerId);
    await db.collection(config.collections.accounts).add({
      data: scope(ownerId, caseId, {
        _id: accountId,
        status: 'active',
        operationFence: 0,
        journalRevision: 0,
        exportEpoch: 0,
      }),
    });
    return { ownerId, accountId, caseId };
  }

  async function mutate(actorValue, request, options = {}) {
    const observation = { lastOperation: 'input-validation' };
    try {
      return await executeMutation(actorValue, request, options, observation);
    } catch (error) {
      if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
        if (!lastOperations.has(error)) {
          lastOperations.set(error, observation.lastOperation);
        } else if (lastOperations.get(error) !== observation.lastOperation) {
          lastOperations.set(error, null);
        }
      }
      throw error;
    }
  }

  async function executeMutation(actorValue, request, options, observation) {
    validateRequest(request);
    const raw = JSON.parse(JSON.stringify(request.payload));
    const deleting = request.action === 'journal.delete';
    assert(['journal.upsert', 'journal.delete'].includes(request.action));
    const input = deleting ? raw : validateJournalInput(raw);
    if (deleting) {
      assert.deepEqual(Object.keys(raw).sort(), ['date', 'expectedVersion']);
      assert(isBusinessDate(input.date));
      assert(Number.isInteger(input.expectedVersion) && input.expectedVersion > 0);
    }
    const now = options.now || new Date('2026-10-14T04:00:00.000Z');
    const timestamp = now.toISOString();
    const entryId = idFor(runId, 'entry', actorValue.ownerId, request.requestId);
    const digest = crypto
      .createHmac('sha256', digestKey)
      .update(
        canonical({
          schemaVersion: 1,
          apiVersion: request.apiVersion,
          action: request.action,
          payload: raw,
        }),
      )
      .digest('hex');
    observation.lastOperation = 'transaction';
    const result = await db.runTransaction(async (transaction) => {
      calls.transactionCallbacks += 1;
      const accountRef = transaction
        .collection(config.collections.accounts)
        .doc(actorValue.accountId);
      observation.lastOperation = 'account-read';
      const account = await readDoc(accountRef, runId);
      assert(account && account.ownerId === actorValue.ownerId);
      if (account.status !== 'active') {
        throw probeError('ACCOUNT_DISABLED');
      }
      const receiptRef = doc(
        transaction,
        'receipts',
        'receipt',
        actorValue.ownerId,
        request.action,
        request.requestId,
      );
      observation.lastOperation = 'receipt-read';
      const previous = await readDoc(receiptRef, runId);
      const journalRef = doc(transaction, 'journals', 'day', actorValue.ownerId, input.date);
      observation.lastOperation = 'journal-read';
      const current = await readDoc(journalRef, runId);
      if (current) {
        assert.equal(current.ownerId, actorValue.ownerId);
        assert.equal(current.date, input.date);
        assert(Number.isSafeInteger(current.version));
      }
      // Read the full decision set before writing, then fence this account.
      observation.lastOperation = 'account-fence';
      await accountRef.update({ data: { operationFence: account.operationFence + 1 } });
      if (previous) {
        assert.equal(previous.ownerId, actorValue.ownerId);
        if (previous.digest !== digest) {
          observation.lastOperation = 'transaction';
          return { ok: false, code: 'CONFLICT', replayed: true };
        }
        if (['created', 'edited'].includes(previous.result.kind)) {
          if (
            !current ||
            current.state !== 'active' ||
            current.entryId !== previous.result.entryId ||
            current.version !== previous.result.version
          ) {
            observation.lastOperation = 'transaction';
            return { ok: false, code: 'CONFLICT', replayed: true };
          }
        }
        observation.lastOperation = 'transaction';
        return { ...previous.result, replayed: true };
      }
      const active = current && current.state === 'active';
      let outcome;
      let changed = false;
      if (deleting) {
        if (!active) {
          outcome = { ok: true, kind: 'deleted', deleted: false, date: input.date };
        } else if (current.version !== input.expectedVersion) {
          outcome = { ok: false, kind: 'rejected', code: 'CONFLICT' };
        } else {
          const version = current.version + 1;
          observation.lastOperation = 'journal-write';
          await journalRef.update({
            data: {
              state: 'deleted',
              version,
              lastEntryId: current.entryId,
              deletedAt: timestamp,
              weather: db.command.remove(),
              tags: db.command.remove(),
              text: db.command.remove(),
              entryId: db.command.remove(),
              createdAt: db.command.remove(),
              updatedAt: db.command.remove(),
            },
          });
          observation.lastOperation = 'deletion-marker-write';
          await doc(
            transaction,
            'deletions',
            'deletion',
            actorValue.ownerId,
            request.requestId,
          ).set({
            data: scope(actorValue.ownerId, actorValue.caseId, {
              date: input.date,
              entryId: current.entryId,
              deletedVersion: version,
              status: 'pending',
            }),
          });
          outcome = { ok: true, kind: 'deleted', deleted: true, date: input.date };
          changed = true;
        }
      } else if (input.expectedVersion === 0 && active) {
        outcome = { ok: false, kind: 'rejected', code: 'CONFLICT' };
      } else if (
        input.expectedVersion > 0 &&
        (!active || input.expectedVersion !== current.version)
      ) {
        outcome = { ok: false, kind: 'rejected', code: 'CONFLICT' };
      } else if (input.expectedVersion === 0 && !canCreateEntry(input.date, now)) {
        outcome = { ok: false, kind: 'rejected', code: 'INVALID_INPUT' };
      } else {
        const version = (current ? current.version : 0) + 1;
        assert(Number.isSafeInteger(version));
        observation.lastOperation = 'journal-write';
        await journalRef.set({
          data: scope(actorValue.ownerId, actorValue.caseId, {
            date: input.date,
            state: 'active',
            weather: input.weather,
            tags: input.tags,
            text: input.text,
            entryId: active ? current.entryId : entryId,
            version,
            createdAt: active ? current.createdAt : timestamp,
            updatedAt: timestamp,
          }),
        });
        outcome = {
          ok: true,
          kind: active ? 'edited' : 'created',
          entryId: active ? current.entryId : entryId,
          version,
        };
        changed = true;
      }
      if (changed) {
        observation.lastOperation = 'revision-write';
        await accountRef.update({
          data: {
            journalRevision: account.journalRevision + 1,
            exportEpoch: account.exportEpoch + 1,
          },
        });
      }
      if (options.failAt === 'afterJournal') {
        throw probeError('H03_INJECTED_FAILURE');
      }
      observation.lastOperation = 'receipt-write';
      await receiptRef.set({
        data: scope(actorValue.ownerId, actorValue.caseId, {
          action: request.action,
          requestId: request.requestId,
          digest,
          digestVersion: 'probe-ephemeral-1',
          result: outcome,
        }),
      });
      if (options.failAt === 'afterReceipt') {
        throw probeError('H03_INJECTED_FAILURE');
      }
      observation.lastOperation = 'transaction';
      return { ...outcome, replayed: false };
    }, config.retryCount);
    observation.lastOperation = 'post-commit';
    if (options.failAt === 'afterCommit') {
      throw probeError('H03_SIMULATED_RESPONSE_LOSS');
    }
    return result;
  }

  return { actor, mutate, scope, doc, calls, lastOperationFor };
}

function saveRequest(requestId, date = '2026-10-14', expectedVersion = 0, text = '') {
  return {
    apiVersion: '1',
    requestId,
    action: 'journal.upsert',
    payload: { date, weather: 'SUNNY', tags: [], text, expectedVersion },
  };
}

function deleteRequest(requestId, date, expectedVersion) {
  return {
    apiVersion: '1',
    requestId,
    action: 'journal.delete',
    payload: { date, expectedVersion },
  };
}

async function runSuite(db, runId) {
  const runRef = manifestRef(db, runId);
  if (await readDoc(runRef, runId)) {
    throw probeError('CONFLICT');
  }
  // An insert reserves the batch. Existing runs are never silently reset.
  await db.collection(config.collections.accounts).add({
    data: {
      _id: idFor(runId, 'manifest'),
      probeTag: config.probeTag,
      runId,
      status: 'running',
      ownerId: 'synthetic_manifest',
    },
  });
  const harness = createHarness(db, runId);
  const results = [];
  async function check(id, body) {
    const before = harness.calls.transactionCallbacks;
    try {
      const evidence = await body();
      results.push({
        id,
        passed: true,
        transactionCallbacks: harness.calls.transactionCallbacks - before,
        ...(evidence || {}),
      });
    } catch (error) {
      const lastOperation = harness.lastOperationFor(error);
      results.push({
        id,
        passed: false,
        code: safeCode(error),
        ...(lastOperation ? { lastOperation } : {}),
        transactionCallbacks: harness.calls.transactionCallbacks - before,
      });
    }
  }
  const assertStored = async (actor, date) =>
    readDoc(harness.doc(db, 'journals', 'day', actor.ownerId, date), runId);

  await check('V01-commit', async () => {
    const actor = await harness.actor('commit');
    const result = await harness.mutate(actor, saveRequest('req_probe_commit'));
    assert(result.ok && result.version === 1);
    const account = await readDoc(
      db.collection(config.collections.accounts).doc(actor.accountId),
      runId,
    );
    assert.equal(account.journalRevision, 1);
    const receipts = await db
      .collection(config.collections.receipts)
      .where({ probeTag: config.probeTag, runId, ownerId: actor.ownerId })
      .get();
    assert.equal(receipts.data.length, 1);
    assert(!JSON.stringify(receipts.data).includes('"text"'));
  });

  for (const failAt of ['afterJournal', 'afterReceipt']) {
    await check('V06-' + failAt, async () => {
      const actor = await harness.actor(failAt);
      const request = saveRequest('req_probe_rollback');
      await assert.rejects(
        harness.mutate(actor, request, { failAt }),
        (error) => error.code === 'H03_INJECTED_FAILURE',
      );
      assert.equal(await assertStored(actor, request.payload.date), null);
      const receipt = await readDoc(
        harness.doc(db, 'receipts', 'receipt', actor.ownerId, request.action, request.requestId),
        runId,
      );
      assert.equal(receipt, null);
      const account = await readDoc(
        db.collection(config.collections.accounts).doc(actor.accountId),
        runId,
      );
      assert.equal(account.journalRevision, 0);
      assert.equal(account.operationFence, 0);
    });
  }

  for (const role of ['journals', 'receipts']) {
    await check('V02-' + role, async () => {
      const actor = await harness.actor('unique-' + role);
      const data = harness.scope(actor.ownerId, actor.caseId, {
        date: '2026-10-14',
        action: 'journal.upsert',
        requestId: 'req_probe_unique',
      });
      await db
        .collection(config.collections[role])
        .add({ data: { ...data, _id: idFor(runId, role, 'unique-one') } });
      let rejected = null;
      try {
        await db
          .collection(config.collections[role])
          .add({ data: { ...data, _id: idFor(runId, role, 'unique-two') } });
      } catch (error) {
        rejected = error;
      }
      assert(rejected);
      const count = await db
        .collection(config.collections[role])
        .where({ probeTag: config.probeTag, runId, ownerId: actor.ownerId })
        .count();
      assert.equal(count.total, 1);
      const control =
        role === 'journals'
          ? { ...data, date: '2026-10-13' }
          : { ...data, requestId: 'req_probe_unique_control' };
      await db
        .collection(config.collections[role])
        .add({ data: { ...control, _id: idFor(runId, role, 'unique-control') } });
      const afterControl = await db
        .collection(config.collections[role])
        .where({ probeTag: config.probeTag, runId, ownerId: actor.ownerId })
        .count();
      assert.equal(afterControl.total, 2);
      return { observedSdkCode: safeCode(rejected), errorMappingConfirmed: false };
    });
  }

  await check('V03-create', async () => {
    const actor = await harness.actor('create-race');
    const outcomes = await settleOperations([
      harness.mutate(actor, saveRequest('req_probe_create_a')),
      harness.mutate(actor, saveRequest('req_probe_create_b')),
    ]);
    assert.equal(outcomes.filter((result) => result.ok).length, 1);
    assert.equal(outcomes.filter((result) => result.code === 'CONFLICT').length, 1);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 1);
  });

  await check('V03-edit', async () => {
    const actor = await harness.actor('edit-race');
    await harness.mutate(actor, saveRequest('req_probe_edit_seed'));
    const outcomes = await settleOperations([
      harness.mutate(actor, saveRequest('req_probe_edit_a', '2026-10-14', 1, '合成编辑 A')),
      harness.mutate(actor, saveRequest('req_probe_edit_b', '2026-10-14', 1, '合成编辑 B')),
    ]);
    assert.equal(outcomes.filter((result) => result.ok).length, 1);
    assert.equal(outcomes.filter((result) => result.code === 'CONFLICT').length, 1);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 2);
  });

  await check('V03-edit-delete', async () => {
    const actor = await harness.actor('edit-delete');
    await harness.mutate(actor, saveRequest('req_probe_delete_seed'));
    const outcomes = await settleOperations([
      harness.mutate(actor, saveRequest('req_probe_edit_race', '2026-10-14', 1, '合成竞争编辑')),
      harness.mutate(actor, deleteRequest('req_probe_delete_race', '2026-10-14', 1)),
    ]);
    assert.equal(outcomes.filter((result) => result.ok).length, 1);
    assert.equal(outcomes.filter((result) => result.code === 'CONFLICT').length, 1);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 2);
  });

  await check('V04-same-input', async () => {
    const actor = await harness.actor('same-input');
    const request = saveRequest('req_probe_same_input');
    const outcomes = await settleOperations([
      harness.mutate(actor, request),
      harness.mutate(actor, request),
    ]);
    assert(outcomes.every((result) => result.ok && result.version === 1));
    assert.equal(outcomes.filter((result) => result.replayed).length, 1);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 1);
  });

  await check('V04-response-loss', async () => {
    const actor = await harness.actor('response-loss');
    const request = saveRequest('req_probe_response_loss');
    await assert.rejects(
      harness.mutate(actor, request, { failAt: 'afterCommit' }),
      (error) => error.code === 'H03_SIMULATED_RESPONSE_LOSS',
    );
    const replay = await harness.mutate(actor, request);
    assert(replay.ok && replay.replayed && replay.version === 1);
  });

  await check('V05-different-input', async () => {
    const actor = await harness.actor('different-input');
    const first = saveRequest('req_probe_different', '2026-10-14', 0, '合成输入 A');
    const second = saveRequest('req_probe_different', '2026-10-14', 0, '合成输入 B');
    const outcomes = await settleOperations([
      harness.mutate(actor, first),
      harness.mutate(actor, second),
    ]);
    assert.equal(outcomes.filter((result) => result.ok).length, 1);
    assert.equal(outcomes.filter((result) => result.code === 'CONFLICT').length, 1);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 1);
  });

  await check('V05-rejection-replay', async () => {
    const actor = await harness.actor('rejection');
    const rejected = saveRequest('req_probe_rejection', '2026-10-14', 3);
    assert.equal((await harness.mutate(actor, rejected)).code, 'CONFLICT');
    await harness.mutate(actor, saveRequest('req_probe_rejection_seed'));
    const replay = await harness.mutate(actor, rejected);
    assert.equal(replay.code, 'CONFLICT');
    assert(replay.replayed);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 1);
  });

  await check('V07-boundary', async () => {
    const actor = await harness.actor('boundary');
    const request = saveRequest('req_probe_day29', '2026-09-15');
    assert((await harness.mutate(actor, request)).ok);
    assert.equal(
      (await harness.mutate(actor, saveRequest('req_probe_day30', '2026-09-14'))).code,
      'INVALID_INPUT',
    );
    assert.equal(
      (await harness.mutate(actor, saveRequest('req_probe_future', '2026-10-15'))).code,
      'INVALID_INPUT',
    );
    const replay = await harness.mutate(actor, request, {
      now: new Date('2026-10-15T04:00:00.000Z'),
    });
    assert(replay.ok && replay.replayed);
  });

  await check('V07-old-edit', async () => {
    const actor = await harness.actor('old-edit');
    await harness.doc(db, 'journals', 'day', actor.ownerId, '2025-01-01').set({
      data: harness.scope(actor.ownerId, actor.caseId, {
        date: '2025-01-01',
        state: 'active',
        entryId: idFor(runId, 'old-entry'),
        version: 3,
        weather: 'CLOUDY',
        tags: [],
        text: '合成旧记录',
        createdAt: '2025-01-01T04:00:00.000Z',
      }),
    });
    const result = await harness.mutate(actor, saveRequest('req_probe_old_edit', '2025-01-01', 3));
    assert(result.ok && result.version === 4);
  });

  await check('V07-midnight', async () => {
    const actor = await harness.actor('midnight');
    const before = await harness.mutate(actor, saveRequest('req_probe_before_midnight'), {
      now: new Date('2026-10-13T15:59:59.999Z'),
    });
    assert.equal(before.code, 'INVALID_INPUT');
    const after = await harness.mutate(actor, saveRequest('req_probe_after_midnight'), {
      now: new Date('2026-10-13T16:00:00.000Z'),
    });
    assert(after.ok && after.version === 1);
  });

  await check('V08-delete-recreate', async () => {
    const actor = await harness.actor('recreate');
    const first = saveRequest('req_probe_recreate_seed');
    const created = await harness.mutate(actor, first);
    const removal = deleteRequest('req_probe_recreate_delete', '2026-10-14', 1);
    assert((await harness.mutate(actor, removal)).deleted);
    const tombstone = await assertStored(actor, '2026-10-14');
    assert.equal(tombstone.version, 2);
    for (const key of ['weather', 'tags', 'text', 'entryId', 'createdAt', 'updatedAt']) {
      assert(!Object.prototype.hasOwnProperty.call(tombstone, key));
    }
    const recreated = await harness.mutate(actor, saveRequest('req_probe_recreate_new'));
    assert(recreated.ok && recreated.version === 3 && recreated.entryId !== created.entryId);
    assert.equal((await harness.mutate(actor, first)).code, 'CONFLICT');
    assert.equal(
      (await harness.mutate(actor, saveRequest('req_probe_recreate_stale', '2026-10-14', 1))).code,
      'CONFLICT',
    );
    assert((await harness.mutate(actor, removal)).deleted);
    assert.equal((await assertStored(actor, '2026-10-14')).version, 3);
  });

  await check('V08-empty-delete', async () => {
    const actor = await harness.actor('empty-delete');
    const removal = deleteRequest('req_probe_empty_delete', '2026-10-14', 1);
    assert.equal((await harness.mutate(actor, removal)).deleted, false);
    await harness.mutate(actor, saveRequest('req_probe_empty_new'));
    const replay = await harness.mutate(actor, removal);
    assert(replay.replayed && replay.deleted === false);
    assert.equal((await assertStored(actor, '2026-10-14')).state, 'active');
  });

  const report = await persistRunReport(runRef, results, harness.calls.transactionCallbacks);
  return { ...report, counts: (await inspectRun(db, runId)).counts };
}

module.exports = {
  runSuite,
  inspectRun,
  cleanupRun,
  canonical,
  idFor,
  safeCode,
  createHarness,
  sanitizeReport,
  persistRunReport,
  settleOperations,
};
