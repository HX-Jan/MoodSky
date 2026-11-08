const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const command = path.resolve(__dirname, '../tools/team-integration/check.cjs');
const productionCommand = path.resolve(__dirname, '../tools/team-integration/production-check.cjs');
function guardedRun(source, args = ['--json'], target = command) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-team-'));
  const hook = path.join(folder, 'guard.cjs');
  fs.writeFileSync(hook, source);
  try {
    return spawnSync(process.execPath, ['--require', hook, target, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  } finally {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('moodsky-team-'));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

test('team command completes all real-handler scenarios without SDK, networking or personal configuration', () => {
  const result = guardedRun(`const M=require('node:module'),old=M._load;
    M._load=function(id,...args){
      if(/wx-server-sdk|@cloudbase|environment\\.local/.test(id)||['http','https','net','tls','node:http','node:https','node:net','node:tls'].includes(id))throw Error('External access attempted');
      return old.call(this,id,...args);
    };`);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'LOCAL_SYNTHETIC_ONLY');
  assert.equal(report.status, 'passed');
  assert.equal(report.checks.length, 9);
  assert.ok(report.checks.every((row) => row.status === 'passed'));
  assert.equal(report.realCloudAccess, 'not_checked');
  assert.equal(report.productionBusinessEnabled, false);
});

test('production assembly command completes with SDK, network and personal configuration blocked', () => {
  const result = guardedRun(
    `const M=require('node:module'),old=M._load;
    globalThis.fetch=()=>{throw Error('Network attempted')};
    M._load=function(id,...args){
      if(/wx-server-sdk|@cloudbase|environment\\.local/.test(id)||['http','https','net','tls','node:http','node:https','node:net','node:tls'].includes(id))throw Error('External access attempted');
      return old.call(this,id,...args);
    };`,
    ['--json'],
    productionCommand,
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'LOCAL_SYNTHETIC_ONLY');
  assert.equal(report.assembly, 'PRODUCTION_ENTRY_WITH_SYNTHETIC_ADAPTERS');
  assert.equal(report.status, 'passed');
  assert.equal(report.checks.length, 8);
  assert.ok(report.checks.some((row) => row.id === 'tasks' && row.status === 'passed'));
  assert.ok(report.checks.every((row) => row.status === 'passed'));
  assert.equal(report.realWechatLogin, 'not_checked');
  assert.equal(report.realCloudAccess, 'not_checked');
  assert.equal(report.productionBusinessEnabled, false);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /sessionScope|scope_[a-f0-9]{64}|"content"|IDENTITY_KEY|SYNTHETIC_PRODUCTION_TEAM_BODY/,
  );
});

test('production assembly command stops dependent checks after failure without logging private responses', () => {
  const result = guardedRun(
    `const M=require('node:module'),old=M._load;
    M._load=function(id,...args){
      if(id.endsWith('/production'))return {createProductionEntry:()=>async()=>({ok:false,error:{code:'INTERNAL_ERROR',message:'SYNTHETIC_PRIVATE_SENTINEL'}})};
      return old.call(this,id,...args);
    };`,
    ['--json'],
    productionCommand,
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'failed');
  assert.equal(report.checks[0].status, 'failed');
  assert.ok(report.checks.slice(1).every((row) => row.status === 'not_run'));
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_SENTINEL/);
});

test('production assembly command rejects external target and identity arguments', () => {
  const result = guardedRun('', ['--env', 'SYNTHETIC_PRIVATE_TARGET'], productionCommand);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_TARGET/);
});

test('team command reports handler failures and exits unsuccessfully without dumping response bodies', () => {
  const result = guardedRun(`const M=require('node:module'),old=M._load;
    M._load=function(id,...args){
      if(id.endsWith('/candidate-router'))return {createCandidateRouter:()=>async()=>({ok:false,error:{code:'INTERNAL_ERROR',message:'SYNTHETIC_PRIVATE_SENTINEL'}})};
      return old.call(this,id,...args);
    };`);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'failed');
  assert.ok(report.checks.some((row) => row.status === 'failed'));
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_SENTINEL/);
});

test('team command rejects unsupported target or identity arguments instead of silently ignoring them', () => {
  const result = guardedRun('', ['--env', 'SYNTHETIC_PRIVATE_TARGET']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_TARGET/);
});
