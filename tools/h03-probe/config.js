module.exports = Object.freeze({
  probeTag: 'moodsky-h03-v1',
  functionName: 'moodsky-h03-probe',
  appId: 'wxf602e991ff44e6c8',
  environmentId: 'mood-sky-d5gqy3spkff37566d',
  runtime: 'Nodejs16.13',
  operatorSetting: 'H03_PROBE_OPERATOR_FINGERPRINT',
  cleanupConfirmation: 'DELETE_H03_SYNTHETIC_RUN',
  retryCount: 2,
  collections: Object.freeze({
    accounts: 'h03_probe_accounts',
    journals: 'h03_probe_journals',
    receipts: 'h03_probe_receipts',
    deletions: 'h03_probe_deletions',
  }),
});
