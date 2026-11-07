const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { buildWebAdminPackage } = require('../scripts/package-web-admin');
test('independent backend package bundles its local dependencies and starts closed without loading a cloud SDK', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-web-admin-test-'));
  try {
    const outputRoot = path.join(temp, 'candidate');
    const { functionPath, manifest } = buildWebAdminPackage({ outputRoot });
    for (const [name, hash] of Object.entries(manifest.files)) {
      assert.equal(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(functionPath, name)))
          .digest('hex'),
        hash,
      );
    }
    assert.deepEqual(fs.readdirSync(functionPath).sort(), [
      'index.js',
      'package-lock.json',
      'package.json',
    ]);
    assert.equal(manifest.deployed, false);
    assert.equal(typeof manifest.sourceTreeDirty, 'boolean');
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(functionPath, 'index.js'), 'utf8'), {
      module,
      exports: module.exports,
      process: { env: {} },
      require: (name) => {
        assert.equal(name.startsWith('node:'), true, 'no SDK/file imports in disabled entry');
        return require(name);
      },
    });
    const request = {
      apiVersion: '1',
      requestId: 'web_package_test_001',
      action: 'system.health',
      payload: {},
    };
    const health = await module.exports.main(request, {});
    assert.equal(health.ok, true);
    assert.equal(health.data.configured, false);
    assert.equal(health.data.readOnly, true);
    assert.equal(
      (await module.exports.main({ ...request, action: 'admin.listPlaces' }, {})).error.code,
      'NOT_IMPLEMENTED',
    );
    await assert.rejects(async () => buildWebAdminPackage({ outputRoot }), /new absolute/);
    const sourceRoot = path.resolve(__dirname, '..');
    await assert.rejects(
      async () => buildWebAdminPackage({ outputRoot: path.join(sourceRoot, 'web-admin-output') }),
      /outside the checkout/,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
