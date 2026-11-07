// Read-only local preflight. Never prints configuration values or credentials.
const fs = require('node:fs');
const { URL } = require('node:url');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
function configured() {
  const filename = path.join(root, 'admin/config.js');
  if (!fs.existsSync(filename)) {
    return null;
  }
  const context = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { timeout: 1000 });
  return context.MOODSKY_ADMIN_CONFIG || null;
}
function httpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_error) {
    return false;
  }
}
let config,
  configReadable = true;
try {
  config = configured();
} catch (_error) {
  configReadable = false;
}
const sdk = path.join(root, 'admin/node_modules/@cloudbase/js-sdk/package.json');
const sdkPinned =
  fs.existsSync(sdk) && JSON.parse(fs.readFileSync(sdk, 'utf8')).version === '3.4.8';
const passwordMode = config?.loginMethod === 'password';
const checks = {
  localConfigReadable: configReadable,
  localConfigPresent: Boolean(config),
  envAndRegionConfigured: Boolean(config?.envId && config?.region),
  functionNameSupported:
    !config?.functionName || ['moodsky', 'moodsky-web-admin'].includes(config.functionName),
  loginMethodSupported: passwordMode || !config?.loginMethod || config.loginMethod === 'oauth',
  identityMethodConfigured: passwordMode || config?.provider === 'wechat',
  callbackRequirementMet: passwordMode || httpsUrl(config?.redirectTo),
  sdkVersionPinned: sdkPinned && (!config || config.sdkVersion === '3.4.8'),
  bundleBuilt: fs.existsSync(path.join(root, 'admin/vendor/cloudbase-3.4.8.js')),
};
console.log(
  JSON.stringify(
    {
      mode: 'local_read_only_configuration_shape',
      sdk: '@cloudbase/js-sdk@3.4.8',
      checks,
      realOAuthVerified: false,
      trustedWebIdentityMappingVerified: false,
      operatorRoleVerified: false,
      realReadWriteVerified: false,
      remaining: [
        'Environment owner enables the chosen login method and approved domain; OAuth also needs a callback.',
        'Server verifies Web credentials and maps trusted subject to an active internal account.',
        'Authorized operator/ordinary/disabled/expired/forged-role cases require real platform tests.',
        'Keep maintenance flags off until configuration, service assembly and independent review are verified.',
      ],
    },
    null,
    2,
  ),
);
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 2;
