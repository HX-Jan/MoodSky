const test = require('node:test');
const { lostAcknowledgement } = require('../tools/alpha-qc/verify.cjs');
for (const action of ['select', 'complete', 'replace', 'skip']) {
  test(`AS-QC02 ${action}: double tap, lost acknowledgement, return and exact retry`, async () => {
    await lostAcknowledgement(action);
  });
}
