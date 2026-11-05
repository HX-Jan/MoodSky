const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');

function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/modules/system/navigation.js');
  const local = createRequire(file);
  const state = createSessionState();
  const modals = [],
    navigations = [],
    notices = [];
  const source = { data: { hasUnsavedChanges: true } };
  let pages = [source];
  const platform = {
    showModal: (input) => modals.push(input),
    switchTab: (input) => navigations.push(input),
    showToast: (input) => notices.push(input.title),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module,
    require(id) {
      if (id === '../../services/session-state') {
        return { cloudSessionState: state };
      }
      return local(id);
    },
  });
  return {
    ...module.exports,
    source,
    platform,
    modals,
    navigations,
    notices,
    state,
    pages: () => pages,
    replacePage() {
      pages = [{ data: { hasUnsavedChanges: true } }];
    },
  };
}

test('home confirmation ignores repeated taps, cancel can reopen, and old complete cannot release a new dialog', () => {
  const f = fixture();
  f.goHome(f.platform, f.pages);
  f.goHome(f.platform, f.pages);
  assert.equal(f.modals.length, 1);
  f.modals[0].success({ confirm: false });
  f.goHome(f.platform, f.pages);
  assert.equal(f.modals.length, 2);
  f.modals[0].complete();
  f.goHome(f.platform, f.pages);
  assert.equal(f.modals.length, 2);
  f.modals[1].success({ confirm: true });
  f.modals[1].complete();
  f.goHome(f.platform, f.pages);
  assert.equal(f.navigations.length, 1);
});

test('home native dialog exceptions and failure are recoverable without abandoning the draft', () => {
  const f = fixture();
  f.platform.showModal = () => {
    throw Error('synthetic modal failure');
  };
  assert.doesNotThrow(() => f.goHome(f.platform, f.pages));
  assert.equal(f.notices.length, 1);
  f.platform.showModal = (input) => f.modals.push(input);
  f.goHome(f.platform, f.pages);
  f.modals[0].fail();
  f.goHome(f.platform, f.pages);
  assert.equal(f.modals.length, 2);
  assert.equal(f.notices.length, 2);
  assert.equal(f.source.data.hasUnsavedChanges, true);
  assert.equal(f.navigations.length, 0);
});

for (const boundary of ['page', 'account', 'hide']) {
  test(`home confirmation from an older ${boundary} cannot leave the current editor`, () => {
    const f = fixture();
    f.goHome(f.platform, f.pages);
    if (boundary === 'page') {
      f.replacePage();
    }
    if (boundary === 'account') {
      f.state.accept('scope_' + 'b'.repeat(64));
    }
    if (boundary === 'hide') {
      f.source._hidden = true;
    }
    f.modals[0].success({ confirm: true });
    assert.equal(f.navigations.length, 0);
    assert.equal(f.notices.length, 0);
    assert.equal(f.source.data.hasUnsavedChanges, true);
  });
}

test('cancelling home work on component hide invalidates old confirmation even after showing again', () => {
  const f = fixture();
  const cancel = f.goHome(f.platform, f.pages);
  cancel();
  f.goHome(f.platform, f.pages);
  f.modals[0].success({ confirm: true });
  f.modals[0].complete();
  assert.equal(f.navigations.length, 0);
  f.modals[1].success({ confirm: true });
  assert.equal(f.navigations.length, 1);
});

test('home navigation exceptions release the lock and preserve pending operation recheck', () => {
  const f = fixture();
  f.source.data.hasUnsavedChanges = false;
  f.platform.switchTab = () => {
    throw Error('synthetic switch failure');
  };
  assert.doesNotThrow(() => f.goHome(f.platform, f.pages));
  assert.equal(f.notices.length, 1);
  f.platform.switchTab = (input) => f.navigations.push(input);
  f.source.data.hasUnsavedChanges = true;
  f.goHome(f.platform, f.pages);
  f.source.data.pendingRetry = true;
  f.modals[0].success({ confirm: true });
  assert.equal(f.navigations.length, 0);
  assert.match(f.notices.at(-1), /重试/);
  assert.equal(f.source.data.pendingRetry, true);
});

for (const method of ['onUpdate', 'onDismiss']) {
  test(`status component ${method} ignores hidden and detached banners and works on return`, () => {
    const file = path.resolve(__dirname, '../miniprogram/components/app-status/index.js');
    let definition,
      calls = 0;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Component(value) {
        definition = value;
      },
      require() {
        return {
          appRuntime: {
            subscribe: () => () => {},
            applyUpdate: () => calls++,
            dismissRecovery: () => calls++,
          },
          currentPages: () => [],
        };
      },
    });
    const component = { ...definition.methods, setData() {} };
    definition.lifetimes.attached.call(component);
    component[method]();
    assert.equal(calls, 1);
    definition.pageLifetimes.hide.call(component);
    component[method]();
    assert.equal(calls, 1);
    definition.pageLifetimes.show.call(component);
    component[method]();
    assert.equal(calls, 2);
    definition.lifetimes.detached.call(component);
    component[method]();
    assert.equal(calls, 2);
  });
}

test('actual status component cancels its home confirmation on hide and detach', () => {
  const f = fixture();
  const file = path.resolve(__dirname, '../miniprogram/components/app-status/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Component(value) {
      definition = value;
    },
    wx: f.platform,
    require(id) {
      if (id.endsWith('/navigation')) {
        return { goHome: () => f.goHome(f.platform, f.pages) };
      }
      return { appRuntime: { trackPage: () => () => {} }, currentPages: f.pages };
    },
  });
  const component = { ...definition.methods, setData() {} };
  component.onHome();
  definition.pageLifetimes.hide.call(component);
  component.onHome();
  assert.equal(f.modals.length, 1);
  f.modals[0].success({ confirm: true });
  assert.equal(f.navigations.length, 0);
  definition.pageLifetimes.show.call(component);
  component.onHome();
  definition.lifetimes.detached.call(component);
  f.modals[1].success({ confirm: true });
  assert.equal(f.navigations.length, 0);
});
