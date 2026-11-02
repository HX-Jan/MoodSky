const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const api = require('../miniprogram/services/api');
const { createJournalController } = require('../miniprogram/modules/journal/controller');
const { startLoopbackBackend, MARKER } = require('./helpers/loopback-backend');
const now = () => new Date('2026-10-21T04:00:00.000Z');
const date = '2026-10-21';
async function fixture(t) {
  const server = await startLoopbackBackend({ now });
  t.after(() => server.close());
  const client = api.createApiClient(
    {
      cloud: {
        async callFunction({ data }) {
          const response = await globalThis.fetch(server.url + '/api', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-moodsky-test': MARKER },
            body: JSON.stringify(data),
          });
          if (response.status !== 200) {
            throw new Error('Synthetic HTTP transport failed');
          }
          return { result: await response.json() };
        },
      },
    },
    { cloudEnabled: true, cloudEnvId: 'SIMULATED-loopback' },
  );
  const filename = path.resolve(__dirname, '../miniprogram/modules/journal/service.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (id) =>
      id.endsWith('/services/api')
        ? { createRequest: api.createRequest, call: (request) => client.call(request) }
        : localRequire(id),
  });
  const changes = [];
  const controller = createJournalController({
    service: module.exports,
    now,
    onChanged: (change) => changes.push(change),
  });
  return { ...server, client, service: module.exports, controller, changes };
}
test('real loopback HTTP carries actual client/service/controller CRUD with serialized private text', async (t) => {
  const f = await fixture(t);
  await f.controller.loadDate(date);
  f.controller.chooseWeather('SUNNY');
  f.controller.setText('SIMULATED HTTP 😀\nsecond line');
  assert.equal(await f.controller.save(), true);
  assert.equal(f.controller.getState().entry.version, 1);
  assert.equal((await f.service.get(date)).data.entry.text, 'SIMULATED HTTP 😀\nsecond line');
  f.controller.chooseWeather('RAINY');
  assert.equal(await f.controller.save(), true);
  assert.equal(f.controller.getState().entry.version, 2);
  f.controller.requestDelete();
  assert.equal(await f.controller.confirmDelete(), true);
  assert.equal((await f.service.get(date)).data.entry, null);
  assert.deepEqual(
    f.changes.map((c) => c.kind),
    ['saved', 'saved', 'deleted'],
  );
  assert.doesNotMatch(JSON.stringify(f.requests), /HTTP 😀|second line|payload|tags|ownerId/);
});
test('a real HTTP disconnect after commit and malformed delete response preserve the exact original retry', async (t) => {
  const f = await fixture(t);
  await f.controller.loadDate(date);
  f.controller.chooseWeather('CLOUDY');
  f.controller.setText('SIMULATED real socket loss');
  f.setFault('journal.upsert', 'drop');
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getState().errorCode, 'NETWORK_ERROR');
  assert.equal(f.controller.getState().pendingRetry, true);
  assert.equal((await f.service.get(date)).data.entry.version, 1);
  assert.equal(await f.controller.retry(), true);
  const saves = f.requests.filter((r) => r.action === 'journal.upsert');
  assert.equal(saves[0].requestId, saves[1].requestId);
  assert.equal(f.controller.getState().entry.version, 1);
  f.setFault('journal.delete', 'malformed');
  f.controller.requestDelete();
  assert.equal(await f.controller.confirmDelete(), false);
  assert.equal(f.controller.getState().errorCode, 'INVALID_RESPONSE');
  assert.equal(f.controller.getState().pendingRetry, true);
  assert.equal(await f.controller.retry(), true);
  assert.equal(f.controller.getState().entry, null);
  const deletes = f.requests.filter((r) => r.action === 'journal.delete');
  assert.equal(deletes[0].requestId, deletes[1].requestId);
});
test('loopback transport rejects client identity injection and oversized traffic without dispatching a business write', async (t) => {
  const f = await fixture(t);
  const request = api.createRequest('journal.get', { date });
  const before = f.requests.length;
  const wrongMarker = await globalThis.fetch(f.url + '/api', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  assert.equal(wrongMarker.status, 403);
  assert.equal(f.requests.length, before);
  const oversized = await globalThis.fetch(f.url + '/api', {
    method: 'POST',
    headers: { 'x-moodsky-test': MARKER },
    body: 'x'.repeat(16385),
  });
  assert.equal(oversized.status, 413);
  assert.equal(f.requests.length, before);
  const forged = await globalThis.fetch(f.url + '/api', {
    method: 'POST',
    headers: { 'x-moodsky-test': MARKER },
    body: JSON.stringify({ ...request, payload: { date, ownerId: 'synthetic_b' } }),
  });
  const result = await forged.json();
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert.equal((await f.service.get(date)).data.entry, null);
  assert.equal(f.server.address().address, '127.0.0.1');
});
