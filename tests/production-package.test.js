const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { buildProduction } = require('../scripts/package-production');
const { clientCapabilities } = require('../miniprogram/modules/system/capabilities');
for (const taskMode of ['readOnly', 'enabled']) {
  test(`reviewed ${taskMode} package carries the same task scope in the client and manifest`, (t) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-task-mode-'));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const outputRoot = path.join(parent, 'candidate');
    const built = buildProduction({ outputRoot, taskMode });
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(
        path.join(outputRoot, 'client/miniprogram/config/environment.local.js'),
        'utf8',
      ),
      { module },
    );
    assert.equal(module.exports.taskMode, taskMode);
    assert.equal(built.manifest.taskMode, taskMode);
    const capability = clientCapabilities(module.exports).tasks;
    assert.equal(capability.state, taskMode === 'readOnly' ? 'readOnly' : 'available');
    assert.equal(capability.historyAvailable, taskMode === 'enabled');
  });
}
test('unrecognized task scope is rejected before creating a release package', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-task-mode-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const outputRoot = path.join(parent, 'candidate');
  assert.throws(() => buildProduction({ outputRoot, taskMode: 'readonly' }), /reviewed taskMode/);
  assert.equal(fs.existsSync(outputRoot), false);
});
test('explicit production package has account page, cloud configuration, denied location declarations and complete hashes', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-production-package-'));
  t.after(() => {
    const resolved = path.resolve(parent);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('moodsky-production-package-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const outputRoot = path.join(parent, 'candidate');
  const built = buildProduction({ outputRoot });
  assert.equal(built.version, '0.5.0');
  assert.equal(built.manifest.uploadVersion, '0.5.0');
  assert.equal(built.manifest.serverBuildVersion, '0.5.0');
  assert.equal(built.manifest.campusCheckinWritesPausedByDefault, true);
  assert.equal(built.manifest.functionName, 'moodsky-release');
  assert.equal(built.manifest.workerName, 'moodsky-release-maintenance');
  assert.equal(built.manifest.uploaded, false);
  assert.equal(built.manifest.cloudLifecycleVerified, false);
  assert.equal(built.manifest.serverSecretsIncluded, false);
  const app = JSON.parse(fs.readFileSync(path.join(outputRoot, 'client/miniprogram/app.json')));
  assert.ok(app.pages.includes('pages/account/index'));
  assert.ok(fs.existsSync(path.join(outputRoot, 'client/miniprogram/modules/share/app-share.js')));
  assert.equal(app.permission, undefined);
  assert.equal(app.requiredPrivateInfos, undefined);
  const environmentModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(outputRoot, 'client/miniprogram/config/environment.local.js'),
      'utf8',
    ),
    { module: environmentModule },
  );
  assert.equal(environmentModule.exports.releaseProfile, 'production');
  assert.equal(environmentModule.exports.taskMode, 'closed');
  assert.equal(built.manifest.taskMode, 'closed');
  assert.equal(environmentModule.exports.journalDemo, false);
  assert.equal(environmentModule.exports.cloudEnabled, true);
  assert.equal(environmentModule.exports.cloudFunctionName, built.manifest.functionName);
  const project = JSON.parse(fs.readFileSync(path.join(outputRoot, 'client/project.config.json')));
  assert.equal(project.setting.urlCheck, true);
  const rootProject = JSON.parse(fs.readFileSync(path.join(outputRoot, 'project.config.json')));
  assert.equal(rootProject.miniprogramRoot, 'client/miniprogram/');
  assert.equal(rootProject.cloudfunctionRoot, 'cloud/');
  assert.ok(
    fs.existsSync(
      path.join(outputRoot, rootProject.cloudfunctionRoot, built.manifest.functionName, 'index.js'),
    ),
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(outputRoot, 'cloud', built.manifest.workerName, 'config.json')),
    ),
    require('../cloudfunctions/moodsky/production/timer.config.json'),
  );
  for (const [name, hash] of Object.entries(built.manifest.clientHashes)) {
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(outputRoot, 'client', name)))
        .digest('hex'),
      hash,
    );
  }
  assert.throws(() => buildProduction({ outputRoot }), /new absolute/);
  const code = fs.readFileSync(
    path.join(outputRoot, 'cloud', built.manifest.functionName, 'index.js'),
    'utf8',
  );
  assert.doesNotMatch(code, /SIMULATED_NO_NETWORK|createMemoryJournalRepository|合成演示：/);
  const module = { exports: {} };
  const runtimeEnv = {};
  let deploymentFile = null;
  let databaseOpens = 0;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Buffer,
    process: { env: runtimeEnv },
    require(name) {
      if (name === 'wx-server-sdk') {
        return { DYNAMIC_CURRENT_ENV: 'synthetic_env', init() {} };
      }
      if (name === '@cloudbase/node-sdk') {
        databaseOpens++;
        throw new Error('unconfigured package must remain closed');
      }
      if (name === 'node:fs') {
        return {
          readFileSync(file) {
            assert.equal(path.basename(file), 'runtime.local.json');
            if (!deploymentFile) {
              throw new Error('no deployment file');
            }
            return JSON.stringify(deploymentFile);
          },
        };
      }
      return require(name);
    },
    __dirname: path.join(outputRoot, 'cloud', built.manifest.functionName),
  });
  const request = (action) => ({
    apiVersion: '1',
    requestId: 'req_production_packaged',
    action,
    payload: {},
  });
  assert.equal((await module.exports.main(request('system.health'))).data.configured, false);
  assert.equal(
    (await module.exports.main(request('account.session'))).error.code,
    'NOT_IMPLEMENTED',
  );
  assert.equal(databaseOpens, 0);
  const credentials = {
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  };
  Object.assign(runtimeEnv, credentials);
  const health = async () => (await module.exports.main(request('system.health'))).data;
  assert.equal((await health()).configured, true);
  assert.equal((await health()).campusCheckinWritesPaused, true);
  runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  assert.equal((await health()).campusCheckinWritesPaused, false);

  for (const name of Object.keys(credentials)) {
    delete runtimeEnv[name];
  }
  delete runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED;
  deploymentFile = {
    storage: 'server-deployment-config-v1',
    appId: built.manifest.appId,
    environmentId: built.manifest.environmentId,
    ...credentials,
  };
  assert.equal((await health()).configured, true);
  assert.equal((await health()).campusCheckinWritesPaused, true);
  runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  assert.equal((await health()).campusCheckinWritesPaused, false);

  deploymentFile.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  for (const setting of ['true', 'invalid']) {
    runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = setting;
    assert.equal((await health()).configured, true);
    assert.equal((await health()).campusCheckinWritesPaused, true);
  }
  delete runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED;
  assert.equal((await health()).campusCheckinWritesPaused, false);

  runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  runtimeEnv.MOODSKY_PRODUCTION_ENABLED = 'false';
  assert.equal((await health()).configured, false);
  assert.equal((await health()).campusCheckinWritesPaused, true);
  assert.equal(databaseOpens, 0);
});
