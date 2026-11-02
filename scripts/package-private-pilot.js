const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const { buildPrelaunch } = require('./package-prelaunch');
const { settings } = require('../tools/private-pilot/config');
function buildPrivatePilot({ outputRoot } = {}) {
  const root = path.resolve(__dirname, '..');
  const base = buildPrelaunch({ outputRoot });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'tools/h03-probe/package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'tools/h03-probe/package-lock.json')));
  if (
    pkg.dependencies['@cloudbase/node-sdk'] !== '3.17.2' ||
    pkg.dependencies['wx-server-sdk'] !== '4.0.2' ||
    pkg.overrides['@cloudbase/database'] !== '1.5.1' ||
    pkg.overrides.axios !== '0.34.0'
  ) {
    throw new Error('Review pilot SDK changes explicitly.');
  }
  pkg.name = settings.functionName;
  lock.name = settings.functionName;
  lock.packages[''].name = settings.functionName;
  const builds = {};
  for (const [kind, entry] of [
    ['closed', 'closed.js'],
    ['active', 'index.js'],
  ]) {
    const target = path.join(outputRoot, kind, settings.functionName);
    fs.mkdirSync(target, { recursive: true });
    esbuild.buildSync({
      entryPoints: [path.join(root, 'tools/private-pilot', entry)],
      outfile: path.join(target, 'index.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node16',
      external: ['wx-server-sdk', '@cloudbase/node-sdk'],
    });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    fs.writeFileSync(path.join(target, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    builds[kind] = {
      target,
      hashes: Object.fromEntries(
        ['index.js', 'package.json', 'package-lock.json'].map((file) => [
          file,
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(target, file)))
            .digest('hex'),
        ]),
      ),
    };
  }
  const configFile = path.join(base.client, 'miniprogram/config/environment.local.js');
  fs.writeFileSync(
    configFile,
    `module.exports = ${JSON.stringify(
      {
        cloudEnabled: true,
        cloudEnvId: settings.environmentId,
        cloudFunctionName: settings.functionName,
        trustedSessionEnabled: true,
        journalDemo: false,
      },
      null,
      2,
    )};\n`,
  );
  const projectFile = path.join(base.client, 'project.config.json');
  const project = JSON.parse(fs.readFileSync(projectFile));
  project.projectname = 'MoodSky-本人云测试';
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n');
  const manifest = {
    ...base.manifest,
    status: 'prepared-not-deployed',
    clientMode: 'restricted-private-cloud-pilot',
    clientConfigOverlays: ['miniprogram/config/environment.local.js', 'project.config.json'],
    doNotUploadToExperience: true,
    localPreviewOnly: true,
    publicReleaseEnabled: false,
    functionName: settings.functionName,
    environmentId: settings.environmentId,
    builds,
    requiredEnvironmentVariables: [
      'MOODSKY_PRIVATE_PILOT_ENABLED',
      'MOODSKY_PILOT_ACCOUNT_INDEX_VERIFIED',
      'MOODSKY_PILOT_OPERATOR_FINGERPRINT',
      'MOODSKY_PILOT_RECEIPT_KEY_BASE64',
      'MOODSKY_PILOT_TEST_DATE',
      'MOODSKY_PILOT_EXPIRES_AT',
    ],
    databaseCollections: [
      'accounts',
      'journals',
      'request_receipts',
      'deletion_markers',
      'task_templates',
      'task_history',
    ],
    excluded: [
      'account.close',
      'exports',
      'admin',
      'database cleanup',
      'index or permission changes',
    ],
    closedAfterTestRequired: true,
  };
  fs.writeFileSync(
    path.join(outputRoot, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { ...base, builds, manifest };
}
if (require.main === module) {
  const result = buildPrivatePilot({ outputRoot: process.argv[2] });
  console.log(
    JSON.stringify({
      client: result.client,
      builds: result.builds,
      sourceCommit: result.manifest.sourceCommit,
    }),
  );
}
module.exports = { buildPrivatePilot };
