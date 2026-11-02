const test = require('node:test');
const assert = require('node:assert/strict');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { backendClient } = require('./helpers/backend-client');
const now = () => new Date('2026-10-18T00:00:00.000Z');

test('real client service and controller recover a lost committed save/delete using original requests', async () => {
  const f = backendClient();
  const changes = [];
  const controller = createJournalController({
    service: f.journal,
    now,
    onChanged: (value) => changes.push(value),
  });
  await controller.loadDate();
  controller.chooseWeather('RAINY');
  controller.setText('SYNTHETIC private draft');
  f.loseNextResponse('journal.upsert');
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().pendingRetry, true);
  assert.equal(controller.getState().text, 'SYNTHETIC private draft');
  assert.equal(changes.length, 0);
  const original = f.requests.at(-1);
  assert.equal(await controller.retry(), true);
  assert.equal(f.requests.at(-1), original);
  assert.equal(controller.getState().entry.version, 1);
  assert.equal(f.repository.inspect('synthetic_a').revision, 1);
  assert.equal(changes.length, 1);
  controller.requestDelete();
  f.loseNextResponse('journal.delete');
  assert.equal(await controller.confirmDelete(), false);
  const deletion = f.requests.at(-1);
  assert.equal(changes.length, 1);
  assert.equal(await controller.retry(), true);
  assert.equal(
    f.requests.filter((request) => request.action === 'journal.delete').at(-1),
    deletion,
  );
  assert.equal(controller.getState().entry, null);
  assert.equal(controller.getState().text, '');
  assert.equal(f.repository.inspect('synthetic_a').revision, 2);
  assert.equal(changes.length, 2);
  controller.dispose();
});

test('two real controllers preserve losing input on a backend version conflict and require explicit reload', async () => {
  const f = backendClient();
  const first = createJournalController({ service: f.journal, now });
  const second = createJournalController({ service: f.journal, now });
  await Promise.all([first.loadDate(), second.loadDate()]);
  first.chooseWeather('SUNNY');
  first.setText('SYNTHETIC winner');
  second.chooseWeather('RAINY');
  second.setText('SYNTHETIC keep this draft');
  assert.equal(await first.save(), true);
  assert.equal(await second.save(), false);
  assert.equal(second.getState().errorCode, 'CONFLICT');
  assert.equal(second.getState().text, 'SYNTHETIC keep this draft');
  assert.equal(second.getState().requiresReload, true);
  assert.equal(second.getState().canSave, false);
  await second.loadDate();
  assert.equal(second.getState().confirm, 'reload');
  await second.confirmReload();
  assert.equal(second.getState().text, 'SYNTHETIC winner');
  assert.equal(second.getState().entry.version, 1);
  first.dispose();
  second.dispose();
});

test('an account-disabled backend response clears private controller state instead of retrying', async () => {
  const f = backendClient();
  const controller = createJournalController({ service: f.journal, now });
  await controller.loadDate();
  controller.chooseWeather('SUNNY');
  controller.setText('SYNTHETIC secret');
  f.setActor('disabled');
  assert.equal(await controller.save(), false);
  assert.equal(controller.getState().errorCode, 'ACCOUNT_DISABLED');
  assert.equal(controller.getState().text, '');
  assert.equal(controller.getState().entry, null);
  assert.equal(controller.getState().pendingRetry, false);
  assert.equal(f.repository.inspect('synthetic_a').revision, 0);
  controller.dispose();
});

test('real journal/review clients agree on saved IDs, private details, distribution and deletion', async () => {
  const f = backendClient();
  const result = await f.journal.submit(
    f.journal.createSaveRequest({
      date: '2026-10-18',
      weather: 'CLOUDY',
      expectedVersion: 0,
      tags: ['REST'],
      text: 'SYNTHETIC private detail',
    }),
  );
  const calendar = await f.reader.calendar('2026-10');
  assert.equal(calendar.data.entries[0].id, result.data.entry.id);
  assert.doesNotMatch(JSON.stringify(calendar), /private detail|REST|ownerId/);
  assert.equal((await f.reader.getEntry('2026-10-18')).data.entry.text, 'SYNTHETIC private detail');
  const insights = await f.reader.insights(7);
  assert.equal(insights.distribution.data.sourceRevision, insights.timeline.data.sourceRevision);
  assert.equal(insights.timeline.data.recordCount, 1);
  await f.journal.submit(f.journal.createDeleteRequest({ date: '2026-10-18', expectedVersion: 1 }));
  assert.equal((await f.reader.monthArchive('2026-10')).data.recordCount, 0);
  assert.equal((await f.reader.getEntry('2026-10-18')).data.entry, null);
});
