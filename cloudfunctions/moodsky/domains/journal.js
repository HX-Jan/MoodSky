const { notImplemented } = require('../shared/result');
const { createJournalService } = require('../services/journal');
// Xiang Hong: F01-F04. Owner/date uniqueness, request deduplication and version checks.
async function handle(_request) {
  return notImplemented();
}
module.exports = { handle, createHandler: createJournalService };
