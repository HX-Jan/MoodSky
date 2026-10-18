const { notImplemented } = require('../shared/result');
const { createReviewService } = require('../services/review');
// Xiang Hong: F05-F10. Read the journal source; invalidate every view on deletion.
async function handle(_request) {
  return notImplemented();
}
module.exports = { handle, createHandler: createReviewService };
