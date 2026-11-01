const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWorkerEntry,
  TIMER_NAME,
  readWorkerIdentity,
} = require('../cloudfunctions/moodsky/production/worker');
const { readProductionConfig, ENV_ID } = require('../cloudfunctions/moodsky/production/config');
const { withOfflineWxDatabase } = require('./helpers/offline-wx-database');
const { createProductionDatabase } = require('../cloudfunctions/moodsky/production/database');

const config = readProductionConfig({
  MOODSKY_PRODUCTION_ENABLED: 'true',
  MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
  MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
  MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
});
const event = { Type: 'Timer', TriggerName: TIMER_NAME, Time: '2026-10-30T10:00:00Z' };
const context = (fields = {}) => ({
  environment: JSON.stringify({ TCB_ENV: ENV_ID, TCB_SOURCE: 'wx_trigger', ...fields }),
});

test('scheduler authorization rejects forged timer events and never opens the database', async () => {
  let opens = 0;
  for (const platform of [
    {},
    { environment: '{invalid' },
    context({ TCB_ENV: 'wrong' }),
    context({ TCB_SOURCE: 'wx_devtools', WX_OPENID: 'synthetic_user' }),
    context({ TCB_SOURCE: 'wx_client', WX_OPENID: 'synthetic_user' }),
    context({ TCB_SOURCE: 'wx_trigger,scf' }),
    context({ WX_OPENID: 'synthetic_user' }),
    context({ TRIGGER_SRC: 'timer', TCB_SOURCE: 'wx_client' }),
    { namespace: ENV_ID },
    { environ: 'TCB_ENV=' + ENV_ID + ';TRIGGER_SRC=timer;TRIGGER_SRC=timer' },
  ]) {
    const worker = createWorkerEntry({
      readConfig: () => config,
      readIdentity: () => readWorkerIdentity(platform),
      openDatabase: () => {
        opens += 1;
        throw new Error('forbidden database access');
      },
    });
    assert.deepEqual(await worker(event), { ok: false, code: 'FORBIDDEN' });
  }
  assert.equal(opens, 0);
});

test('fresh scheduler context runs bounded maintenance and does not authorize the next client invocation', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const db = createProductionDatabase(nativeDb);
      let platform = context();
      let opens = 0;
      const worker = createWorkerEntry({
        readConfig: () => config,
        readIdentity: () => readWorkerIdentity(platform),
        openDatabase: () => {
          opens += 1;
          return db;
        },
      });
      for (const invalid of [{ ...event, TriggerName: 'wrong' }, {}]) {
        assert.deepEqual(await worker(invalid), { ok: false, code: 'FORBIDDEN' });
      }
      assert.deepEqual(await worker(event), {
        ok: true,
        expiredExports: 0,
        examined: 0,
        completed: 0,
        retry: 0,
      });
      platform = context({ TCB_SOURCE: 'wx_client', WX_OPENID: 'synthetic_user' });
      assert.deepEqual(await worker(event), { ok: false, code: 'FORBIDDEN' });
      assert.equal(opens, 1);
    },
    { nativeDatabase: true, productionMaintenanceReads: true },
  );
});

test('CloudBase timer envelope uses fresh platform authorization without assuming the generic SCF Type field', async () => {
  await withOfflineWxDatabase(
    {},
    async ({ nativeDb }) => {
      const db = createProductionDatabase(nativeDb);
      let platform = context();
      let opens = 0;
      const worker = createWorkerEntry({
        readConfig: () => config,
        readIdentity: () => readWorkerIdentity(platform),
        openDatabase: () => {
          opens++;
          return db;
        },
      });
      const envelope = { TriggerName: TIMER_NAME };
      assert.deepEqual(await worker(envelope), {
        ok: true,
        expiredExports: 0,
        examined: 0,
        completed: 0,
        retry: 0,
      });
      platform = context({
        TCB_SOURCE: 'wx_client',
        WX_OPENID: 'synthetic_user',
        TRIGGER_SRC: 'timer',
      });
      assert.deepEqual(await worker(envelope), { ok: false, code: 'FORBIDDEN' });
      platform = context({ TCB_SOURCE: 'wx_client', WX_OPENID: '' });
      assert.deepEqual(await worker(envelope), { ok: false, code: 'FORBIDDEN' });
      platform = context({ TCB_ENV: 'wrong' });
      assert.deepEqual(await worker(envelope), { ok: false, code: 'FORBIDDEN' });
      assert.equal(opens, 1);
    },
    { nativeDatabase: true, productionMaintenanceReads: true },
  );
});

test('CloudBase TRIGGER_SRC must come from the fresh platform snapshot, never the event or process environment', async () => {
  const prior = process.env.TRIGGER_SRC;
  process.env.TRIGGER_SRC = 'timer';
  try {
    await withOfflineWxDatabase(
      {},
      async ({ nativeDb }) => {
        const db = createProductionDatabase(nativeDb);
        let platform = context({ TCB_SOURCE: '', TRIGGER_SRC: 'timer' });
        let opens = 0;
        const worker = createWorkerEntry({
          readConfig: () => config,
          readIdentity: () => readWorkerIdentity(platform),
          openDatabase: () => {
            opens++;
            return db;
          },
        });
        assert.equal((await worker(event)).ok, true);
        platform = { environ: 'TCB_ENV=' + ENV_ID + ';TRIGGER_SRC=timer' };
        assert.equal((await worker(event)).ok, true);
        platform = context({ TCB_SOURCE: '' });
        assert.deepEqual(await worker({ ...event, TRIGGER_SRC: 'timer' }), {
          ok: false,
          code: 'FORBIDDEN',
        });
        assert.equal(opens, 2);
      },
      { nativeDatabase: true, productionMaintenanceReads: true },
    );
  } finally {
    if (prior === undefined) {
      delete process.env.TRIGGER_SRC;
    } else {
      process.env.TRIGGER_SRC = prior;
    }
  }
});
