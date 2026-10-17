// Independent QT01/QT02/QT05 checks. No cloud calls; synthetic inputs only.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fixture,
  request,
  payloadFor,
  runMatrix,
} = require('../tools/qizhen/local-permission-matrix');
const { ACTIONS, createRouter } = require('../cloudfunctions/moodsky/router');
const { createLocalAccount } = require('../miniprogram/modules/account/week-one');
const { createMemoryJournalService } = require('../miniprogram/modules/journal/demo-service');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { AppError } = require('../miniprogram/shared/result');

function storage() {
  const values = new Map();
  return {
    values,
    getStorageSync: (k) => values.get(k),
    setStorageSync: (k, v) => values.set(k, v),
    removeStorageSync: (k) => values.delete(k),
  };
}

test('QT-M01 AUTH-01/07/09/10 six identities across every registered private/operator action', async () => {
  const rows = await runMatrix();
  assert.equal(
    rows.length,
    Object.values(ACTIONS).filter((d) => ['private', 'operator'].includes(d.access)).length * 6,
  );
  for (const row of rows) {
    assert.equal(row.matched, true, JSON.stringify(row));
  }
});

test('QT-M02 AUTH-02/07 all actions reject payload and envelope identity spoofing before DB reads', async () => {
  const f = fixture();
  for (const action of Object.keys(ACTIONS)) {
    for (const field of ['ownerId', 'owner', 'accountId', 'openid', 'OPENID', 'role', 'roles']) {
      for (const location of ['payload', 'envelope']) {
        const r = request(action, payloadFor(action));
        (location === 'payload' ? r.payload : r)[field] =
          field === 'roles' ? ['data_operator'] : 'B';
        const result = await f.route(r, { OPENID: 'synthetic_A' });
        assert.equal(result.error.code, 'INVALID_REQUEST', `${action}/${location}/${field}`);
      }
    }
  }
  assert.deepEqual(f.reads, []);
});

test('QT-M03 AUTH-09/10 the same trusted context loses access on the next request after revocation', async () => {
  const f = fixture();
  const context = { OPENID: 'synthetic_O' };
  assert.equal(
    (await f.route(request('admin.updatePlace'), context)).error.code,
    'NOT_IMPLEMENTED',
  );
  f.grants[0].enabled = false;
  assert.equal((await f.route(request('admin.updatePlace'), context)).error.code, 'FORBIDDEN');
  f.accounts.find((a) => a._id === 'O').status = 'disabled';
  const readsBefore = f.reads.length;
  assert.equal(
    (await f.route(request('admin.updatePlace'), context)).error.code,
    'ACCOUNT_DISABLED',
  );
  assert.deepEqual(
    f.reads.slice(readsBefore).map((r) => r.name),
    ['accounts'],
  );
  assert.equal(
    (await f.route(request('account.downloadExport'), context)).error.code,
    'ACCOUNT_DISABLED',
  );
});

test('QT-M04 AUTH-12 receipt permission cannot become a private or operator identity', async () => {
  const route = createRouter({
    resolveCleanupReceipt: async (value) =>
      value === 'synthetic_receipt'
        ? { permission: 'cleanup_status', jobId: 'synthetic_job_A' }
        : null,
  });
  assert.equal(
    (await route(request('account.cleanupStatus', { receipt: 'bad' }))).error.code,
    'FORBIDDEN',
  );
  assert.equal(
    (await route(request('account.cleanupStatus', { receipt: 'synthetic_receipt' }))).error.code,
    'NOT_IMPLEMENTED',
  );
  for (const [action, d] of Object.entries(ACTIONS)) {
    if (['private', 'operator'].includes(d.access)) {
      const result = await route(
        request(action, { ...payloadFor(action), receipt: 'synthetic_receipt' }),
      );
      assert.equal(result.error.code, 'UNAUTHENTICATED', action);
    }
  }
  // Binding to jobId is deliberately NOT declared passed: business is a stub.
});

test('QT-M05 AUTH-15 unexpected adapter failure does not return or log synthetic private fields', async (t) => {
  const logged = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    t.mock.method(console, method, (...args) => logged.push(args));
  }
  const marker = 'TEST_QT_PRIVATE_NOTE_TOKEN_LOCATION';
  const route = createRouter({
    resolveAccount: async () => {
      throw new Error(marker);
    },
  });
  const result = await route(request('journal.get', { date: '2026-10-17', text: marker }), {
    OPENID: marker,
  });
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  assert.deepEqual(Object.keys(result).sort(), ['apiVersion', 'error', 'ok', 'requestId']);
  assert.deepEqual(logged, []);
});

test('QT-M06 LIFE-05 local export expires at exactly 24 hours and remains empty after reopening', () => {
  let clock = 1000;
  const s = storage();
  let account = createLocalAccount(s, () => clock);
  account.completeExport(account.startExport('JSON'));
  const expiry = account.snapshot().exportTask.expiresAt;
  assert.equal(expiry - clock, 86400000);
  clock = expiry - 1;
  assert.equal(account.snapshot().exportTask.status, 'completed');
  clock = expiry;
  assert.equal(account.snapshot().exportTask.status, 'expired');
  assert.equal(account.snapshot().exportTask.content, '');
  account = createLocalAccount(s, () => ++clock);
  assert.equal(account.snapshot().exportTask.content, '');
  // This has no storage object, scheduler or signed URL: local boundary only.
});

