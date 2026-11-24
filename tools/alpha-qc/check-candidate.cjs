// Static local-candidate audit only; never imports the generated cloud-enabled client.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
function audit(directory, sourceCommit, taskMode) {
  assert(path.isAbsolute(directory));
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert(['closed', 'readOnly', 'enabled'].includes(taskMode));
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.sourceWorktreeDirty, false);
  assert.equal(manifest.taskMode, taskMode);
  assert.equal(manifest.campusCheckinWritesPausedByDefault, true);
  for (const field of [
    'uploaded',
    'deployed',
    'phoneVerified',
    'submittedForReview',
    'publicRelease',
    'sourcePersonalConfigIncluded',
    'serverSecretsIncluded',
    'locationApiEnabled',
  ]) {
    assert.equal(manifest[field], false, field);
  }
  const hash = (file) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(directory, file)))
      .digest('hex');
  let verified = 0;
  for (const [file, expected] of Object.entries(manifest.clientHashes)) {
    assert.equal(hash('client/' + file), expected, file);
    verified++;
    if (
      ![
        'project.config.json',
        'miniprogram/app.json',
        'miniprogram/config/environment.local.js',
      ].includes(file)
    ) {
      const original = execFileSync('git', ['show', sourceCommit + ':' + file], { cwd: root });
      assert.equal(
        crypto.createHash('sha256').update(original).digest('hex'),
        expected,
        'Candidate/source bytes: ' + file,
      );
    }
  }
  for (const [name, files] of Object.entries(manifest.cloudHashes)) {
    for (const [file, expected] of Object.entries(files)) {
      assert.equal(hash('cloud/' + name + '/' + file), expected, name + '/' + file);
      verified++;
    }
  }
  assert.equal(hash('project.config.json'), manifest.rootProjectHash);
  verified++;
  const config = { module: { exports: {} } };
  vm.runInNewContext(
    fs.readFileSync(path.join(directory, 'client/miniprogram/config/environment.local.js'), 'utf8'),
    config,
  );
  assert.equal(config.module.exports.buildCommit, sourceCommit);
  assert.equal(config.module.exports.taskMode, taskMode);
  assert.equal(config.module.exports.cloudEnabled, true);
  assert.equal(config.module.exports.explicitWechatLogin, true);
  const app = JSON.parse(fs.readFileSync(path.join(directory, 'client/miniprogram/app.json')));
  const services = Object.keys(manifest.cloudHashes);
  assert.deepEqual(services.sort(), ['moodsky-release', 'moodsky-release-maintenance']);
  return {
    executedAt: new Date().toISOString(),
    layer: 'STATIC_LOCAL_CANDIDATE',
    sourceCommit,
    taskMode,
    sourceWorktreeDirty: false,
    verifiedFileHashes: verified,
    clientFiles: Object.keys(manifest.clientHashes).length,
    cloudFiles: Object.values(manifest.cloudHashes).reduce(
      (n, files) => n + Object.keys(files).length,
      0,
    ),
    pages: app.pages.length,
    tabs: app.tabBar.list.length,
    services,
    manifestSha256: hash('manifest.json'),
    realCloud: false,
    realPhone: false,
    finalFreezeConfirmed: false,
    independentAcceptance: false,
    result: 'PASS',
  };
}
if (require.main === module) {
  console.log(JSON.stringify(audit(...process.argv.slice(2)), null, 2));
}
module.exports = { audit };
