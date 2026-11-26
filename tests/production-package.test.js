const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { buildProduction } = require('../scripts/package-production');
const { clientCapabilities } = require('../miniprogram/modules/system/capabilities');

test('phone opt-in packages native permission, then its actual bundled entry consumes the SDK phone code', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-phone-package-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(parent)), path.resolve(os.tmpdir()));
    fs.rmSync(parent, { recursive: true, force: true });
  });
  const outputRoot = path.join(parent, 'candidate');
  const result = buildProduction({ outputRoot, phoneLoginEnabled: true });
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(outputRoot, 'client/miniprogram/config/environment.local.js'),
      'utf8',
    ),
    { module },
  );
  assert.equal(module.exports.phoneLoginEnabled, true);
  assert.equal(result.manifest.phoneLoginEnabled, true);
  const permissionFile = path.join(outputRoot, 'cloud/moodsky-release/config.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(permissionFile, 'utf8')), {
    permissions: { openapi: ['phonenumber.getPhoneNumber'] },
  });
  assert.ok(result.manifest.cloudHashes['moodsky-release']['config.json']);
  assert.match(
    fs.readFileSync(path.join(outputRoot, 'server.env.example'), 'utf8'),
    /MOODSKY_PHONE_LOGIN_ENABLED=false/,
  );

  // Synthetic native CloudBase boundary: doc.set/update take plain data,
  // doc.get returns arrays. Do not feed a WX-shaped repository to this adapter.
  let rows = new Map();
  const collection = (store, name) => {
    assert.equal(name, 'accounts');
    return {
      doc(id) {
        return {
          get: async () => ({
            data: store.has(id) ? [globalThis.structuredClone(store.get(id))] : [],
          }),
          set: async (data) => {
            assert.equal(data.data, undefined);
            store.set(id, { ...globalThis.structuredClone(data), _id: id });
            return { updated: 1 };
          },
          update: async (data) => {
            assert.ok(store.has(id));
            Object.assign(store.get(id), globalThis.structuredClone(data));
            return { updated: 1 };
          },
        };
      },
    };
  };
  const native = {
    collection: (name) => collection(rows, name),
    async runTransaction(work) {
      const draft = globalThis.structuredClone(rows);
      const value = await work({ collection: (name) => collection(draft, name) });
      rows = draft;
      return value;
    },
  };
  const deployment = {
    storage: 'server-deployment-config-v1',
    appId: result.manifest.appId,
    environmentId: result.manifest.environmentId,
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_PHONE_LOGIN_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  };
  const env = {},
    codeCalls = [],
    packaged = { exports: {} };
  const bundled = path.join(outputRoot, 'cloud/moodsky-release/index.js');
  vm.runInNewContext(fs.readFileSync(bundled, 'utf8'), {
    module: packaged,
    exports: packaged.exports,
    Buffer,
    process: { env },
    __dirname: path.dirname(bundled),
    require(name) {
      if (name === 'node:fs') {
        return {
          readFileSync(file) {
            assert.equal(path.basename(file), 'runtime.local.json');
            return JSON.stringify(deployment);
          },
        };
      }
      if (name === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: 'synthetic_dynamic',
          init() {},
          openapi: {
            phonenumber: {
              getPhoneNumber: async (input) => {
                codeCalls.push(input);
                if (input.code === 'invalid') {
                  throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
                }
                return {
                  errCode: 0,
                  phoneInfo: { countryCode: '86', purePhoneNumber: '13800000001' },
                };
              },
            },
          },
        };
      }
      if (name === '@cloudbase/node-sdk') {
        return {
          init({ env: target }) {
            assert.equal(target, result.manifest.environmentId);
            return { database: () => native };
          },
        };
      }
      return require(name);
    },
  });
  const context = {
    environment: JSON.stringify({
      WX_APPID: result.manifest.appId,
      WX_OPENID: 'synthetic_packaged_wechat',
      TCB_ENV: result.manifest.environmentId,
      TCB_SOURCE: 'wx_client',
    }),
  };
  let serial = 0;
  const invoke = (action, payload = {}, extra = {}) =>
    packaged.exports.main(
      { apiVersion: '1', requestId: 'req_phone_bundle_' + ++serial, action, payload, ...extra },
      context,
    );
  assert.equal((await invoke('system.health')).data.phoneLoginEnabled, true);
  const logged = await invoke('account.phoneLogin', {
    mode: 'login',
    code: 'synthetic_native_code',
  });
  assert.equal(logged.ok, true, JSON.stringify(logged));
  assert.equal(logged.data.authenticated, true);
  assert.equal(logged.data.phoneLabel, '138****0001');
  assert.deepEqual(JSON.parse(JSON.stringify(codeCalls)), [{ code: 'synthetic_native_code' }]);
  const restored = await invoke('account.session', {}, { phoneSession: logged.data.phoneSession });
  assert.equal(restored.data.scope, logged.data.scope);
  const denied = await invoke('account.phoneLogin', { mode: 'login', code: 'invalid' });
  assert.equal(denied.error.code, 'UNAUTHENTICATED');
  assert.doesNotMatch(JSON.stringify(denied), /SYNTHETIC_PRIVATE_PROVIDER_ERROR/);
  assert.doesNotMatch(JSON.stringify([...rows.values()]), /13800000001|synthetic_native_code/);
  env.MOODSKY_PHONE_LOGIN_ENABLED = 'false';
  assert.equal((await invoke('system.health')).data.phoneLoginEnabled, false);
  assert.equal(
    (await invoke('account.phoneLogin', { mode: 'login', code: 'blocked' })).error.code,
    'NOT_IMPLEMENTED',
  );
  assert.equal(codeCalls.length, 2);
});
test('packaging rejects a stale version in the selected checkout before writing output', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-release-version-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const sourceRoot = path.join(parent, 'source');
  for (const name of [
    'package.json',
    'package-lock.json',
    'miniprogram/shared',
    'cloudfunctions/moodsky/shared',
    'cloudfunctions/moodsky/package.json',
    'cloudfunctions/moodsky/package-lock.json',
    'cloudfunctions/moodsky/production/config.js',
  ]) {
    const target = path.join(sourceRoot, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(__dirname, '..', name), target, { recursive: true });
  }
  const stale = path.join(sourceRoot, 'cloudfunctions/moodsky/package-lock.json');
  const lock = JSON.parse(fs.readFileSync(stale, 'utf8'));
  lock.packages[''].version = '0.4.0';
  fs.writeFileSync(stale, JSON.stringify(lock));
  const outputRoot = path.join(parent, 'candidate');
  assert.throws(
    () => buildProduction({ sourceRoot, outputRoot }),
    /release versions differ.*cloudfunctions\/moodsky\/package-lock\.json packages/,
  );
  assert.equal(fs.existsSync(outputRoot), false);
});
for (const taskMode of ['readOnly', 'enabled']) {
  test(`reviewed ${taskMode} package carries the same task scope in the client and manifest`, (t) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-task-mode-'));
    t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const outputRoot = path.join(parent, 'candidate');
    const built = buildProduction({ outputRoot, taskMode });
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(
        path.join(outputRoot, 'client/miniprogram/config/environment.local.js'),
        'utf8',
      ),
      { module },
    );
    assert.equal(module.exports.taskMode, taskMode);
    assert.equal(built.manifest.taskMode, taskMode);
    const capability = clientCapabilities(module.exports).tasks;
    assert.equal(capability.state, taskMode === 'readOnly' ? 'readOnly' : 'available');
    assert.equal(capability.historyAvailable, taskMode === 'enabled');
  });
}
test('unrecognized task scope is rejected before creating a release package', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-task-mode-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const outputRoot = path.join(parent, 'candidate');
  assert.throws(() => buildProduction({ outputRoot, taskMode: 'readonly' }), /reviewed taskMode/);
  assert.equal(fs.existsSync(outputRoot), false);
});
test('explicit production package has account page, cloud configuration, denied location declarations and complete hashes', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-production-package-'));
  t.after(() => {
    const resolved = path.resolve(parent);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('moodsky-production-package-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const outputRoot = path.join(parent, 'candidate');
  const built = buildProduction({ outputRoot });
  assert.equal(built.version, '0.5.3');
  assert.equal(built.manifest.uploadVersion, '0.5.3');
  assert.equal(built.manifest.serverBuildVersion, '0.5.3');
  assert.equal(built.manifest.campusCheckinWritesPausedByDefault, true);
  assert.equal(built.manifest.functionName, 'moodsky-release');
  assert.equal(built.manifest.workerName, 'moodsky-release-maintenance');
  assert.equal(built.manifest.uploaded, false);
  assert.equal(built.manifest.cloudLifecycleVerified, false);
  assert.equal(built.manifest.serverSecretsIncluded, false);
  const app = JSON.parse(fs.readFileSync(path.join(outputRoot, 'client/miniprogram/app.json')));
  assert.ok(app.pages.includes('pages/account/index'));
  assert.ok(fs.existsSync(path.join(outputRoot, 'client/miniprogram/modules/share/app-share.js')));
  assert.equal(app.permission, undefined);
  assert.equal(app.requiredPrivateInfos, undefined);
  const environmentModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(outputRoot, 'client/miniprogram/config/environment.local.js'),
      'utf8',
    ),
    { module: environmentModule },
  );
  assert.equal(environmentModule.exports.releaseProfile, 'production');
  const expectedBuildCommit = built.manifest.sourceWorktreeDirty ? '' : built.manifest.sourceCommit;
  assert.equal(environmentModule.exports.buildCommit, expectedBuildCommit);
  assert.equal(environmentModule.exports.taskMode, 'closed');
  assert.equal(built.manifest.taskMode, 'closed');
  assert.equal(environmentModule.exports.journalDemo, false);
  assert.equal(environmentModule.exports.cloudEnabled, true);
  assert.equal(environmentModule.exports.cloudFunctionName, built.manifest.functionName);
  const project = JSON.parse(fs.readFileSync(path.join(outputRoot, 'client/project.config.json')));
  assert.equal(project.setting.urlCheck, true);
  const rootProject = JSON.parse(fs.readFileSync(path.join(outputRoot, 'project.config.json')));
  assert.equal(rootProject.miniprogramRoot, 'client/miniprogram/');
  assert.equal(rootProject.cloudfunctionRoot, 'cloud/');
  assert.ok(
    fs.existsSync(
      path.join(outputRoot, rootProject.cloudfunctionRoot, built.manifest.functionName, 'index.js'),
    ),
  );
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(outputRoot, 'cloud', built.manifest.workerName, 'config.json')),
    ),
    require('../cloudfunctions/moodsky/production/timer.config.json'),
  );
  for (const [name, hash] of Object.entries(built.manifest.clientHashes)) {
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(outputRoot, 'client', name)))
        .digest('hex'),
      hash,
    );
  }
  assert.throws(() => buildProduction({ outputRoot }), /new absolute/);
  const code = fs.readFileSync(
    path.join(outputRoot, 'cloud', built.manifest.functionName, 'index.js'),
    'utf8',
  );
  assert.doesNotMatch(code, /SIMULATED_NO_NETWORK|createMemoryJournalRepository|合成演示：/);
  const module = { exports: {} };
  const runtimeEnv = {};
  let deploymentFile = null;
  let databaseOpens = 0;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    Buffer,
    process: { env: runtimeEnv },
    require(name) {
      if (name === 'wx-server-sdk') {
        return { DYNAMIC_CURRENT_ENV: 'synthetic_env', init() {} };
      }
      if (name === '@cloudbase/node-sdk') {
        databaseOpens++;
        throw new Error('unconfigured package must remain closed');
      }
      if (name === 'node:fs') {
        return {
          readFileSync(file) {
            assert.equal(path.basename(file), 'runtime.local.json');
            if (!deploymentFile) {
              throw new Error('no deployment file');
            }
            return JSON.stringify(deploymentFile);
          },
        };
      }
      return require(name);
    },
    __dirname: path.join(outputRoot, 'cloud', built.manifest.functionName),
  });
  const request = (action) => ({
    apiVersion: '1',
    requestId: 'req_production_packaged',
    action,
    payload: {},
  });
  assert.equal((await module.exports.main(request('system.health'))).data.configured, false);
  assert.equal(
    (await module.exports.main(request('account.session'))).error.code,
    'NOT_IMPLEMENTED',
  );
  assert.equal(databaseOpens, 0);
  const credentials = {
    MOODSKY_PRODUCTION_ENABLED: 'true',
    MOODSKY_IDENTITY_KEY_HEX: '11'.repeat(32),
    MOODSKY_SESSION_KEY_HEX: '22'.repeat(32),
    MOODSKY_RECEIPT_KEY_HEX: '33'.repeat(32),
  };
  Object.assign(runtimeEnv, credentials);
  const health = async () => (await module.exports.main(request('system.health'))).data;
  assert.equal((await health()).buildCommit, expectedBuildCommit || undefined);
  assert.equal((await health()).configured, true);
  assert.equal((await health()).campusCheckinWritesPaused, true);
  runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  assert.equal((await health()).campusCheckinWritesPaused, false);

  for (const name of Object.keys(credentials)) {
    delete runtimeEnv[name];
  }
  delete runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED;
  deploymentFile = {
    storage: 'server-deployment-config-v1',
    appId: built.manifest.appId,
    environmentId: built.manifest.environmentId,
    ...credentials,
  };
  assert.equal((await health()).configured, true);
  assert.equal((await health()).campusCheckinWritesPaused, true);
  runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  assert.equal((await health()).campusCheckinWritesPaused, false);

  deploymentFile.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  for (const setting of ['true', 'invalid']) {
    runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = setting;
    assert.equal((await health()).configured, true);
    assert.equal((await health()).campusCheckinWritesPaused, true);
  }
  delete runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED;
  assert.equal((await health()).campusCheckinWritesPaused, false);

  runtimeEnv.MOODSKY_CAMPUS_CHECKIN_WRITES_PAUSED = 'false';
  runtimeEnv.MOODSKY_PRODUCTION_ENABLED = 'false';
  assert.equal((await health()).configured, false);
  assert.equal((await health()).campusCheckinWritesPaused, true);
  assert.equal(databaseOpens, 0);
});
