// Public, deliberately synthetic test key. Never imported by production services.
const { createReceiptPolicy } = require('../../cloudfunctions/moodsky/services/receipt-policy');
const createSyntheticReceiptPolicy = () =>
  createReceiptPolicy({
    activeKeyId: 'synthetic_test_key',
    keys: { synthetic_test_key: Buffer.alloc(32, 83) },
    maxAgeMs: 3600000, // One hour is a fixture parameter, not a product retention decision.
  });
module.exports = { createSyntheticReceiptPolicy };
