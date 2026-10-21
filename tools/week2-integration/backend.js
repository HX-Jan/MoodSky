// W2 H02/H04 local opt-in wiring. Never imported by the production entry.
// The caller supplies a server-owned database; this module never initializes an SDK.
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const { createRepository } = require('../../cloudfunctions/moodsky/domains/repository');
const { createCloudJournalRepository } = require('../journal-storage/cloudbase-candidate');

function createWeek2Backend({
  db,
  receiptPolicy,
  accountUniqueIndexReady = false,
  newAccountJournalLayout,
  now,
  decorationCatalogue,
} = {}) {
  const accounts = createRepository({ db, accountUniqueIndexReady, newAccountJournalLayout });
  return createCandidateRouter({
    resolveAccount: accounts.getOrCreateAccount,
    journalRepository: createCloudJournalRepository(db),
    journalReceiptPolicy: receiptPolicy,
    now,
    decorationCatalogue,
  });
}
module.exports = { createWeek2Backend };
