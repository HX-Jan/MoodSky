// Fixed synthetic capability experiment. Never imported by a business entry.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const config = require('./config');
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const {
  createCloudJournalRepository,
  LAYOUT,
  dayId,
} = require('../journal-storage/cloudbase-candidate');
const { createReceiptPolicy } = require('../../cloudfunctions/moodsky/services/receipt-policy');
const { WEATHER_TYPES } = require('../../miniprogram/shared/constants');
const { validateJournalInput } = require('../../miniprogram/shared/validation');
const DAY = 86400000;
const id = (kind) =>
  'w3_' +
  createHash('sha256')
    .update(config.runId + ':' + kind)
    .digest('hex')
    .slice(0, 32);
const MANIFEST = id('manifest');
const CREATE = id('create');
const STOP = id('stop');
const HISTORY = id('history');
const DATE = config.businessInstant.slice(0, 10);
function conflict() {
  const error = new Error('Fixed operation already claimed or not ready');
  error.code = 'CONFLICT';
  throw error;
}
const codeOf = (error) =>
  ['CONFLICT', 'ACCOUNT_DISABLED', 'INVALID_INPUT', 'INTERNAL_ERROR'].includes(error?.code)
    ? error.code
    : 'INTERNAL_ERROR';
const read = async (db, key) => (await db.collection('accounts').doc(key).get()).data;
const account = () => ({
  status: 'active',
  journalLayout: LAYOUT,
  journalRevision: 0,
  operationFence: 0,
  exportEpoch: 0,
});
function rows() {
  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(Date.parse(config.businessInstant) - (89 - index) * DAY)
      .toISOString()
      .slice(0, 10);
    const weather = WEATHER_TYPES[index % WEATHER_TYPES.length].code;
    const entryId = id('history_' + index);
    const input = {
      date,
      weather,
      expectedVersion: 0,
      tags: ['REST'],
      text: 'SYNTHETIC W3 WINDOW',
      ...(weather === 'CUSTOM' ? { weatherName: '合成窗口名称' } : {}),
    };
    validateJournalInput(input);
    return {
      layout: LAYOUT,
      ownerId: HISTORY,
      date,
      state: 'active',
      version: 1,
      entryId,
      weather,
      tags: input.tags,
      text: input.text,
      ...(input.weatherName ? { weatherName: input.weatherName } : {}),
      createdAt: date + 'T04:00:00.000Z',
      updatedAt: date + 'T04:00:00.000Z',
    };
  });
}
async function prepare(db) {
  await db.runTransaction(async (tx) => {
    const ref = tx.collection('accounts').doc(MANIFEST);
    if ((await ref.get()).data) {
      conflict();
    }
    await ref.set({ data: { status: 'preparing' } });
    for (const owner of [CREATE, STOP, HISTORY]) {
      if ((await tx.collection('accounts').doc(owner).get()).data) {
        conflict();
      }
      await tx.collection('accounts').doc(owner).set({ data: account() });
    }
    for (const key of [
      id('read'),
      ...Array.from({ length: config.workerCount }, (_, index) => id('worker_' + index)),
    ]) {
      if ((await tx.collection('accounts').doc(key).get()).data) {
        conflict();
      }
    }
  });
  const history = rows();
  // Small, bounded seed transactions. Partial preparation is retained, never restarted.
  for (let offset = 0; offset < history.length; offset += 10) {
    await db.runTransaction(async (tx) => {
      for (const row of history.slice(offset, offset + 10)) {
        if ((await tx.collection('journals').doc(dayId(HISTORY, row.date)).get()).data) {
          conflict();
        }
        await tx.collection('journals').doc(dayId(HISTORY, row.date)).set({ data: row });
      }
    });
  }
  await db.runTransaction(async (tx) => {
    await tx
      .collection('accounts')
      .doc(HISTORY)
      .update({ data: { journalRevision: 90, operationFence: 90, exportEpoch: 90 } });
    await tx
      .collection('accounts')
      .doc(MANIFEST)
      .update({ data: { status: 'ready' } });
  });
  return { status: 'ready', seededDays: 90, workers: config.workerCount };
}
function router(db, ownerId) {
  return createCandidateRouter({
    // Synthetic server-owned actors exercise repository fences, not production identity provisioning.
    resolveAccount: async () => ({ id: ownerId, status: 'active' }),
    journalRepository: createCloudJournalRepository(db),
    now: () => new Date(config.businessInstant),
    journalReceiptPolicy: createReceiptPolicy({
      activeKeyId: 'synthetic-w3-only',
      keys: { 'synthetic-w3-only': Buffer.alloc(32, 0x37) },
      maxAgeMs: 3600000,
    }),
  });
}
const request = (action, payload, requestId) => ({ apiVersion: '1', action, payload, requestId });
async function claim(db, key, instanceTag) {
  await db.runTransaction(async (tx) => {
    const manifest = (await tx.collection('accounts').doc(MANIFEST).get()).data;
    const ref = tx.collection('accounts').doc(key);
    if (manifest?.status !== 'ready' || (await ref.get()).data) {
      conflict();
    }
    await ref.set({ data: { state: 'running', instanceTag } });
  });
}
async function finish(db, key, data) {
  await db.runTransaction((tx) =>
    tx
      .collection('accounts')
      .doc(key)
      .update({ data: { state: 'completed', ...data } }),
  );
}
async function worker(db, index, instanceTag) {
  const key = id('worker_' + index);
  await claim(db, key, instanceTag);
  let transactionCallbacks = 0;
  const operationDb = {
    ...db,
    runTransaction: (work, retries) =>
      db.runTransaction((tx) => {
        transactionCallbacks++;
        return work(tx);
      }, retries),
  };
  let resultCode;
  try {
    if (index === 3) {
      await operationDb.runTransaction(async (tx) => {
        const ref = tx.collection('accounts').doc(STOP);
        const row = (await ref.get()).data;
        assert.equal(row.status, 'active');
        assert.ok(
          Number.isSafeInteger(row.operationFence) && row.operationFence < Number.MAX_SAFE_INTEGER,
        );
        const updated = await ref.update({
          data: { status: 'disabled', operationFence: row.operationFence + 1 },
        });
        assert.equal(updated.stats.updated, 1);
      });
      resultCode = 'OK';
    } else {
      const owner = index < 2 ? CREATE : STOP;
      const result = await router(operationDb, owner)(
        request(
          'journal.upsert',
          {
            date: DATE,
            weather: 'SUNNY',
            expectedVersion: 0,
            text: 'SYNTHETIC W3 RACE',
          },
          'req_w3_worker_' + index,
        ),
        { OPENID: 'synthetic-fixed-operator' },
      );
      resultCode = result.ok ? 'OK' : codeOf(result.error);
    }
  } catch (error) {
    resultCode = codeOf(error);
  }
  const result = { resultCode, transactionCallbacks };
  await finish(db, key, result);
  return { worker: index, state: 'completed', ...result };
}
async function readWindows(db, instanceTag) {
  for (let index = 0; index < config.workerCount; index++) {
    if ((await read(db, id('worker_' + index)))?.state !== 'completed') {
      conflict();
    }
  }
  if ((await read(db, STOP))?.status !== 'disabled') {
    conflict();
  }
  const key = id('read');
  await claim(db, key, instanceTag);
  const results = [];
  let passed = false;
  let failedCheck = null;
  let stage = 'window_7';
  try {
    const call = router(db, HISTORY);
    for (const days of [7, 30, 90]) {
      stage = 'window_' + days;
      const start = Date.now();
      const timeline = await call(
        request('review.timeline', { windowDays: days }, 'req_w3_window_' + days),
        { OPENID: 'synthetic-fixed-operator' },
      );
      assert.equal(timeline.ok, true);
      assert.equal(timeline.data.recordCount, days);
      assert.equal(timeline.data.sourceRevision, 90);
      assert.equal(timeline.data.endDate, DATE);
      const expected = rows().slice(-days).reverse();
      assert.deepEqual(
        timeline.data.items.map((item) => item.id),
        expected.map((row) => row.entryId),
      );
      assert.doesNotMatch(
        JSON.stringify(timeline),
        /SYNTHETIC W3 WINDOW|ownerId|openid|tags|"text"/,
      );
      results.push({
        windowDays: days,
        recordCount: timeline.data.recordCount,
        sourceRevision: 90,
        elapsedMs: Date.now() - start,
      });
    }
    // Replaying a formerly successful original operation after disable still fails at the repository gate.
    const stopped = router(db, STOP);
    stage = 'disabled_replay_and_reads';
    for (const [action, payload, requestId] of [
      [
        'journal.upsert',
        { date: DATE, weather: 'SUNNY', expectedVersion: 0, text: 'SYNTHETIC W3 RACE' },
        'req_w3_worker_2',
      ],
      ['journal.get', { date: DATE }, 'req_w3_disabled_get'],
      ['review.calendar', { month: DATE.slice(0, 7) }, 'req_w3_disabled_calendar'],
    ]) {
      const result = await stopped(request(action, payload, requestId), {
        OPENID: 'synthetic-fixed-operator',
      });
      assert.equal(result.error?.code, 'ACCOUNT_DISABLED');
    }
    passed = true;
  } catch (error) {
    failedCheck = {
      stage,
      code: error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : codeOf(error),
    };
  }
  await finish(db, key, { passed, results, failedCheck });
  return { state: 'completed', passed, results, failedCheck };
}
async function inspect(db) {
  const manifest = await read(db, MANIFEST);
  if (!manifest) {
    return { status: 'not-started', technicalValidationComplete: false };
  }
  const workers = [];
  for (let index = 0; index < config.workerCount; index++) {
    const row = await read(db, id('worker_' + index));
    workers.push({
      worker: index,
      state: row?.state || 'not-started',
      resultCode: row?.resultCode || null,
      transactionCallbacks: row?.transactionCallbacks || 0,
      instanceTag: row?.instanceTag || null,
    });
  }
  const reader = await read(db, id('read'));
  const complete =
    workers.every((row) => row.state === 'completed') && reader?.state === 'completed';
  const createAccount = await read(db, CREATE);
  const stopAccount = await read(db, STOP);
  const createDay = (await db.collection('journals').doc(dayId(CREATE, DATE)).get()).data;
  const stopDay = (await db.collection('journals').doc(dayId(STOP, DATE)).get()).data;
  const createWorkers = workers.slice(0, 2);
  const createPassed =
    createWorkers.filter((row) => row.resultCode === 'OK').length === 1 &&
    createWorkers.filter((row) => row.resultCode === 'CONFLICT').length === 1 &&
    createDay?.version === 1 &&
    createAccount?.journalRevision === 1;
  const stopPassed =
    workers[3].resultCode === 'OK' &&
    stopAccount?.status === 'disabled' &&
    (workers[2].resultCode === 'OK'
      ? stopDay?.version === 1
      : workers[2].resultCode === 'ACCOUNT_DISABLED' && !stopDay);
  return {
    status: manifest.status === 'ready' && complete ? 'completed' : manifest.status,
    capabilityChecksPassed: Boolean(complete && createPassed && stopPassed && reader?.passed),
    createPassed,
    stopPassed,
    windowChecksPassed: reader?.passed === true,
    distinctCreateRuntimeTagsObserved:
      createWorkers.every((row) => row.state === 'completed') &&
      new Set(createWorkers.map((row) => row.instanceTag)).size > 1,
    distinctStopRuntimeTagsObserved:
      workers[2].state === 'completed' &&
      workers[3].state === 'completed' &&
      workers[2].instanceTag !== workers[3].instanceTag,
    additionalCreateCallbacksObserved:
      createWorkers.reduce((sum, row) => sum + row.transactionCallbacks, 0) > 2,
    additionalStopCallbacksObserved:
      workers[2].transactionCallbacks + workers[3].transactionCallbacks > 2,
    workers,
    windows: reader?.results || [],
    failedCheck: reader?.failedCheck || null,
    syntheticIdentityOnly: true,
    fixedBusinessClock: config.businessInstant,
    providerInstanceIdentityVerified: false,
    crossInstanceValidationComplete: false,
    duplicateErrorMappingConfirmed: false,
    technicalValidationComplete: false,
    productionEnabled: false,
    retainedData: true,
  };
}
module.exports = { prepare, worker, readWindows, inspect };
