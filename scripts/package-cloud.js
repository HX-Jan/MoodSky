const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

require('./prepare-cloud');

const source = path.resolve(__dirname, '../cloudfunctions/moodsky');
// Bundle local modules into one entry to avoid missing subdirectories in uploads.
const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-cloud-'));
const target = path.join(stagingRoot, 'moodsky');
fs.mkdirSync(target);
esbuild.buildSync({
  entryPoints: [path.join(source, 'index.js')],
  outfile: path.join(target, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  external: ['wx-server-sdk'],
});
for (const name of ['package.json', 'package-lock.json']) {
  fs.copyFileSync(path.join(source, name), path.join(target, name));
}
console.log('Cloud function deployment directory: ' + target);
