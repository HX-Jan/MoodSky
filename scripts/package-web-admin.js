// Local-only package builder. Never uploads, configures identities, or writes data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const { execFileSync } = require('node:child_process');
const { assertSharedContracts } = require('./shared-contracts');
function buildWebAdminPackage({ outputRoot, sourceRoot = path.resolve(__dirname, '..') } = {}) {
  if (!outputRoot || !path.isAbsolute(outputRoot) || fs.existsSync(outputRoot)) {
    throw new TypeError('Choose a new absolute output directory.');
  }
  const parent = fs.realpathSync(path.dirname(outputRoot));
  const target = path.join(parent, path.basename(outputRoot));
  const realSource = fs.realpathSync(sourceRoot);
  const relative = path.relative(realSource, target);
  if (!(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))) {
    throw new TypeError('Keep the deployment package outside the checkout.');
  }
  assertSharedContracts(realSource);
  const source = path.join(realSource, 'cloudfunctions/moodsky');
  const functionPath = path.join(target, 'moodsky-web-admin');
  fs.mkdirSync(functionPath, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(source, 'web-admin/index.js')],
    outfile: path.join(functionPath, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['wx-server-sdk'],
  });
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(source, name), path.join(functionPath, name));
  }
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const manifest = {
    functionName: 'moodsky-web-admin',
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: realSource,
      encoding: 'utf8',
    }).trim(),
    sourceTreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
        cwd: realSource,
        encoding: 'utf8',
      }).trim(),
    ),
    deployed: false,
    defaultEnabled: false,
    defaultWritesEnabled: false,
    defaultContextDiagnosticsEnabled: false,
    environmentVariables: [
      'MOODSKY_WEB_ADMIN_ENABLED',
      'MOODSKY_WEB_ADMIN_ENV',
      'MOODSKY_WEB_ADMIN_BINDINGS',
      'MOODSKY_WEB_ADMIN_WRITES_ENABLED',
      'MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS',
    ],
    files: Object.fromEntries(
      ['index.js', 'package.json', 'package-lock.json'].map((name) => [
        name,
        hash(path.join(functionPath, name)),
      ]),
    ),
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { functionPath, manifest };
}
module.exports = { buildWebAdminPackage };
if (require.main === module) {
  const outputRoot = process.argv[2];
  const result = buildWebAdminPackage({ outputRoot });
  console.log(
    JSON.stringify({
      functionPath: result.functionPath,
      deployed: false,
      defaultWritesEnabled: false,
    }),
  );
}
