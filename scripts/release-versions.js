const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function assertReleaseVersions(root) {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const load = (name) => {
    const module = { exports: {} };
    vm.runInNewContext(read(name), { module, process: { env: {} }, require }, { filename: name });
    return module.exports;
  };
  const { APP_VERSION } = load('miniprogram/shared/constants.js');
  const config = load('cloudfunctions/moodsky/production/config.js');
  const versions = { APP_VERSION, RELEASE_VERSION: config.RELEASE_VERSION };
  for (const directory of ['', 'cloudfunctions/moodsky/']) {
    const pkg = directory + 'package.json';
    const lock = directory + 'package-lock.json';
    const metadata = JSON.parse(read(lock));
    versions[pkg] = JSON.parse(read(pkg)).version;
    versions[lock] = metadata.version;
    versions[lock + ' packages[""]'] = metadata.packages?.['']?.version;
  }
  if (
    typeof APP_VERSION !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(APP_VERSION) ||
    Object.values(versions).some((version) => version !== APP_VERSION)
  ) {
    throw new Error('MoodSky release versions differ: ' + JSON.stringify(versions));
  }
  return { APP_VERSION, ...config };
}

module.exports = { assertReleaseVersions };
