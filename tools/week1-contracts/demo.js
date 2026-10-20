const samples = require('../../docs/week1/xiang-hong/w1-h04-examples.json');
const { businessDate } = require('../../miniprogram/shared/date');
const { buildReviewPreview, validateCandidateRequest } = require('./reference');
const results = [];
for (const sample of [...samples.examples, ...samples.emptyExamples]) {
  validateCandidateRequest(sample.request);
  const fixture = {
    synthetic: true,
    actorId: 'synthetic_h04_a',
    today: businessDate(new Date(samples.serverClock)),
    sourceRevision: samples.sourceRevision,
    records: samples.sourceRecords,
  };
  if (sample.fixture === 'separate-empty-account') {
    fixture.actorId = 'synthetic_empty';
  }
  if (sample.fixture === 'separate-two-record-account') {
    fixture.records = fixture.records.filter((row) => row.date >= '2026-10-12');
  }
  const writing = ['replace', 'reset'].includes(sample.request.payload.operation);
  results.push({
    name: sample.name,
    request: sample.request,
    ...(writing
      ? { execution: 'NOT_IMPLEMENTED: shape validated; no write performed' }
      : { syntheticData: buildReviewPreview(sample.request, fixture) }),
  });
}
console.log(
  JSON.stringify(
    {
      mode: 'synthetic-offline-reference',
      cloudCalls: 0,
      trustedPlatformIdentityVerified: false,
      results,
    },
    null,
    2,
  ),
);
