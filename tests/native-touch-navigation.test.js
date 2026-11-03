const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSessionState } = require('../miniprogram/services/session-state');
function page(name, platform = {}, session = createSessionState()) {
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  const local = createRequire(file);
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => {
      definition = value;
    },
    wx: platform,
    require(id) {
      if (id.endsWith('/config/environment.local')) {
        return {};
      }
      if (id.endsWith('/services/session-state')) {
        return { cloudSessionState: session };
      }
      return local(id);
    },
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}
test('My ignores rapid taps across different destinations until returning, and retries failed navigation', () => {
  const calls = [],
    toasts = [];
  const p = page('me', {
    navigateTo: (input) => calls.push(input),
    showToast: (input) => toasts.push(input.title),
  });
  p.onProfileTap();
  p.onTasks();
  p.onProductionAccount();
  assert.equal(calls.length, 1);
  calls[0].fail();
  assert.equal(toasts.length, 1);
  p.onTasks();
  p.onTasks();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '/pages/tasks/index?view=history');
  p.onHide();
  p.onProfileTap();
  assert.equal(calls.length, 2);
  p.onShow();
  p.onProfileTap();
  assert.equal(calls.length, 3);
  calls[1].fail(); // A late failure cannot unlock or toast over the newer navigation.
  p.onTasks();
  assert.equal(calls.length, 3);
  assert.equal(toasts.length, 1);
});
for (const name of ['universe', 'review/archive', 'review/month']) {
  test(`${name} opens only one review destination per visit and reopens after returning`, () => {
    const calls = [];
    const p = page(name, { navigateTo: (input) => calls.push(input) });
    const open =
      name === 'universe'
        ? () => p.onOpenInsights()
        : name === 'review/archive'
          ? () => p.onMonthTap({ currentTarget: { dataset: { month: '2026-11' } } })
          : () =>
              p.onCardTap({ currentTarget: { dataset: { date: '2026-11-03', id: 'synthetic' } } });
    open();
    open();
    assert.equal(calls.length, 1);
    p.onHide();
    open();
    assert.equal(calls.length, 1);
    p.onShow();
    open();
    assert.equal(calls.length, 2);
    p.onUnload();
    open();
    assert.equal(calls.length, 2);
  });
}

for (const name of ['review/detail', 'record']) {
  test(`${name} dispatches only one back action until it returns to view`, async () => {
    const back = [];
    const p = page(name, { navigateBack: (input) => back.push(input) });
    p._seq = 0;
    p._journal = {
      confirmDelete: async () => true,
      getState: () => ({ loaded: true, entry: null }),
      refreshIfClean: async () => true,
      dispose() {},
    };
    const open = () => (name === 'record' ? p.onConfirmDelete() : p.onBack());
    await Promise.all([open(), open()]);
    assert.equal(back.length, 1);
    assert.equal(back[0].url, undefined);
    p.onHide();
    await open();
    assert.equal(back.length, 1);
    await p.onShow();
    await open();
    assert.equal(back.length, 2);
    p.onUnload();
    await open();
    assert.equal(back.length, 2);
  });
}

test('detail back missing history falls home once, and a failed fallback can be retried', () => {
  const back = [],
    home = [],
    notices = [];
  const p = page('review/detail', {
    navigateBack: (input) => back.push(input),
    switchTab: (input) => home.push(input),
    showToast: (input) => notices.push(input.title),
  });
  p.onBack();
  back[0].fail();
  back[0].fail(); // A repeated primary failure does not start another fallback.
  p.onBack();
  assert.equal(back.length, 1);
  assert.equal(home.length, 1);
  assert.equal(home[0].url, '/pages/today/index');
  home[0].fail();
  assert.equal(notices.length, 1);
  p.onBack();
  assert.equal(back.length, 2);
});

