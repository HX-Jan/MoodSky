const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const { assertSharedContracts } = require('../scripts/shared-contracts');
const { buildPrelaunch } = require('../scripts/package-prelaunch');
const root = path.resolve(__dirname, '..');

function pair() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-contract-pair-'));
  const source = path.join(base, 'miniprogram/shared');
  const target = path.join(base, 'cloudfunctions/moodsky/shared');
  for (const directory of [source, target]) {
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['constants.js', 'types.d.ts']) {
      fs.copyFileSync(path.join(root, 'miniprogram/shared', name), path.join(directory, name));
    }
  }
  return { base, source, target };
}

test('contract check catches changed, missing and obsolete extra generated files without repairing them', () => {
  for (const kind of ['changed', 'missing', 'extra']) {
    const { base, source, target } = pair();
    assert.deepEqual(assertSharedContracts(base), ['constants.js', 'types.d.ts']);
    if (kind === 'changed') {
      fs.appendFileSync(path.join(target, 'constants.js'), '\n// stale copy\n');
    }
    if (kind === 'missing') {
      fs.renameSync(path.join(target, 'types.d.ts'), path.join(target, 'types.old'));
    }
    if (kind === 'extra') {
      fs.writeFileSync(path.join(target, 'obsolete.js'), 'module.exports = {};\n');
    }
    const before = fs
      .readdirSync(target)
      .map((name) => [name, fs.readFileSync(path.join(target, name))]);
    assert.throws(() => assertSharedContracts(base), /Run npm run cloud:prepare/);
    assert.deepEqual(
      fs.readdirSync(target).map((name) => [name, fs.readFileSync(path.join(target, name))]),
      before,
    );
    assert.equal(
      fs
        .readFileSync(path.join(source, 'constants.js'))
        .equals(fs.readFileSync(path.join(root, 'miniprogram/shared/constants.js'))),
      true,
    );
  }
  assert.throws(
    () => assertSharedContracts(path.join(os.tmpdir(), 'moodsky-nonexistent-contract-root')),
    /missing or stale/,
  );
});

test('prelaunch refuses a real five-weather cloud copy before output, then packages the synchronized seven-weather sources', () => {
  const { base, source, target } = pair();
  const config = path.join(base, 'miniprogram/config');
  fs.mkdirSync(config);
  fs.copyFileSync(
    path.join(root, 'miniprogram/config/environment.example.js'),
    path.join(config, 'environment.example.js'),
  );
  fs.copyFileSync(path.join(root, 'project.config.json'), path.join(base, 'project.config.json'));
  const cloud = path.dirname(target);
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, 'cloudfunctions/moodsky', name), path.join(cloud, name));
  }
  fs.writeFileSync(
    path.join(cloud, 'index.js'),
    "exports.main = () => require('./shared/constants').WEATHER_TYPES.map(item => item.code);\n",
  );
  execFileSync('git', ['init', '-q'], { cwd: base });
  execFileSync('git', ['add', 'miniprogram', 'project.config.json', 'cloudfunctions'], {
    cwd: base,
  });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Synthetic',
      '-c',
      'user.email=synthetic@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'synthetic fixture',
    ],
    { cwd: base },
  );
  const obsolete = fs
    .readFileSync(path.join(source, 'constants.js'), 'utf8')
    .split('\n')
    .filter((line) => !line.includes("code: 'TYPHOON'") && !line.includes("code: 'CUSTOM'"))
    .join('\n');
  fs.writeFileSync(path.join(target, 'constants.js'), obsolete);
  const output = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-contract-output-')),
    'release',
  );
  assert.throws(
    () => buildPrelaunch({ sourceRoot: base, outputRoot: output }),
    /Shared contracts.*constants.js/,
  );
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.readFileSync(path.join(target, 'constants.js'), 'utf8'), obsolete);
  fs.copyFileSync(path.join(source, 'constants.js'), path.join(target, 'constants.js'));
  const prepared = buildPrelaunch({ sourceRoot: base, outputRoot: output });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(prepared.cloud, 'index.js'), 'utf8'), {
    module,
    exports: module.exports,
  });
  assert.deepEqual(Array.from(module.exports.main()), prepared.manifest.weather);
  assert.equal(prepared.manifest.weather.length, 7);
  // Both copies can also be rolled back together between builds. A cached
  // seven-weather export must never approve five-weather files on disk.
  for (const directory of [source, target]) {
    fs.writeFileSync(path.join(directory, 'constants.js'), obsolete);
  }
  const rolledBackOutput = output + '-rolled-back';
  assert.throws(
    () => buildPrelaunch({ sourceRoot: base, outputRoot: rolledBackOutput }),
    /Unexpected weather baseline/,
  );
  assert.equal(fs.existsSync(rolledBackOutput), false);
});

for (const [script, factory] of [
  ['package-business-validation', 'buildValidation'],
  ['package-week3-validation', 'buildWeek3Validation'],
]) {
  test(script + ' rejects stale contracts before allocating a deployment directory', () => {
    // Mutate only this child process's file reads; never edit the checkout or call cloud APIs.
    const code = `
      const fs = require('node:fs'), path = require('node:path');
      const stale = path.resolve('cloudfunctions/moodsky/shared/constants.js');
      const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        const result = read.call(this, file, ...args);
        if (typeof file === 'string' && path.resolve(file) === stale) {
          return Buffer.isBuffer(result) ? Buffer.concat([result, Buffer.from('\\n// stale')]) : result + '\\n// stale';
        }
        return result;
      };
      fs.mkdtempSync = () => { throw Error('Output allocation reached before contract validation'); };
      require('./scripts/${script}').${factory}();
    `;
    const result = spawnSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Shared contracts are missing or stale/);
    assert.match(result.stderr, /Run npm run cloud:prepare/);
  });
}
