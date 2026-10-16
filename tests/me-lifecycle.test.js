const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load() {
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
  const reply = (index, id) => pending[index]({ ok: true, apiVersion: '1', requestId: id });
  return { page, reply };
}

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
