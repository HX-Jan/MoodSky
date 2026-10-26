const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const config = require('./config');
const { createRepository } = require('../../cloudfunctions/moodsky/domains/repository');
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const { createCloudJournalRepository } = require('../journal-storage/cloudbase-candidate');
const { createReceiptPolicy } = require('../../cloudfunctions/moodsky/services/receipt-policy');
const { createTasksDomain } = require('../../cloudfunctions/moodsky/services/tasks-candidate');
const {
  createTransactionalTasksStore,
  TASK_LAYOUT,
  historyId,
  receiptId,
} = require('../../cloudfunctions/moodsky/stores/transactional-tasks');
const id = (kind) =>
  'bv_' +
  createHash('sha256')
    .update(config.runId + ':' + kind)
    .digest('hex')
    .slice(0, 32);
const MANIFEST = id('manifest');
const OWNER = id('journal_owner');
const OTHER = id('task_owner');
const DISABLED = id('disabled_owner');
const TEMPLATE_A = id('template_a');
const TEMPLATE_B = id('template_b');
async function inspectValidation(db) {
  const result = (await db.collection('accounts').doc(MANIFEST).get()).data;
  return result
    ? { status: result.status, report: result.report || null }
    : { status: 'not-started', report: null };
}
async function runValidation(db) {
  await db.runTransaction(async (tx) => {
    const ref = tx.collection('accounts').doc(MANIFEST);
    if ((await ref.get()).data) {
      const error = new Error('Batch already exists');
      error.code = 'CONFLICT';
      throw error;
    }
    await ref.set({ data: { status: 'running', startedAt: new Date().toISOString() } });
  });
  const results = [];
  const check = async (name, work) => {
    try {
      await work();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({
        name,
        passed: false,
        code: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code)) ? error.code : 'VALIDATION_FAILED',
      });
      throw error;
    }
  };
  let report;
  try {
    await db.runTransaction(async (tx) => {
      for (const owner of [OWNER, OTHER, DISABLED]) {
        await tx
          .collection('accounts')
          .doc(owner)
          .set({
            data: {
              openid: id('openid_' + owner),
              status: owner === DISABLED ? 'disabled' : 'active',
              journalLayout: 'deterministic-days-v1',
              taskLayout: TASK_LAYOUT,
              journalRevision: 0,
              operationFence: 0,
              exportEpoch: 0,
            },
          });
      }
      for (const task of [TEMPLATE_A, TEMPLATE_B]) {
        await tx
          .collection('task_templates')
          .doc(task)
          .set({
            data: {
              enabled: true,
              title: '云隔离合成任务',
              steps: ['仅验证，不是用户任务'],
              tags: [],
              durationMin: 2,
            },
          });
      }
    });
    const accounts = createRepository({ db });
    const instant = new Date();
    const tasks = createTasksDomain({
      store: createTransactionalTasksStore({ db }),
      clock: () => instant,
    });
    // Synthetic signing material applies only to this fixed isolated batch. It
    // must never be copied into the formal environment or its receipt policy.
    const receiptPolicy = createReceiptPolicy({
      activeKeyId: 'synthetic-business-validation',
      keys: { 'synthetic-business-validation': Buffer.alloc(32, 0x25) },
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    const router = createCandidateRouter({
      resolveAccount: accounts.getOrCreateAccount,
      journalRepository: createCloudJournalRepository(db),
      journalReceiptPolicy: receiptPolicy,
      now: () => instant,
      domainHandlers: { tasks: tasks.handle },
    });
    const date = require('../../cloudfunctions/moodsky/shared/date').businessDate(instant);
    let serial = 0;
    const call = (action, payload, requestId = 'req_bv_' + ++serial, owner = OWNER) =>
      router({ apiVersion: '1', action, payload, requestId }, { OPENID: id('openid_' + owner) });
    const expectOK = async (promise) => {
      const result = await promise;
      assert.equal(result.ok, true);
      return result.data;
    };
    let entry;
    const original = {
      date,
      weather: 'CUSTOM',
      weatherName: '合成彩虹',
      text: 'SYNTHETIC BUSINESS VALIDATION',
      tags: ['REST'],
      expectedVersion: 0,
    };
    await check('journal-create-and-replay', async () => {
      entry = (await expectOK(call('journal.upsert', original, 'req_bv_create'))).entry;
      assert.equal(entry.version, 1);
      assert.equal(
        (await expectOK(call('journal.upsert', original, 'req_bv_create'))).entry.id,
        entry.id,
      );
    });
    await check('seven-weather-current-contract', async () => {
      for (const weather of [
        'SUNNY',
        'PARTLY_CLOUDY',
        'CLOUDY',
        'RAINY',
        'STORMY',
        'TYPHOON',
        'CUSTOM',
      ]) {
        entry = (
          await expectOK(
            call('journal.upsert', {
              date,
              weather,
              text: original.text,
              tags: original.tags,
              ...(weather === 'CUSTOM' ? { weatherName: '合成彩虹' } : {}),
              expectedVersion: entry.version,
            }),
          )
        ).entry;
        assert.equal(entry.weather, weather);
      }
    });
    await check('journal-parallel-version-conflict', async () => {
      const input = { date, weather: 'SUNNY', text: original.text, expectedVersion: entry.version };
      const result = await Promise.all([
        call('journal.upsert', input, 'req_bv_race_a'),
        call('journal.upsert', input, 'req_bv_race_b'),
      ]);
      assert.equal(result.filter((r) => r.ok).length, 1);
      assert.equal(result.find((r) => !r.ok).error.code, 'CONFLICT');
      entry = result.find((r) => r.ok).data.entry;
    });
    await check('journal-owner-and-archive-privacy', async () => {
      assert.equal((await expectOK(call('journal.get', { date }, undefined, OTHER))).entry, null);
      const archive = await expectOK(call('review.monthArchive', { month: date.slice(0, 7) }));
      assert.equal(archive.cards.length, 1);
      assert.doesNotMatch(JSON.stringify(archive), /SYNTHETIC BUSINESS VALIDATION|ownerId|openid/);
    });
    await check('task-parallel-idempotency', async () => {
      const input = { taskId: TEMPLATE_A, transition: 'select' };
      const result = await Promise.all([
        call('tasks.transition', input, 'req_bv_task_same', OTHER),
        call('tasks.transition', input, 'req_bv_task_same', OTHER),
      ]);
      assert.ok(result.every((r) => r.ok));
      assert.deepEqual(result.map((r) => r.data.replayed).sort(), [false, true]);
      const row = (
        await db
          .collection('task_history')
          .doc(historyId(OTHER, TEMPLATE_A, date))
          .get()
      ).data;
      assert.equal(row.state, 'selected');
    });
    await check('task-parallel-terminal-conflict', async () => {
      const result = await Promise.all([
        call(
          'tasks.transition',
          { taskId: TEMPLATE_A, transition: 'complete' },
          'req_bv_complete',
          OTHER,
        ),
        call('tasks.transition', { taskId: TEMPLATE_A, transition: 'skip' }, 'req_bv_skip', OTHER),
      ]);
      assert.equal(result.filter((r) => r.ok).length, 1);
      assert.equal(result.find((r) => !r.ok).error.code, 'CONFLICT');
    });
    await check('task-history-owner-and-pagination', async () => {
      const data = await expectOK(
        call('tasks.history', { from: date, to: date, limit: 1 }, undefined, OTHER),
      );
      assert.equal(data.entries.length, 1);
      assert.equal(data.nextCursor, null);
      assert.equal(
        (await expectOK(call('tasks.history', { from: date, to: date }, undefined, OWNER))).entries
          .length,
        0,
      );
    });
    await check('real-transaction-rollback-after-task-history', async () => {
      const faultDB = {
        ...db,
        runTransaction: (work, retries) =>
          db.runTransaction(
            (tx) =>
              work({
                collection: (name) => {
                  const ref = tx.collection(name);
                  if (name !== 'request_receipts') {
                    return ref;
                  }
                  return {
                    ...ref,
                    doc: (key) => ({
                      ...ref.doc(key),
                      set() {
                        const error = new Error('Synthetic rollback fault');
                        error.code = 'SYNTHETIC_FAULT';
                        throw error;
                      },
                    }),
                  };
                },
              }),
            retries,
          ),
      };
      const store = createTransactionalTasksStore({ db: faultDB });
      const domain = createTasksDomain({ store, clock: () => instant });
      await assert.rejects(
        domain.handle({
          action: 'tasks.transition',
          actor: { accountId: OTHER },
          requestId: 'req_bv_fault',
          payload: { taskId: TEMPLATE_B, transition: 'select' },
        }),
        (error) => error.code === 'SYNTHETIC_FAULT',
      );
      assert.equal(
        (
          await db
            .collection('task_history')
            .doc(historyId(OTHER, TEMPLATE_B, date))
            .get()
        ).data,
        null,
      );
      assert.equal(
        (
          await db
            .collection('request_receipts')
            .doc(receiptId(OTHER, 'tasks.transition', 'req_bv_fault'))
            .get()
        ).data,
        null,
      );
    });
    await check('disabled-account-gate', async () => {
      assert.equal(
        (await call('journal.get', { date }, undefined, DISABLED)).error.code,
        'ACCOUNT_DISABLED',
      );
      assert.equal(
        (
          await call(
            'tasks.transition',
            { taskId: TEMPLATE_A, transition: 'select' },
            undefined,
            DISABLED,
          )
        ).error.code,
        'ACCOUNT_DISABLED',
      );
    });
    report = {
      passed: results.length,
      failed: 0,
      results,
      scope: 'isolated-synthetic-business-services',
      phoneVerified: false,
      productionEnabled: false,
    };
  } catch {
    report = {
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length || 1,
      results,
      scope: 'isolated-synthetic-business-services',
      phoneVerified: false,
      productionEnabled: false,
    };
  }
  await db.runTransaction(async (tx) => {
    await tx
      .collection('accounts')
      .doc(MANIFEST)
      .update({
        data: {
          status: report.failed ? 'failed' : 'completed',
          report,
          finishedAt: new Date().toISOString(),
        },
      });
  });
  return report;
}
module.exports = { runValidation, inspectValidation };
