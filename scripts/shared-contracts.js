const fs = require('node:fs');
const path = require('node:path');

// Compare bytes, not require() results: the module cache can hide an old copy.
// This guard never repairs or overwrites source files during packaging.
function assertSharedContracts(root = path.resolve(__dirname, '..')) {
  const source = path.join(root, 'miniprogram/shared');
  const target = path.join(root, 'cloudfunctions/moodsky/shared');
  const names = (directory) =>
    fs.existsSync(directory)
      ? fs
          .readdirSync(directory)
          .filter((name) => /\.(js|d\.ts)$/.test(name))
          .sort()
      : [];
  const sourceNames = names(source);
  const targetNames = names(target);
  const mismatch = new Set([
    ...sourceNames.filter((name) => !targetNames.includes(name)),
    ...targetNames.filter((name) => !sourceNames.includes(name)),
  ]);
  for (const name of sourceNames) {
    if (
      targetNames.includes(name) &&
      !fs.readFileSync(path.join(source, name)).equals(fs.readFileSync(path.join(target, name)))
    ) {
      mismatch.add(name);
    }
  }
  if (!sourceNames.length || mismatch.size) {
    throw new Error(
      'Shared contracts are missing or stale (' +
        [...mismatch].join(', ') +
        '). Run npm run cloud:prepare, then retry the check or package command.',
    );
  }
  return sourceNames;
}
module.exports = { assertSharedContracts };
