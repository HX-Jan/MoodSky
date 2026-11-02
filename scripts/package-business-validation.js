const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const config = require('../tools/business-validation/config');
const { assertSharedContracts } = require('./shared-contracts');
function buildValidation() {
  const root = path.resolve(__dirname, '..');
  assertSharedContracts(root);
  const target = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-business-validation-')),
    config.functionName,
  );
  fs.mkdirSync(target);
  esbuild.buildSync({
    entryPoints: [path.join(root, 'tools/business-validation/index.js')],
    outfile: path.join(target, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['wx-server-sdk', '@cloudbase/node-sdk'],
  });
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, 'tools/h03-probe', file), path.join(target, file));
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
    status: 'prepared-not-deployed',
    ...config,
    hashes,
    formalFunctionChanged: false,
    businessCollectionsAllowed: false,
    cleanupAllowed: false,
    indexOrPermissionChangesAllowed: false,
    retainedBatchesAllowed: false,
    operations: ['run', 'inspect'],
    productionEnabled: false,
  };
  fs.writeFileSync(
    path.join(target, 'validation-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return { target, manifest };
}
if (require.main === module) {
  console.log(JSON.stringify(buildValidation()));
}
module.exports = { buildValidation };
