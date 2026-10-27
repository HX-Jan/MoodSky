const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const config = require('../tools/week3-validation/config');
const { commandSources } = require('../tools/week3-validation/commands');
function buildWeek3Validation({ outputRoot } = {}) {
  const sourceRoot = path.resolve(__dirname, '..');
  if (outputRoot) {
    if (!path.isAbsolute(outputRoot) || fs.existsSync(outputRoot)) {
      throw new TypeError('Choose a new absolute output folder.');
    }
    const relative = path.relative(sourceRoot, path.resolve(outputRoot));
    if (!(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
      throw new TypeError('Keep deployment output outside Git checkout.');
    }
    fs.mkdirSync(outputRoot, { recursive: true });
  } else {
    outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-w3-validation-'));
  }
  const target = path.join(outputRoot, config.functionName);
  fs.mkdirSync(target);
  esbuild.buildSync({
    entryPoints: [path.join(sourceRoot, 'tools/week3-validation/index.js')],
    outfile: path.join(target, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['wx-server-sdk', '@cloudbase/node-sdk'],
  });
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(sourceRoot, 'tools/h03-probe', file), path.join(target, file));
  }
  const hashes = Object.fromEntries(
    ['index.js', 'package.json', 'package-lock.json'].map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(target, file)))
        .digest('hex'),
    ]),
  );
  const manifest = {
    ...config,
    status: 'prepared-not-deployed',
    hashes,
    operations: ['prepare', 'worker', 'read', 'inspect'],
    workerCalls: 4,
    maximumSeedDays: 90,
    syntheticOnly: true,
    syntheticPublicReceiptKey: true,
    businessCollectionsAllowed: false,
    cleanupAllowed: false,
    indexOrPermissionChangesAllowed: false,
    retainedBatchesAllowed: false,
    productionEnabled: false,
    newCloudAuthorizationRequired: true,
    observationDoesNotGuaranteeSeparateInstances: true,
    restorePreviousProbeRequired: true,
  };
  const calls = path.join(outputRoot, 'calls');
  fs.mkdirSync(calls);
  for (const [phase, source] of Object.entries(commandSources())) {
    fs.writeFileSync(path.join(calls, phase + '.js'), source + '\n');
  }
  fs.writeFileSync(
    path.join(target, 'week3-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { target, manifest };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output')) {
    throw new TypeError('Use --output with a new absolute folder.');
  }
  console.log(JSON.stringify(buildWeek3Validation({ outputRoot: args[1] })));
}
module.exports = { buildWeek3Validation };
