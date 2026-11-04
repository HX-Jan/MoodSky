const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(name, platform) {
  const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) {
      definition = value;
    },
    wx: platform,
    require: createRequire(file),
  });
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

for (const [name, method] of [
  ['login', 'onPrivacy'],
  ['me', 'onPrivacyContract'],
]) {
  test(`${name}: missing native privacy API explains how to recover without accepting consent`, () => {
    const notices = [];
    const page = load(name, { showToast: (input) => notices.push(input) });
    const before = JSON.stringify(page.data);
    page[method]();
    assert.equal(notices.length, 1);
    assert.match(notices[0].title, /更新微信/);
    assert.equal(notices[0].icon, 'none');
    assert.equal(JSON.stringify(page.data), before);
  });

  test(`${name}: native privacy exceptions and asynchronous failures leave the link retryable`, () => {
    const notices = [];
    let attempts = 0;
    let callbacks;
    const page = load(name, {
      showToast: (input) => notices.push(input.title),
      openPrivacyContract(input) {
        attempts++;
        if (attempts === 1) {
          throw Error('synthetic platform unavailable');
        }
        callbacks = input;
      },
    });
    const before = JSON.stringify(page.data);
    assert.doesNotThrow(() => page[method]());
    assert.equal(notices.length, 1);
    assert.match(notices[0], /暂时无法打开隐私指引/);
    page[method]();
    callbacks.fail({ errMsg: 'synthetic failure' });
    assert.equal(notices.length, 2);
    page[method]();
    assert.equal(attempts, 3);
    assert.equal(notices.length, 2); // A successful open does not add a failure notice.
    assert.equal(JSON.stringify(page.data), before); // Reading is not agreement or login.
  });
}
