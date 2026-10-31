const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountAdapters } = require('../cloudfunctions/moodsky/services/account-adapters');
const { createAccountDataSources } = require('../cloudfunctions/moodsky/services/account-data');
const { databaseFixture } = require('./helpers/w2-database');

test('journal preflight preserves a disable observed after identity resolution', async () => {
  const adapters = createAccountAdapters({
    repository: { getOrCreateAccount: async () => ({ id: 'owner_a', status: 'active' }) },
    readAccount: async () => ({
      _id: 'owner_a',
      status: 'disabled',
      journalLayout: 'deterministic-days-v1',
      journalRevision: 1,
    }),
  });
  const result = await adapters.resolveAccountForJournal('synthetic_openid');
  assert.equal(result.status, 'disabled');
  assert.equal(result.journalReady, false);
});

test('journal preflight rejects a row reader returning another account', async () => {
  const adapters = createAccountAdapters({
    repository: { getOrCreateAccount: async () => ({ id: 'owner_a', status: 'active' }) },
    readAccount: async () => ({
      _id: 'owner_b',
      status: 'active',
      journalLayout: 'deterministic-days-v1',
      journalRevision: 1,
    }),
  });
  await assert.rejects(adapters.resolveAccountForJournal('synthetic_openid'), { code: 'CONFLICT' });
});

test('account cleanup rechecks owner within the deletion transaction after listing', async () => {
  const row = { _id: 'history_a', ownerId: 'owner_a' };
  const fixture = databaseFixture({ 'task_history:history_a': row });
  let replaced = false;
  const db = {
    ...fixture.db,
    collection(name) {
      const reference = fixture.db.collection(name);
      return {
        ...reference,
        where(filter) {
          const query = reference.where(filter);
          const get = query.get.bind(query);
          query.get = async () => {
            const result = await get();
            if (name === 'task_history' && !replaced) {
              replaced = true;
              fixture.put(name, { ...row, ownerId: 'owner_b' });
            }
            return result;
          };
          return query;
        },
      };
    },
  };
  const sources = createAccountDataSources({ db });
  await assert.rejects(sources.cleanupOwnerBatch('owner_a', { collection: 'task_history' }), {
    code: 'FORBIDDEN',
  });
  assert.equal(fixture.inspect()['task_history:history_a'].ownerId, 'owner_b');
  assert.equal(
    fixture.calls.some((call) => call.operation === 'remove'),
    false,
  );
});
