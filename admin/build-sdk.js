const { buildSync } = require('../node_modules/esbuild');
buildSync({
  stdin: {
    contents: "import cloudbase from '@cloudbase/js-sdk'; globalThis.cloudbase = cloudbase;",
    resolveDir: __dirname,
  },
  bundle: true,
  platform: 'browser',
  outfile: __dirname + '/vendor/cloudbase-3.4.8.js',
});
