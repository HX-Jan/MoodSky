const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const config = require('../tools/h03-probe/config');

function buildProbe() {
  const root = path.resolve(__dirname, '..');
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-h03-probe-'));
  const target = path.join(stagingRoot, config.functionName);
  fs.mkdirSync(target);
  esbuild.buildSync({
    entryPoints: [path.join(root, 'tools/h03-probe/index.js')],
    outfile: path.join(target, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['wx-server-sdk'],
  });
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, 'cloudfunctions/moodsky', file), path.join(target, file));
  }
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const hashes = {};
  for (const name of ['index.js', 'package.json', 'package-lock.json']) {
    hashes[name] = hash(path.join(target, name));
  }
  const indexes = [
    { collection: config.collections.journals, keys: ['ownerId', 'date'] },
    { collection: config.collections.receipts, keys: ['ownerId', 'action', 'requestId'] },
  ].map(({ collection, keys }) => ({
    collection,
    options: {
      CreateIndexes: [
        {
          IndexName: 'uniq_' + keys.join('_'),
          MgoKeySchema: {
            MgoIndexKeys: keys.map((Name) => ({ Name, Direction: '1' })),
            MgoIsUnique: true,
          },
        },
      ],
    },
  }));
  const manifest = {
    status: 'prepared-not-deployed',
    probeVersion: '1',
    functionName: config.functionName,
    environmentId: config.environmentId,
    appId: config.appId,
    runtime: config.runtime,
    timeoutSeconds: 60,
    memoryMb: 256,
    operatorSetting: config.operatorSetting,
    collections: Object.values(config.collections),
    indexes,
    clientRule: { read: false, write: false },
    hashes,
    businessCollectionsAllowed: false,
    coverage: ['V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08'],
    deferred: ['V09', 'V10', 'V11', 'V12'],
  };
  fs.writeFileSync(
    path.join(target, 'probe-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { target, manifest };
}

if (require.main === module) {
  const { target } = buildProbe();
  console.log('Prepared isolated deployment directory: ' + target);
  console.log('No cloud resources were created or accessed.');
}
module.exports = { buildProbe };
