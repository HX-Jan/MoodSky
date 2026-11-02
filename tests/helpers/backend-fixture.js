const assert = require('node:assert/strict');
const {
  createCandidateRouter: createRouter,
} = require('../../cloudfunctions/moodsky/candidate-router');
const { createMemoryJournalRepository } = require('./memory-journal-repository');
const { createSyntheticReceiptPolicy } = require('./receipt-fixture');

function fixture() {
  const repository = createMemoryJournalRepository();
  let clock = new Date('2026-10-17T16:00:00.000Z'); // 2026-10-18 in China.
  let serial = 0;
  const identities = {
    a: { id: 'synthetic_a', status: 'active' },
    b: { id: 'synthetic_b', status: 'active' },
    disabled: { id: 'synthetic_a', status: 'disabled' },
  };
  const router = createRouter({
    journalRepository: repository,
    journalReceiptPolicy: createSyntheticReceiptPolicy(),
    now: () => clock,
    resolveAccount: async (openid) => identities[openid],
  });
  const request = (action, payload, id = 'req_backend_' + ++serial) => ({
    apiVersion: '1',
    requestId: id,
    action,
    payload,
  });
  const call = (action, payload, { id, actor = 'a' } = {}) =>
    router(request(action, payload, id), { OPENID: actor });
  const save = (payload = {}, options) =>
    call(
      'journal.upsert',
      { date: '2026-10-18', weather: 'SUNNY', expectedVersion: 0, ...payload },
      options,
    );
  return {
    repository,
    router,
    request,
    call,
    save,
    setClock: (value) => {
      clock = new Date(value);
    },
  };
}
const error = (result, code) => {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
};

module.exports = { fixture, error };
