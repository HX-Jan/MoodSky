const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createPerformanceDataset,
  businessInstant,
  datasetVersion,
} = require('../tools/qizhen/performance-fixture');
const { WEATHER_TYPES } = require('../miniprogram/shared/constants');
const { validateJournalInput } = require('../miniprogram/shared/validation');
const { createLocalStore } = require('../miniprogram/modules/review/demo-store');
const { createReviewDemoService } = require('../miniprogram/modules/review/demo-service');

test('current D30 benchmark seeds exercise all seven weather types including valid CUSTOM names', async () => {
  const entries = createPerformanceDataset();
  assert.equal(entries.length, 30);
  assert.equal(datasetVersion, 'D30-seven-weather-v2');
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.weather))],
    WEATHER_TYPES.map((item) => item.code),
  );
  for (const entry of entries) {
    const input = {
      date: entry.date,
      weather: entry.weather,
      tags: entry.tags,
      text: entry.text,
      expectedVersion: 0,
    };
    if (entry.weather === 'CUSTOM') {
      input.weatherName = entry.weatherName;
    }
    assert.equal(validateJournalInput(input).weather, entry.weather);
    assert.equal(Array.from(entry.text).length, 200);
    assert.equal(Object.hasOwn(entry, 'weatherName'), entry.weather === 'CUSTOM');
  }
  const review = createReviewDemoService({
    now: () => new Date(businessInstant),
    store: createLocalStore(entries),
  });
  const distribution = (await review.distribution(30)).data;
  const timeline = (await review.timeline(30)).data;
  assert.equal(distribution.recordCount, 30);
  assert.equal(distribution.bins.length, 7);
  assert.ok(distribution.bins.every((bin) => bin.count > 0));
  assert.equal(
    timeline.items
      .filter((item) => item.weather === 'CUSTOM')
      .every((item) => item.weatherName === '合成天气😀'),
    true,
  );
});

test('the actual benchmark command uses the seven-weather fixture and reports the weather present in its output', () => {
  const root = path.resolve(__dirname, '..');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-benchmark-contract-'));
  const run = spawnSync(
    process.execPath,
    ['tools/qizhen/local-performance-bench.cjs', root, output],
    { cwd: root, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(run.status, 0, run.stderr);
  const entries = JSON.parse(fs.readFileSync(path.join(output, 'D30-fixture.json'), 'utf8'));
  const report = JSON.parse(
    fs.readFileSync(path.join(output, 'local-performance-results.json'), 'utf8'),
  );
  const codes = [...new Set(entries.map((entry) => entry.weather))];
  assert.deepEqual(
    codes,
    WEATHER_TYPES.map((item) => item.code),
  );
  assert.deepEqual(report.environment.dataset.weather_codes, codes);
  assert.equal(report.environment.dataset.version, datasetVersion);
  assert.equal(report.page_samples.length, 20);
  assert.equal(report.operation_batches.length, 80);
  for (const row of [...report.page_samples, ...report.operation_batches]) {
    assert.equal(row.status, 'success');
    assert.equal(row.dataset_version, datasetVersion);
  }
});
