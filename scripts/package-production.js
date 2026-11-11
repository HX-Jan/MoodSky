// Explicit local packaging only: does not upload, provision, change rules, or enable services.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { assertSharedContracts } = require('./shared-contracts');
const { APP_ID, ENV_ID, RELEASE_VERSION } = require('../cloudfunctions/moodsky/production/config');
const { APP_VERSION } = require('../miniprogram/shared/constants');
function buildProduction({
  outputRoot,
  sourceRoot = path.resolve(__dirname, '..'),
  functionName = 'moodsky-release',
  workerName = 'moodsky-release-maintenance',
  taskMode = 'closed',
} = {}) {
  if (!['closed', 'readOnly', 'enabled'].includes(taskMode)) {
    throw new TypeError('Choose a reviewed taskMode: closed, readOnly or enabled.');
  }
  if (
    !['moodsky', 'moodsky-release'].includes(functionName) ||
    !['moodsky-cleanup-worker', 'moodsky-release-maintenance'].includes(workerName)
  ) {
    throw new TypeError('Unknown release destination.');
  }
  if (!outputRoot || !path.isAbsolute(outputRoot) || fs.existsSync(outputRoot)) {
    throw new TypeError('Choose a new absolute output folder.');
  }
  const relative = path.relative(sourceRoot, outputRoot);
  if (!(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
    throw new TypeError('Keep deployment output outside the checkout.');
  }
  assertSharedContracts(sourceRoot);
  const tracked = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'miniprogram', 'project.config.json'],
    { cwd: sourceRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const client = path.join(outputRoot, 'client');
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const hashes = {};
  for (const name of tracked) {
    if (
      name === 'miniprogram/config/environment.local.js' ||
      /(?:^|\/)(?:node_modules|\.env)(?:\/|$)/.test(name)
    ) {
      throw new Error('Private local file must not be tracked.');
    }
    const source = path.join(sourceRoot, name);
    if (!fs.lstatSync(source).isFile()) {
      throw new Error('Only regular tracked files can be packaged.');
    }
    const real = path.relative(sourceRoot, fs.realpathSync(source));
    if (real.startsWith('..') || path.isAbsolute(real)) {
      throw new Error('Source escaped checkout.');
    }
    const target = path.join(client, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  if (!fs.existsSync(path.join(client, 'miniprogram/pages/account/index.js'))) {
    throw new Error('Commit the production account page before packaging.');
  }
  const projectFile = path.join(client, 'project.config.json');
  const project = JSON.parse(fs.readFileSync(projectFile));
  if (project.appid !== APP_ID) {
    throw new Error('Wrong AppID.');
  }
  project.description = 'MoodSky ' + APP_VERSION + ' production package';
  project.cloudfunctionRoot = 'cloud/';
  project.setting.urlCheck = true;
  project.setting.uploadWithSourceMap = false;
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n');
  // The IDE normalizes cloud roots outside an imported project. Import the package
  // root to keep both client and function folders inside the same real project.
  const rootProject = { ...project, miniprogramRoot: 'client/miniprogram/' };
  fs.writeFileSync(
    path.join(outputRoot, 'project.config.json'),
    JSON.stringify(rootProject, null, 2) + '\n',
  );
  const appFile = path.join(client, 'miniprogram/app.json');
  const app = JSON.parse(fs.readFileSync(appFile));
  delete app.permission;
  delete app.requiredPrivateInfos;
  fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n');
  fs.writeFileSync(
    path.join(client, 'miniprogram/config/environment.local.js'),
    'module.exports = ' +
      JSON.stringify(
        {
          cloudEnabled: true,
          cloudEnvId: ENV_ID,
          cloudFunctionName: functionName,
          journalDemo: false,
          trustedSessionEnabled: true,
          releaseProfile: 'production',
          taskMode,
          explicitWechatLogin: true,
          requestTimeoutMs: 25000,
        },
        null,
        2,
      ) +
      ';\n',
  );
  const cloud = {};
  for (const [name, entry] of [
    [functionName, 'index.js'],
    [workerName, 'worker.js'],
  ]) {
    const target = path.join(outputRoot, 'cloud', name);
    fs.mkdirSync(target, { recursive: true });
    esbuild.buildSync({
      entryPoints: [path.join(sourceRoot, 'cloudfunctions/moodsky/production', entry)],
      outfile: path.join(target, 'index.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node16',
      external: ['wx-server-sdk', '@cloudbase/node-sdk'],
    });
    for (const file of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(
        path.join(sourceRoot, 'cloudfunctions/moodsky', file),
        path.join(target, file),
      );
    }
    const serverFiles = ['index.js', 'package.json', 'package-lock.json'];
    if (name === workerName) {
      fs.copyFileSync(
        path.join(sourceRoot, 'cloudfunctions/moodsky/production/timer.config.json'),
        path.join(target, 'config.json'),
      );
      serverFiles.push('config.json');
    }
    cloud[name] = Object.fromEntries(
      serverFiles.map((file) => [file, hash(path.join(target, file))]),
    );
  }
  const clientFiles = [...tracked, 'miniprogram/config/environment.local.js'];
  for (const name of clientFiles) {
    hashes[name] = hash(path.join(client, name));
  }
  const manifest = {
    status: 'local-candidate-not-deployed',
    taskMode,
    uploadVersion: APP_VERSION,
    serverBuildVersion: RELEASE_VERSION,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sourceRoot,
      encoding: 'utf8',
    }).trim(),
    sourceWorktreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
    ),
    appId: APP_ID,
    environmentId: ENV_ID,
    functionName,
    workerName,
    filing: 'not-checked-by-packager',
    wechatCertification: 'not-checked-by-packager',
    clientHashes: hashes,
    rootProjectHash: hash(path.join(outputRoot, 'project.config.json')),
    cloudHashes: cloud,
    sourcePersonalConfigIncluded: false,
    serverSecretsIncluded: false,
    locationApiEnabled: false,
    uploaded: false,
    deployed: false,
    cloudLifecycleVerified: false,
    phoneVerified: false,
    submittedForReview: false,
    publicRelease: false,
  };
  fs.writeFileSync(
    path.join(outputRoot, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outputRoot, 'server.env.example'),
    '# Server-only values. Keep the identity key stable; retain all keys in a secure backup.\n' +
      'MOODSKY_PRODUCTION_ENABLED=false\nMOODSKY_IDENTITY_KEY_HEX=\nMOODSKY_SESSION_KEY_HEX=\nMOODSKY_RECEIPT_KEY_HEX=\n',
  );
  return { outputRoot, clientFiles: clientFiles.length, version: APP_VERSION, manifest };
}
if (require.main === module) {
  const result = buildProduction({
    outputRoot: process.argv[2],
    ...(process.argv[3] === 'isolated'
      ? { functionName: 'moodsky-release', workerName: 'moodsky-release-maintenance' }
      : {}),
  });
  console.log(
    JSON.stringify({
      outputRoot: result.outputRoot,
      clientFiles: result.clientFiles,
      version: result.version,
    }),
  );
}
module.exports = { buildProduction };
