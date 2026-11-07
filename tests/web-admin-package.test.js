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
    assert.equal(manifest.defaultContextDiagnosticsEnabled, false);
    assert.ok(manifest.environmentVariables.includes('MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS'));
    const runtimeEnv = {};
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(functionPath, 'index.js'), 'utf8'), {
      module,
      exports: module.exports,
      process: { env: runtimeEnv },
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
    assert.equal(Object.hasOwn(health.data, 'contextDiagnostics'), false);
    runtimeEnv.MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS = 'true';
    const diagnosed = await module.exports.main(request, {
      environment: JSON.stringify({
        TCB_UUID: 'synthetic_private_subject',
        TCB_SOURCE: 'synthetic_private_source',
        TCB_ENV: 'synthetic_private_environment',
        TCB_ISANONYMOUS_USER: false,
      }),
    });
    assert.equal(diagnosed.data.configured, false);
    assert.equal(diagnosed.data.readOnly, true);
    assert.equal(diagnosed.data.contextDiagnostics.uid, 'valid_format');
    assert.equal(diagnosed.data.contextDiagnostics.source, 'other');
    assert.equal(diagnosed.data.contextDiagnostics.environment, 'mismatch');
    assert.equal(diagnosed.data.contextDiagnostics.anonymousMarker, 'false_boolean');
    assert.equal(diagnosed.data.contextDiagnostics.accepted, false);
    assert.equal(JSON.stringify(diagnosed).includes('synthetic_private'), false);
    runtimeEnv.MOODSKY_WEB_ADMIN_CONTEXT_DIAGNOSTICS = 'false';
    assert.equal(
      Object.hasOwn((await module.exports.main(request, {})).data, 'contextDiagnostics'),
      false,
    );
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
