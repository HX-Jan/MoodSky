const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function fixture(t, source = { data: { hasUnsavedChanges: true } }) {
  const file = path.resolve(__dirname, '../miniprogram/app.js'),
    local = createRequire(file);
  const previousPages = globalThis.getCurrentPages;
  globalThis.getCurrentPages = () => [source];
  const modals = [],
    navigations = [],
    notices = [];
  let app;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    App: (value) => {
      app = value;
    },
    wx: {
      showModal: (p) => modals.push(p),
      switchTab: (p) => navigations.push(p),
      showToast: (p) => notices.push(p.title),
    },
    require(id) {
      if (id === './config/environment.local') {
        return { cloudEnabled: false };
      }
      if (id === './modules/system/runtime') {
        return { appRuntime: { start() {}, refreshNetwork() {} } };
      }
      return local(id);
    },
  });
  t.after(() => {
    app.onHide?.();
    globalThis.getCurrentPages = previousPages;
  });
  return { app, source, modals, navigations, notices };
}
test('missing page recovery asks before dropping a draft, deduplicates the dialog and supports cancellation', (t) => {
  const f = fixture(t);
  f.app.onPageNotFound();
  f.app.onPageNotFound();
  assert.equal(f.modals.length, 1);
  assert.equal(f.navigations.length, 0);
  f.modals[0].success({ confirm: false });
  f.app.onPageNotFound();
  assert.equal(f.modals.length, 2);
  f.modals[1].success({ confirm: true });
  assert.equal(f.navigations.length, 1);
  assert.equal(f.navigations[0].url, '/pages/today/index');
});
test('missing page recovery blocks an unknown private operation even when the visible UI is no longer busy', (t) => {
  const f = fixture(t, {
    data: { busy: false },
    getWorkStatus: () => ({ draft: false, pending: true }),
  });
  f.app.onPageNotFound();
  assert.equal(f.modals.length, 0);
  assert.equal(f.navigations.length, 0);
  assert.deepEqual(f.notices, ['请先完成或重试当前操作']);
});
test('missing page draft confirmation rechecks a write started while the dialog was open', (t) => {
  const f = fixture(t);
  f.app.onPageNotFound();
  f.source.data.busy = true;
  f.modals[0].success({ confirm: true });
  assert.equal(f.navigations.length, 0);
  assert.deepEqual(f.notices, ['请先完成或重试当前操作']);
});
for (const event of ['onHide', 'onShow']) {
  test('missing page old confirmation cannot navigate after app ' + event, (t) => {
    const f = fixture(t);
    f.app.onPageNotFound();
    f.app[event]();
    f.modals[0].success({ confirm: true });
    assert.equal(f.navigations.length, 0);
    f.app.onPageNotFound();
    assert.equal(f.modals.length, 2);
  });
}
test('missing page clean recovery reports a failed home navigation and remains retryable', (t) => {
  const f = fixture(t, { data: {} });
  f.app.onPageNotFound();
  assert.equal(f.navigations.length, 1);
  f.navigations[0].fail();
  assert.deepEqual(f.notices, ['暂时无法返回首页，请稍后重试']);
  f.app.onPageNotFound();
  assert.equal(f.navigations.length, 2);
});
test('timeline single-page mode never redirects a missing page or revives an earlier confirmation', (t) => {
  const f = fixture(t);
  f.app.onPageNotFound();
  f.app.onShow({ scene: 1154 });
  f.modals[0].success({ confirm: true });
  f.app.onPageNotFound();
  assert.equal(f.navigations.length, 0);
  assert.equal(f.modals.length, 1);
});
