const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('custom navigation ignores invalid targets and changes selection only after success', () => {
  let definition;
  const requests = [];
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../miniprogram/custom-tab-bar/index.js'), 'utf8'),
    {
      Component(value) {
        definition = value;
      },
      wx: {
        switchTab(options) {
          requests.push(options);
        },
      },
    },
  );
  const tab = {
    ...definition.methods,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  for (const index of [0, -1, 9, 'invalid']) {
    tab.onSelect({ currentTarget: { dataset: { index } } });
  }
  assert.equal(requests.length, 0);
  tab.onSelect({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(requests[0].url, '/pages/universe/index');
  assert.equal(tab.data.selected, 0);
  requests[0].success();
  assert.equal(tab.data.selected, 2);
});