for (const failing of ['back', 'home']) {
  test(`detail ${failing} native exception leaves a usable back action`, () => {
    const back = [],
      home = [],
      notices = [];
    let broken = true;
    const p = page('review/detail', {
      navigateBack(input) {
        back.push(input);
        if (failing === 'back' && broken) {
          throw Error('synthetic back error');
        }
        input.fail();
      },
      switchTab(input) {
        home.push(input);
        if (failing === 'home' && broken) {
          throw Error('synthetic home error');
        }
      },
      showToast: (input) => notices.push(input.title),
    });
    assert.doesNotThrow(() => p.onBack());
    assert.equal(home.length, 1);
    if (failing === 'home') {
      assert.equal(notices.length, 1);
      broken = false;
      p.onBack();
      assert.equal(home.length, 2);
    } else {
      assert.equal(notices.length, 0);
    }
  });
}

test('old back and fallback failures cannot navigate or unlock a newer detail visit', () => {
  const back = [],
    home = [],
    notices = [];
  const p = page('review/detail', {
    navigateBack: (input) => back.push(input),
    switchTab: (input) => home.push(input),
    showToast: (input) => notices.push(input.title),
  });
  p._seq = 0;
  p.onBack();
  p.onHide();
  p.onShow();
  p.onBack();
  back[0].fail();
  assert.equal(home.length, 0);
  back[1].fail();
  assert.equal(home.length, 1);
  p.onHide();
  p.onShow();
  p.onBack();
  home[0].fail();
  p.onBack();
  assert.equal(back.length, 3);
  assert.equal(notices.length, 0);
});

test('static or redirected detail entry cannot dispatch native back actions', () => {
  const back = [];
  const p = page('review/detail', { navigateBack: (input) => back.push(input) });
  p.data.shareSinglePage = true;
  p.onBack();
  p.data.shareSinglePage = false;
  p._shareLoginRedirected = true;
  p.onBack();
  assert.equal(back.length, 0);
});
for (const boundary of ['hide', 'account', 'date']) {
  test(`Today ignores an old need-sheet selection after ${boundary} without changing the draft`, () => {
    const calls = [],
      menus = [],
      session = createSessionState();
    session.accept('scope_' + 'a'.repeat(64));
    const p = page(
      'today',
      { navigateTo: (input) => calls.push(input), showActionSheet: (input) => menus.push(input) },
      session,
    );
    let date = '2026-11-03';
    p._journal = { getState: () => ({ inputLocked: false, date }), dispose() {} };
    p.onNeeds();
    p.onNeeds();
    assert.equal(menus.length, 1);
    if (boundary === 'hide') {
      p.onHide();
    }
    if (boundary === 'account') {
      session.accept('scope_' + 'b'.repeat(64));
    }
    if (boundary === 'date') {
      date = '2026-11-02';
    }
    menus[0].success({ tapIndex: 1 });
    menus[0].complete();
    assert.equal(calls.length, 0);
    p.onUnload();
  });
}
test('custom tabs dispatch once while switching, retain selection on failure and recover', () => {
  const requests = [],
    toasts = [];
  let definition;
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, '../miniprogram/custom-tab-bar/index.js'), 'utf8'),
    {
      Component: (value) => {
        definition = value;
      },
      wx: {
        switchTab: (input) => requests.push(input),
        showToast: (input) => toasts.push(input.title),
      },
    },
  );
  const tab = {
    ...definition.methods,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
  const tap = (index) => tab.onSelect({ currentTarget: { dataset: { index } } });
  tap(2);
  tap(1);
  tap(2);
  assert.equal(requests.length, 1);
  assert.equal(tab.data.switching, true);
  requests[0].fail();
  requests[0].complete();
  assert.equal(tab.data.selected, 0);
  assert.equal(tab.data.switching, false);
  assert.equal(toasts.length, 1);
  tap(1);
  requests[1].success();
  requests[1].complete();
  assert.equal(tab.data.selected, 1);
  tap(3);
  definition.lifetimes.detached.call(tab);
  requests[2].success();
  requests[2].complete();
  assert.equal(tab.data.selected, 1);
});
