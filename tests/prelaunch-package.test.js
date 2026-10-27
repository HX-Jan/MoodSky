const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildPrelaunch } = require('../scripts/package-prelaunch');
const { checkHealth } = require('../miniprogram/modules/system/health');
const { createRouter } = require('../cloudfunctions/moodsky/router');
const { ACTIONS } = require('../miniprogram/shared/contracts');
const marker = {
  buildId: 'prelaunch-20261025-1',
  phase: 'pre-filing',
  publicReleaseEnabled: false,
  privateBusinessEnabled: false,
};
const root = path.resolve(__dirname, '..');

test('pre-filing package keeps current seven-weather files, excludes local settings and blocks all private/operator stores', async () => {
  const output = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-prelaunch-test-')),
    'release',
  );
  const { client, cloud, manifest } = buildPrelaunch({ outputRoot: output });
  assert.equal(manifest.weather.length, 7);
  assert.equal(manifest.privateBusinessEnabled, false);
  assert.equal(manifest.localEnvironmentIncluded, false);
  const config = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(client, 'miniprogram/config/environment.local.js'), 'utf8'),
    { module: config },
  );
  assert.equal(config.exports.cloudEnabled, false);
  assert.equal(config.exports.journalDemo, true);
  assert.equal(config.exports.cloudEnvId, '');
  for (const file of Object.keys(manifest.clientHashes)) {
    assert.deepEqual(
      fs.readFileSync(path.join(client, file)),
      fs.readFileSync(path.join(root, file)),
      file,
    );
  }
  assert.equal(fs.existsSync(path.join(client, 'cloudfunctions')), false);
  let databaseCalls = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(cloud, 'index.js'), 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: 'synthetic-env',
          init() {},
          getWXContext: () => ({ OPENID: 'synthetic_operator' }),
          database() {
            databaseCalls++;
            throw Error('No database');
          },
        };
      }
      return require(name);
    },
  });
  const request = (action) => ({
    apiVersion: '1',
    requestId: 'req_prelaunch_001',
    action,
    payload: {},
  });
  const health = await module.exports.main(request('system.health'));
  assert.deepEqual(JSON.parse(JSON.stringify(health.data.deployment)), marker);
  assert.equal(health.data.stage, 'foundation');
  for (const [action, definition] of Object.entries(ACTIONS)) {
    if (['private', 'operator', 'receipt'].includes(definition.access)) {
      const result = await module.exports.main(request(action));
      assert.equal(result.ok, false, action);
    }
  }
  const forged = await module.exports.main({
    ...request('system.health'),
    deploymentInfo: { privateBusinessEnabled: true },
  });
  assert.equal(forged.error.code, 'INVALID_REQUEST');
  assert.equal(databaseCalls, 0);
});

test('pre-filing package refuses existing folders and output inside checkout', () => {
  const existing = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-prelaunch-existing-'));
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'retained');
  assert.throws(() => buildPrelaunch({ outputRoot: existing }), /new absolute/);
  assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'retained');
  assert.throws(
    () => buildPrelaunch({ outputRoot: path.join(root, '..prelaunch-output') }),
    /outside/,
  );
});

test('pre-filing marker is server constructed, does not enable services, and never applies implicitly to opt-in routers', async () => {
  assert.throws(
    () => createRouter({ deploymentInfo: { ...marker, privateBusinessEnabled: true } }),
    /Invalid/,
  );
  const result = await createRouter()({
    apiVersion: '1',
    requestId: 'req_no_marker_001',
    action: 'system.health',
    payload: {},
  });
  assert.equal(result.data.deployment, undefined);
});

test('formal health displays pre-filing state and rejects malformed release markers without demo fallback', async () => {
  const call = (deployment) => async (request) => ({
    ok: true,
    apiVersion: '1',
    requestId: request.requestId,
    data: { version: '0.2.3', stage: 'foundation', deployment },
  });
  const result = await checkHealth('formal', { call: call(marker) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.deployment, marker);
  for (const deployment of [
    null,
    { ...marker, privateBusinessEnabled: true },
    { ...marker, buildId: 'bad\nidentity' },
  ]) {
    const invalid = await checkHealth('formal', { call: call(deployment) });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.mode, 'formal');
    assert.equal(invalid.code, 'INVALID_RESPONSE');
  }
  assert.equal((await checkHealth('demo')).deployment, undefined);
});
