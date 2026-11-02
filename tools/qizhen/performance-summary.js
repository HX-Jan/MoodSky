// End-to-end measurements come from one video/clock, never Node/router timings.
const fs = require('node:fs');
const GROUPS = ['A-C', 'A-W', 'I-C', 'I-W'];
const present = (value) => value !== null && value !== undefined;
const median = (xs) => {
  if (!xs.length) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
function summarize(batch) {
  if (!batch || !['device', 'synthetic'].includes(batch.kind) || !Array.isArray(batch.samples)) {
    throw new Error('kind must be device or synthetic; samples must be an array');
  }
  const seen = new Set();
  const measured = [];
  for (const r of batch.samples) {
    if (!r.id || seen.has(r.id) || !GROUPS.includes(r.group)) {
      throw new Error('Invalid/duplicate id or group');
    }
    seen.add(r.id);
    if (!['not_run', 'success', 'failure', 'timeout', 'invalid'].includes(r.status)) {
      throw new Error('Invalid status');
    }
    if (r.status === 'not_run') {
      if (present(r.t0_ms) || present(r.t1_ms)) {
        throw new Error('Unexecuted sample has timings');
      }
      continue;
    }
    if (
      !r.evidence ||
      !r.clock_source ||
      !r.env_id ||
      !r.actual_time ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(r.actual_time) ||
      !Number.isFinite(Date.parse(r.actual_time))
    ) {
      throw new Error(`${r.id}: missing evidence, clock, environment or zoned date`);
    }
    if (r.status === 'invalid' && !r.exclusion_reason) {
      throw new Error(`${r.id}: invalid measurement needs a reason`);
    }
    const env = (batch.environments || []).find((e) => e.id === r.env_id);
    if (
      !env ||
      !env.device ||
      !env.os ||
      !env.wechat ||
      !env.commit ||
      !env.network ||
      env.dataset !== 'D30' ||
      env.record_count !== 30
    ) {
      throw new Error(`${r.id}: incomplete D30 environment`);
    }
    if (env.platform !== (r.group.startsWith('A') ? 'Android' : 'iOS')) {
      throw new Error(`${r.id}: platform/group mismatch`);
    }
    if (r.client_start !== (r.group.endsWith('C') ? 'cold' : 'warm') || !r.start_evidence) {
      throw new Error(`${r.id}: missing client start evidence`);
    }
    if (
      !['cold', 'warm', 'unknown'].includes(r.cloud_start) ||
      (r.cloud_start !== 'unknown' && !r.cloud_evidence)
    ) {
      throw new Error(`${r.id}: missing cloud start evidence`);
    }
    let tti = null;
    if (r.status === 'success') {
      if (
        !Number.isFinite(r.t0_ms) ||
        !Number.isFinite(r.t1_ms) ||
        r.t0_ms < 0 ||
        r.t1_ms < r.t0_ms ||
        !r.interaction_evidence
      ) {
        throw new Error(`${r.id}: success needs valid T0/T1 and interaction evidence`);
      }
      tti = r.t1_ms - r.t0_ms;
    } else if (present(r.t1_ms)) {
      throw new Error(`${r.id}: unsuccessful sample cannot have successful T1`);
    }
    if (['failure', 'timeout'].includes(r.status) && !r.reason) {
      throw new Error(`${r.id}: missing failure/timeout reason`);
    }
    measured.push({ ...r, tti });
  }
  const groups = GROUPS.map((group) => {
    const rs = measured.filter((r) => r.group === group);
    const envs = new Set(rs.filter((r) => r.status !== 'invalid').map((r) => r.env_id));
    if (envs.size > 1) {
      throw new Error(`${group}: mixed environments; split into another batch`);
    }
    const valid = rs.filter((r) => r.status !== 'invalid');
    const times = valid.filter((r) => r.status === 'success').map((r) => r.tti);
    const target = times.filter((t) => t <= 2500).length;
    return {
      group,
      valid_attempts: valid.length,
      success: times.length,
      failure: valid.filter((r) => r.status === 'failure').length,
      timeout: valid.filter((r) => r.status === 'timeout').length,
      excluded: rs.filter((r) => r.status === 'invalid').length,
      pending: batch.samples.filter((r) => r.group === group && r.status === 'not_run').length,
      minimum_ms: times.length ? Math.min(...times) : null,
      median_ms: median(times),
      mean_ms: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      maximum_ms: times.length ? Math.max(...times) : null,
      within_2500_ms: target,
      target_rate: valid.length ? target / valid.length : null,
      success_rate: valid.length ? times.length / valid.length : null,
    };
  });
  return {
    batch_id: batch.batch_id,
    kind: batch.kind,
    threshold_ms: 2500,
    scope:
      batch.kind === 'synthetic'
        ? '合成统计练习，不是真机实测，不计正式20次'
        : '用户提供的真机记录统计，需人工复核证据',
    coverage_complete: batch.kind === 'device' && groups.every((g) => g.valid_attempts >= 5),
    acceptance: '不自动判项目通过；2.5秒整体验收口径须团队确认',
    groups,
  };
}
if (require.main === module) {
  try {
    const summary = summarize(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { summarize, median };