test('QT-M07 AUTH-14/LIFE-10 switching A to B to A cannot release an old export callback', () => {
  const account = createLocalAccount(storage(), () => 1000);
  const old = account.startExport('JSON');
  account.switchAccount('demo-b');
  account.savePreference('decorationsEnabled', false);
  account.switchAccount('demo-a');
  const fresh = account.startExport('Markdown');
  assert.equal(account.completeExport(old), false);
  assert.equal(account.snapshot().exportTask.status, 'processing');
  assert.equal(account.completeExport(fresh), true);
  assert.doesNotMatch(account.snapshot().exportTask.content, /demo-b/);
  account.switchAccount('demo-b');
  assert.equal(account.snapshot().exportTask, null);
  assert.equal(account.snapshot().preferences.decorationsEnabled, false);
});

test('QT-M08 LIFE-09/11/14 interrupted local closure remains disabled and does not change B', () => {
  const s = storage();
  let account = createLocalAccount(s);
  const old = account.startClosure();
  account.advanceClosure(old, 35);
  account.switchAccount('demo-b');
  account.savePreference('cardTextPreview', true);
  account.switchAccount('demo-a');
  assert.equal(account.snapshot().closureTask.status, 'failed');
  assert.equal(account.advanceClosure(old, 100), false);
  account = createLocalAccount(s);
  assert.equal(account.snapshot().status, 'disabled');
  assert.throws(() => account.startExport('JSON'), /ACCOUNT_DISABLED/);
  account.switchAccount('demo-b');
  assert.equal(account.snapshot().status, 'active');
  assert.equal(account.snapshot().preferences.cardTextPreview, true);
});

test('QT-M09 LIFE-06 deletion synchronizes four derived demo views and corrects the denominator', async () => {
  const now = () => new Date('2026-10-17T04:00:00Z');
  const journal = createMemoryJournalService({ now });
  const store = createLocalStore();
  const review = createReviewDemoService({ store, now });
  for (const date of ['2026-10-15', '2026-10-16', '2026-10-17']) {
    await journal.submit(
      journal.createSaveRequest({
        date,
        weather: 'SUNNY',
        expectedVersion: 0,
        text: 'TEST_QT_NOTE',
      }),
    );
    await store.syncFromJournal(journal, { kind: 'saved', date });
  }
  assert.equal((await review.calendar('2026-10')).data.recordCount, 3);
  await journal.submit(journal.createDeleteRequest({ date: '2026-10-17', expectedVersion: 1 }));
  await store.syncFromJournal(journal, { kind: 'deleted', date: '2026-10-17' });
  assert.equal((await journal.get('2026-10-17')).data.entry, null);
  const views = [
    await review.calendar('2026-10'),
    await review.monthArchive('2026-10'),
    await review.distribution(30),
    await review.timeline(30),
  ];
  for (const view of views) {
    assert.equal(view.data.recordCount, 2);
    assert.doesNotMatch(JSON.stringify(view), /TEST_QT_NOTE/);
  }
  assert.equal(
    (await review.calendar('2026-10')).data.entries.some((e) => e.date === '2026-10-17'),
    false,
  );
  assert.equal(
    (await review.monthArchive('2026-10')).data.cards.some((e) => e.date === '2026-10-17'),
    false,
  );
  const timeline = (await review.timeline(30)).data;
  assert.equal(
    timeline.items.some((e) => e.date === '2026-10-17'),
    false,
  );
  assert.equal(timeline.trendEligible, false);
  assert.equal(
    (await review.distribution(30)).data.bins.reduce((n, b) => n + b.count, 0),
    2,
  );
});

test('QT-M10 LIFE-16 unsaved draft is cleared by reset and late reads cannot revive it', async () => {
  const now = () => new Date('2026-10-17T04:00:00Z');
  let release;
  const service = {
    ...createMemoryJournalService({ now }),
    get: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const c = createJournalController({ service, now });
  const pending = c.loadDate();
  c.reset();
  release({ ok: true, data: { entry: null } });
  await pending;
  assert.equal(c.getState().loaded, false);
  const d = createJournalController({ service: createMemoryJournalService({ now }), now });
  await d.loadDate();
  d.chooseWeather('SUNNY');
  d.setText('TEST_QT_UNSAVED');
  assert.equal(d.getState().text, 'TEST_QT_UNSAVED');
  d.reset();
  assert.equal(d.getState().text, '');
});

test('QT-M11 AUTH-15 account errors clear private page state instead of showing raw error text', async () => {
  const now = () => new Date('2026-10-17T04:00:00Z');
  for (const code of ['ACCOUNT_DISABLED', 'UNAUTHENTICATED']) {
    const service = createMemoryJournalService({ now });
    service.submit = async () => {
      throw new AppError(code, 'TEST_QT_SECRET_RAW_MESSAGE');
    };
    const c = createJournalController({ service, now });
    await c.loadDate();
    c.chooseWeather('SUNNY');
    c.setText('TEST_QT_PRIVATE_DRAFT');
    await c.save();
    assert.equal(c.getState().text, '');
    assert.doesNotMatch(
      JSON.stringify(c.getState()),
      /TEST_QT_SECRET_RAW_MESSAGE|TEST_QT_PRIVATE_DRAFT/,
    );
  }
});
