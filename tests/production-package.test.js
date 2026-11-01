const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { buildProduction } = require('../scripts/package-production');
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
  assert.equal(built.version, '0.3.0');
  assert.equal(built.manifest.uploadVersion, '0.3.0');
  assert.equal(built.manifest.serverBuildVersion, '0.3.0-rc2');
  assert.equal(built.manifest.functionName, 'moodsky-release');
  assert.equal(built.manifest.workerName, 'moodsky-release-maintenance');
  assert.equal(built.manifest.uploaded, false);
  assert.equal(built.manifest.cloudLifecycleVerified, false);
  assert.equal(built.manifest.serverSecretsIncluded, false);
  const app = JSON.parse(fs.readFileSync(path.join(outputRoot, 'client/miniprogram/app.json')));
  assert.ok(app.pages.includes('pages/account/index'));
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
  let databaseOpens = 0;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Buffer,
    process: { env: {} },
    require(name) {
      if (name === 'wx-server-sdk') {
        return { DYNAMIC_CURRENT_ENV: 'synthetic_env', init() {} };
      }
      if (name === '@cloudbase/node-sdk') {
        databaseOpens++;
        throw new Error('unconfigured package must remain closed');
      }
      return require(name);
    },
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
});
