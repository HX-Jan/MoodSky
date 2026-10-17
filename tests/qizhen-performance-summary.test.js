const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../tools/qizhen/performance-summary');
function fixture() {
  const env = {
    id: 'test_env',
    device: 'synthetic device',
    platform: 'Android',
    os: 'synthetic',
    wechat: 'synthetic',
    commit: 'fixture',
    network: 'synthetic',
    dataset: 'D30',
    record_count: 30,
  };
  const sample = {
    id: 'test_01',
    group: 'A-C',
    env_id: env.id,
    status: 'success',
    actual_time: '2026-10-17T10:00:00+08:00',
    clock_source: 'synthetic same video',
    evidence: 'synthetic evidence',
    client_start: 'cold',
    start_evidence: 'synthetic instance terminated',
    cloud_start: 'unknown',
    t0_ms: 1000,
    t1_ms: 3500,
    interaction_evidence: 'synthetic operation response',
  };
  return { kind: 'synthetic', batch_id: 'test_only', environments: [env], samples: [sample] };
}
test('QT-P01 2500ms is included, failures/timeouts stay in denominator, invalid retained separately', () => {
  const b = fixture();
  const s = b.samples[0];
  b.samples.push(
    { ...s, id: 'test_02', t1_ms: 5000 },
    { ...s, id: 'test_03', status: 'failure', t1_ms: null, reason: 'service failed' },
    { ...s, id: 'test_04', status: 'timeout', t1_ms: null, reason: '15s observation ended' },
    {
      ...s,
      id: 'test_05',
      status: 'invalid',
      t1_ms: null,
      exclusion_reason: 'recording interrupted',
    },
  );
  const g = summarize(b).groups[0];
  assert.equal(g.valid_attempts, 4);
  assert.equal(g.success, 2);
  assert.equal(g.within_2500_ms, 1);
  assert.equal(g.target_rate, 0.25);
  assert.equal(g.success_rate, 0.5);
  assert.equal(g.excluded, 1);
  assert.equal(g.median_ms, 3250);
  assert.equal(g.mean_ms, 3250);
});
test('QT-P02 empty groups have no fabricated timings or rates', () => {
  const b = fixture();
  b.samples = [{ id: 'pending_1', group: 'A-C', status: 'not_run', t0_ms: null, t1_ms: null }];
  const result = summarize(b);
  assert.equal(result.coverage_complete, false);
  assert.equal(result.groups[0].median_ms, null);
  assert.equal(result.groups[0].target_rate, null);
  assert.equal(result.groups[0].pending, 1);
});
test('QT-P03 malformed evidence, duplicate ids, negative/reversed clocks and missing interaction are rejected', () => {
  for (const patch of [
    { t0_ms: -1 },
    { t1_ms: 999 },
    { interaction_evidence: '' },
    { evidence: '' },
    { actual_time: '2026-10-17 10:00:00' },
    { cloud_start: 'cold', cloud_evidence: '' },
    { status: 'invalid', t1_ms: null, exclusion_reason: '' },
  ]) {
    const b = fixture();
    Object.assign(b.samples[0], patch);
    assert.throws(() => summarize(b), Error);
  }
  const b = fixture();
  b.samples.push({ ...b.samples[0] });
  assert.throws(() => summarize(b), /duplicate/);
});
test('QT-P04 platform mismatches and mixed conditions cannot silently enter one group', () => {
  const b = fixture();
  b.environments.push({ ...b.environments[0], id: 'other', network: 'other network' });
  b.samples.push({ ...b.samples[0], id: 'test_02', env_id: 'other' });
  assert.throws(() => summarize(b), /mixed environments/);
  b.samples.pop();
  b.samples[0].group = 'I-C';
  assert.throws(() => summarize(b), /platform/);
});
test('QT-P05 even 20 synthetic samples never count as completed device coverage', () => {
  const b = fixture();
  b.environments.push({ ...b.environments[0], id: 'ios', platform: 'iOS' });
  const s = b.samples[0];
  b.samples = ['A-C', 'A-W', 'I-C', 'I-W'].flatMap((group) =>
    Array.from({ length: 5 }, (_, n) => ({
      ...s,
      id: `${group}_${n}`,
      group,
      env_id: group.startsWith('A') ? 'test_env' : 'ios',
      client_start: group.endsWith('C') ? 'cold' : 'warm',
    })),
  );
  assert.equal(summarize(b).coverage_complete, false);
  assert.match(summarize(b).scope, /合成/);
});
