const { createMemoryJournalService } = require('./demo-service');
const { SEED_ENTRIES } = require('../review/demo-data');
// Both journal pages share one explicit, memory-only demo session.
// Seeded from the same synthetic entries as the review demo store (W1 Z05),
// so Today/record pages and the Universe calendar show one consistent dataset.
let shared;
function getSharedDemoService() {
  if (!shared) {
    shared = createMemoryJournalService({ seedEntries: SEED_ENTRIES });
  }
  return shared;
}
function clearSharedDemoService() {
  if (shared) {
    // Preserve the identity held by controllers that are still mounted.
    shared.clear();
  }
}
module.exports = { getSharedDemoService, clearSharedDemoService };
