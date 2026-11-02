const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { assertSharedContracts } = require('./shared-contracts');
const root = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const config = readJson('project.config.json');
assert.equal(config.projectname, 'MoodSky');
assert.equal(config.miniprogramRoot, 'miniprogram/');
assert.equal(config.cloudfunctionRoot, 'cloudfunctions/');
const app = readJson('miniprogram/app.json');
assert.equal(app.tabBar.list.length, 4);
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(
      fs.existsSync(path.join(root, 'miniprogram', page + '.' + extension)),
      page + '.' + extension,
    );
  }
  readJson('miniprogram/' + page + '.json');
}
for (const tab of app.tabBar.list) {
  assert.ok(app.pages.includes(tab.pagePath));
}
for (const component of Object.values(app.usingComponents)) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.join(root, 'miniprogram', component + '.' + extension)));
  }
}
assertSharedContracts(root);
const { ACTIONS } = require('../miniprogram/shared/contracts');
const covered = new Set(Object.values(ACTIONS).flatMap((item) => item.requirements));
assert.equal(covered.size, 24);
for (let id = 1; id <= 24; id += 1) {
  assert.ok(covered.has('UW3-F' + String(id).padStart(2, '0')));
}
const collections = readJson('database/collections.json').collections;
assert.equal(new Set(collections.map((item) => item.name)).size, collections.length);
const policy = readJson('database/client-access-policy.json').defaultClientRule;
assert.deepEqual(policy, { read: false, write: false });
console.log('Structure, 24 requirement IDs, shared contract copy and client access policy passed.');
