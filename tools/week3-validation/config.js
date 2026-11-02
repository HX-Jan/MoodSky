const previous = require('../h03-probe/config');
module.exports = Object.freeze({
  functionName: previous.functionName,
  environmentId: previous.environmentId,
  appId: previous.appId,
  operatorSetting: previous.operatorSetting,
  runId: 'h03_20261027_w3_remaining_001',
  tag: 'moodsky-w3-validation-20261027',
  expiresAt: '2026-10-27T15:59:59.999Z',
  businessInstant: '2026-10-27T04:00:00.000Z',
  workerCount: 4,
  allowedCollections: Object.freeze(['accounts', 'journals', 'request_receipts']),
  collections: previous.collections,
});
