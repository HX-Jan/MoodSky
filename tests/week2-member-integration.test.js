const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeek2Backend } = require('../tools/week2-integration/backend');
const { createCloudStore } = require('../cloudfunctions/moodsky/stores/account-store');
const { createMemoryTasksStore } = require('../cloudfunctions/moodsky/stores/tasks-store');
const { databaseFixture } = require('./helpers/w2-database');
const { createSyntheticReceiptPolicy } = require('./helpers/receipt-fixture');
const { LAYOUT } = require('../tools/journal-storage/cloudbase-candidate');
const NOW = () => new Date('2026-10-25T00:00:00.000Z');
const template = {
  _id: 'synthetic_water',
  title: '合成喝水任务',
  steps: ['合成步骤'],
  durationMin: 2,
  enabled: true,
  tags: ['indoor'],
};
function fixture() {
  const f = databaseFixture({ 'task_templates:synthetic_water': template });
  const store = createCloudStore({ database: () => f.db });
  const tasks = createMemoryTasksStore({ templates: [template] });
  const router = createWeek2Backend({
    db: f.db,
    now: NOW,
    receiptPolicy: createSyntheticReceiptPolicy(),
    accountUniqueIndexReady: true,
    newAccountJournalLayout: LAYOUT,
    taskSuggestionsEnabled: true,
    memberServices: { store, taskStore: tasks, env: {} },
  });
  let serial = 0;
  const call = (action, payload = {}, openid = 'synthetic_openid_a', id) =>
    router(
      {
        apiVersion: '1',
        action,
        payload,
        requestId: id || 'req_joint_' + ++serial,
      },
      openid ? { OPENID: openid } : {},
    );
  return { ...f, store, tasks, call };
}
test('joint candidate creates one repository account and preserves custom weather and private preferences', async () => {
  const f = fixture();
  const prefs = await f.call('account.preferences', {
    operation: 'set',
    decorationsEnabled: false,
  });
  assert.equal(prefs.ok, true, JSON.stringify(prefs));
  assert.equal(prefs.data.decorationsEnabled, false);
  const saved = await f.call('journal.upsert', {
    date: '2026-10-25',
    weather: 'CUSTOM',
    weatherName: '合成云😀',
    expectedVersion: 0,
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const rows = Object.entries(f.inspect()).filter(([key]) => key.startsWith('accounts:'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1].journalLayout, LAYOUT);
  assert.equal(
    (await f.call('review.monthArchive', { month: '2026-10' })).data.cards[0].weatherName,
    '合成云😀',
  );
  assert.equal(
    (await f.call('account.preferences', { operation: 'get' }, 'synthetic_openid_b')).data
      .decorationsEnabled,
    true,
  );
  assert.equal(
    (await f.call('review.monthArchive', { month: '2026-10' }, 'synthetic_openid_b')).data.cards
      .length,
    0,
  );
});
test('joint candidate preserves readonly public suggestions and bridges member history to current items contract', async () => {
  const f = fixture();
  const publicRows = await f.call('tasks.suggestions', {}, '');
  assert.equal(publicRows.ok, true, JSON.stringify(publicRows));
  assert.equal(publicRows.data.readOnly, true);
  assert.equal(publicRows.data.items[0].description, '合成步骤');
  assert.equal(Object.keys(f.inspect()).filter((k) => k.startsWith('accounts:')).length, 0);
  const payload = { taskId: template._id, transition: 'select' };
  assert.equal(
    (await f.call('tasks.transition', payload, undefined, 'req_joint_task_001')).ok,
    true,
  );
  assert.equal(
    (await f.call('tasks.transition', payload, undefined, 'req_joint_task_001')).data.replayed,
    true,
  );
  assert.equal(
    (await f.call('tasks.history', { from: '2026-10-25', to: '2026-10-25' })).data.items[0].state,
    'selected',
  );
  assert.equal(
    (await f.call('tasks.history', { from: '2026-10-25', to: '2026-10-25' }, 'synthetic_openid_b'))
      .data.items.length,
    0,
  );
  assert.equal(f.tasks.snapshot().history.length, 1);
});
test('joint candidate disables the shared account and denies later private actions without claiming cleanup completed', async () => {
  const f = fixture();
  await f.call('account.preferences', { operation: 'get' });
  const closed = await f.call('account.close', { confirm: 'CLOSE' });
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.data.cleanup.state, 'pending');
  assert.equal(closed.data.sessionRevoked, false);
  assert.equal(closed.data.receipt, null);
  for (const [action, payload] of [
    ['journal.get', { date: '2026-10-25' }],
    ['tasks.history', { from: '2026-10-25', to: '2026-10-25' }],
  ]) {
    assert.equal((await f.call(action, payload)).error.code, 'ACCOUNT_DISABLED');
  }
});

test('joint candidate does not report a successful disable when the account update affects no row', async () => {
  const f = fixture();
  await f.call('account.preferences', { operation: 'get' });
  const original = f.store.setAccountStatus;
  f.store.setAccountStatus = async (id, ...args) => {
    // Synthetic disappearing-row fault, never a real database operation.
    await f.db.collection('accounts').doc(id).remove();
    return original(id, ...args);
  };
  const result = await f.call('account.close', { confirm: 'CLOSE' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  const jobs = Object.entries(f.inspect()).filter(([key]) => key.startsWith('cleanup_jobs:'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0][1].state, 'failed');
});
