const { createMemoryJournalService } = require('./demo-service');
// Both journal pages share one explicit, memory-only demo session.
let shared;
function getSharedDemoService() {
  if (!shared) {
    shared = createMemoryJournalService();
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
