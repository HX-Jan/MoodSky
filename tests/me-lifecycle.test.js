const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(environment) {
  const filename = path.resolve(__dirname, '../miniprogram/pages/me/index.js');
  const localRequire = createRequire(filename);
  const values = new Map();
  const pending = [];
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) {
      definition = value;
    },
    setTimeout,
    clearTimeout,
    wx: {
      getStorageSync: (key) => values.get(key),
      setStorageSync: (key, value) => values.set(key, value),
      removeStorageSync: (key) => values.delete(key),
    },
    require(id) {
      if (environment && id.endsWith('/config/environment.local')) {
        return environment;
      }
      return id.endsWith('/system/health')
        ? { checkHealth: () => new Promise((resolve) => pending.push(resolve)) }
        : localRequire(id);
    },
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    updates: 0,
    setData(value) {
      Object.assign(this.data, value);
      this.updates++;
    },
  };
  page.onLoad();
  const reply = (index, id, fields = {}) =>
    pending[index]({ ok: true, apiVersion: '1', requestId: id, ...fields });
  return { page, reply };
}

test('the production version panel distinguishes builds of the same version and ignores hidden replies', async () => {
  const buildCommit = 'a'.repeat(40);
  const { page, reply } = load({ releaseProfile: 'production', buildCommit });
  page.onCheckUpdate();
  assert.equal(page.data.activeSection, 'version');
  const check = page.runHealth();
  reply(0, 'synthetic_old_cloud', {
    version: page.data.version,
    buildCommit: 'b'.repeat(40),
    configured: true,
  });
  await check;
  assert.equal(page.data.healthVersion, page.data.version);
  assert.equal(page.data.healthBuild, 'bbbbbbb');
  assert.match(page.data.healthText, /版本不同/);
  const newerCheck = page.runHealth();
  page.onHide();
  const updates = page.updates;
  reply(1, 'synthetic_hidden', { version: page.data.version, buildCommit, configured: true });
  await newerCheck;
  assert.equal(page.updates, updates);
  page.onUnload();
});

test('Me ignores a health result after the page was disposed', async () => {
  const { page, reply } = load();
  const check = page.runHealth();
  page.onUnload();
  const updates = page.updates;
  reply(0, 'synthetic_old_page');
  await check;
  assert.equal(page.updates, updates);
});

test('Me does not carry health results across account switches or newer checks', async () => {
  const { page, reply } = load();
  const first = page.runHealth();
  page.switchAccount({ currentTarget: { dataset: { id: 'demo-b' } } });
  const second = page.runHealth();
  reply(1, 'synthetic_new_account');
  await second;
  reply(0, 'synthetic_old_account');
  await first;
  assert.equal(page.data.healthRequestId, 'synthetic_new_account');
  const older = page.runHealth();
  const latest = page.runHealth();
  reply(3, 'synthetic_latest');
  await latest;
  reply(2, 'synthetic_older');
  await older;
  assert.equal(page.data.healthRequestId, 'synthetic_latest');
});
