const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.join(__dirname, '../miniprogram');

function pageScripts(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? pageScripts(file) : entry.name.endsWith('.js') ? [file] : [];
  });
}

test('every page navigation target is registered in the Mini Program', () => {
  const app = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
  const registered = new Set(app.pages);
  const references = [];
  for (const file of pageScripts(path.join(miniRoot, 'pages'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](\/pages\/[A-Za-z0-9/_-]+)/g)) {
      references.push({ route: match[1].slice(1), file: path.relative(miniRoot, file) });
    }
  }
  assert.ok(references.length > 0, 'page navigation references must be discovered');
  const missing = references.filter(({ route }) => !registered.has(route));
  assert.deepEqual(missing, [], `unregistered navigation targets: ${JSON.stringify(missing)}`);
});
