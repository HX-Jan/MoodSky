// W2 H02/H04 local opt-in wiring. Never imported by the production entry.
// The caller supplies a server-owned database; this module never initializes an SDK.
const { createCandidateRouter } = require('../../cloudfunctions/moodsky/candidate-router');
const { createRepository } = require('../../cloudfunctions/moodsky/domains/repository');
const { createCloudJournalRepository } = require('../journal-storage/cloudbase-candidate');
const { createTaskCatalogueRepository } = require('./task-catalogue');

function createWeek2Backend({
  db,
  receiptPolicy,
  accountUniqueIndexReady = false,
  newAccountJournalLayout,
  now,
  decorationCatalogue,
  taskSuggestionsEnabled = false,
} = {}) {
  const accounts = createRepository({ db, accountUniqueIndexReady, newAccountJournalLayout });
  return createCandidateRouter({
    resolveAccount: accounts.getOrCreateAccount,
    journalRepository: createCloudJournalRepository(db),
    journalReceiptPolicy: receiptPolicy,
    now,
    decorationCatalogue,
    // Server construction only; client payloads cannot enable this candidate.
    taskCatalogueRepository:
      taskSuggestionsEnabled === true ? createTaskCatalogueRepository(db) : undefined,
  });
}
module.exports = { createWeek2Backend };
