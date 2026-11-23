const test = require('node:test');
const assert = require('node:assert/strict');
const { runWorkbench, redact } = require('../tools/alpha-h/ab-workbench.cjs');
const { createProductionEntry } = require('../cloudfunctions/moodsky/production');

test('member workbench verifies targeted A/B denial alongside normal access and fresh-account isolation', async () => {
  const report = await runWorkbench();
  assert.equal(report.cases.length, 16);
  assert.equal(report.failed, 0);
  assert.equal(report.passed, 16);
  assert.equal(report.independentAcceptance, false);
  const text = JSON.stringify(redact(report));
  assert.doesNotMatch(text, /scope_[a-f0-9]{64}|v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  assert.doesNotMatch(text, /SIMULATED_C2H_[AB] private record/);
});

test('workbench rejects an export cache that omits the actor from its cache key', async () => {
  const cache = new Map();
  const report = await runWorkbench({
    entryFactory: (options) => {
      const actual = createProductionEntry(options);
      return async (request) => {
        if (request.action !== 'account.downloadExport') {
          return actual(request);
        }
        if (cache.has(request.payload.jobId)) {
          return { ...cache.get(request.payload.jobId), requestId: request.requestId };
        }
        const response = await actual(request);
        if (response.ok) {
          cache.set(request.payload.jobId, response);
        }
        return response;
      };
    },
  });
  assert.equal(report.cases.find((row) => row.id === 'E04').passed, false);
  assert.ok(report.failed > 0);
});
