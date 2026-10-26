// Audience-facing client only. This script does not upload or deploy anything.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPrelaunch } = require('./package-prelaunch');
const { EXPERIENCE_VERSION } = require('../miniprogram/config/experience');

function buildExperience(options) {
  const prepared = buildPrelaunch(options);
  const config = {
    cloudEnabled: false,
    cloudEnvId: '',
    journalDemo: true,
    presentationProfile: 'experience',
  };
  const configPath = 'miniprogram/config/environment.local.js';
  fs.writeFileSync(
    path.join(prepared.client, configPath),
    'module.exports = ' + JSON.stringify(config, null, 2) + ';\n',
  );
  Object.assign(prepared.manifest, {
    buildId: 'experience-20261026-1',
    uploadVersion: EXPERIENCE_VERSION,
    presentationProfile: 'experience',
    clientMode: 'explicit-memory-experience-with-labelled-fixtures',
    generatedClientHashes: {
      [configPath]: crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(prepared.client, configPath)))
        .digest('hex'),
    },
    cloudDeploymentRequested: false,
  });
  fs.writeFileSync(
    path.join(options.outputRoot, 'manifest.json'),
    JSON.stringify(prepared.manifest, null, 2) + '\n',
  );
  return prepared;
}
if (require.main === module) {
  const result = buildExperience({ outputRoot: process.argv[2] });
  console.log(JSON.stringify({ client: result.client, manifest: result.manifest }));
}
module.exports = { buildExperience };
