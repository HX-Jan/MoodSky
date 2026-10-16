/* Local contract checks. This does not execute or emulate the Figma editor. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { validateDesign, normalizeHex, colorParts } = require('./code.js');

assert.equal(normalizeHex('#fff'), '#FFFFFF');
assert.equal(normalizeHex('#25333a'), '#25333A');
assert.deepEqual(colorParts('#FF000080'), { r: 1, g: 0, b: 0, a: 128 / 255 });
assert.throws(() => normalizeHex('#12345'), /颜色长度/);
const fixture = {
  version: 1,
  pages: [
    {
      id: 'prototype',
      name: '原型',
      frames: [
        {
          id: 'today',
          type: 'frame',
          w: 390,
          h: 844,
          children: [{ id: 'save', type: 'instance', componentId: 'primary', w: 342, h: 48 }],
        },
      ],
    },
  ],
  components: [
    {
      id: 'primary',
      family: 'Button',
      node: {
        id: 'primary-source',
        type: 'frame',
        w: 342,
        h: 48,
        children: [
          { id: 'label-source', type: 'text', name: 'Label', w: 300, h: 24, text: '保存' },
        ],
      },
    },
  ],
};
assert.deepEqual(validateDesign(fixture), { nodes: 4, pages: 1, components: 1 });
const missing = JSON.parse(JSON.stringify(fixture));
missing.pages[0].frames[0].children[0].componentId = 'missing';
assert.throws(() => validateDesign(missing), /找不到实例的组件/);
const tooSmall = JSON.parse(JSON.stringify(fixture));
tooSmall.components[0].node.h = 40;
assert.throws(() => validateDesign(tooSmall), /至少 48/);
const repeated = JSON.parse(JSON.stringify(fixture));
repeated.components[0].node.children[0].id = 'today';
assert.throws(() => validateDesign(repeated), /重复/);

if (process.argv[2]) {
  const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  const report = validateDesign(source);
  console.log(JSON.stringify({ status: 'source-schema-valid', ...report }));
} else {
  console.log('Local importer contract checks passed. Figma execution was not performed.');
}
