// Reproducible pre-filing package preparation. No upload, cloud call or secrets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
function buildPrelaunch({ outputRoot, sourceRoot = path.resolve(__dirname, '..') } = {}) {
  if (!outputRoot || !path.isAbsolute(outputRoot) || fs.existsSync(outputRoot)) {
    throw new TypeError('Choose a new absolute output folder.');
  }
  const relative = path.relative(sourceRoot, outputRoot);
  if (!(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
    throw new TypeError('Keep deployment output outside the Git checkout.');
  }
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'miniprogram', 'project.config.json'],
    { cwd: sourceRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const client = path.join(outputRoot, 'client');
  const cloud = path.join(outputRoot, 'cloud', 'moodsky');
  const hashes = {};
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  for (const file of files) {
    if (file === 'miniprogram/config/environment.local.js') {
      throw new Error('Local environment must not be tracked.');
    }
    const source = path.join(sourceRoot, file);
    if (!fs.lstatSync(source).isFile()) {
      throw new Error('Only regular tracked files can be packaged.');
    }
    const real = path.relative(sourceRoot, fs.realpathSync(source));
    if (real.startsWith('..') || path.isAbsolute(real)) {
      throw new Error('Source escaped checkout.');
    }
    const dest = path.join(client, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    hashes[file] = sha(dest);
  }
  const project = JSON.parse(fs.readFileSync(path.join(client, 'project.config.json'), 'utf8'));
  if (project.appid !== 'wxf602e991ff44e6c8' || project.miniprogramRoot !== 'miniprogram/') {
    throw new Error('Wrong mini-program project.');
  }
  const weather = require(path.join(sourceRoot, 'miniprogram/shared/constants')).WEATHER_TYPES.map(
    (item) => item.code,
  );
  if (
    JSON.stringify(weather) !==
    JSON.stringify([
      'SUNNY',
      'PARTLY_CLOUDY',
      'CLOUDY',
      'RAINY',
      'STORMY',
      'HEAVY_RAIN',
      'TYPHOON',
      'CUSTOM',
    ])
  ) {
    throw new Error('Unexpected weather baseline.');
  }
  fs.writeFileSync(
    path.join(client, 'miniprogram/config/environment.local.js'),
    "module.exports = { cloudEnabled: false, cloudEnvId: '', journalDemo: true };\n",
  );
  fs.mkdirSync(cloud, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(sourceRoot, 'cloudfunctions/moodsky/index.js')],
    outfile: path.join(cloud, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['wx-server-sdk'],
  });
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(sourceRoot, 'cloudfunctions/moodsky', file), path.join(cloud, file));
  }
  const manifest = {
    status: 'prepared-not-uploaded',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sourceRoot,
      encoding: 'utf8',
    }).trim(),
    sourceWorktreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
    ),
    appId: project.appid,
    buildId: 'prelaunch-20261025-1',
    filingStatus: 'pending-user-reported',
    publicReleaseEnabled: false,
    privateBusinessEnabled: false,
    clientMode: 'explicit-synthetic-memory-demo',
    trackedClientFiles: files.length,
    weather,
    clientHashes: hashes,
    cloudHashes: Object.fromEntries(
      ['index.js', 'package.json', 'package-lock.json'].map((file) => [
        file,
        sha(path.join(cloud, file)),
      ]),
    ),
    localEnvironmentIncluded: false,
    paidResourcesCreated: false,
    automaticCloudCalls: false,
  };
  fs.writeFileSync(
    path.join(outputRoot, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { client, cloud, manifest };
}
if (require.main === module) {
  console.log(JSON.stringify(buildPrelaunch({ outputRoot: process.argv[2] })));
}
module.exports = { buildPrelaunch };
