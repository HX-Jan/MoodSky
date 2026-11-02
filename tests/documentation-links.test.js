const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkDocs } = require('../scripts/check-docs');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-docs-links-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', '合成 图.png'), 'synthetic fixture');
  fs.writeFileSync(path.join(root, 'README.md'), '# Home\n');
  return root;
}

test('documentation checks accept nested, encoded, root-relative and spaced image paths without reading remote URLs', () => {
  const root = workspace();
  fs.writeFileSync(
    path.join(root, 'docs', 'guide.md'),
    [
      '[Home](../README.md#home)',
      '[Root](/README.md)',
      '![Encoded](../assets/%E5%90%88%E6%88%90%20%E5%9B%BE.png)',
      '![Spaced](<../assets/合成 图.png>)',
      '[Web](https://example.invalid/missing)',
      '[Mail](mailto:synthetic@example.invalid)',
      '[Anchor](#deliberately-not-checked)',
      '```markdown',
      '[Example](does-not-exist.md)',
      '```',
      '~~~markdown',
      '[Example](also-does-not-exist.md)',
      '~~~',
    ].join('\n'),
  );
  assert.deepEqual(checkDocs(root, ['docs/guide.md']), {
    documents: 1,
    localLinks: 4,
    problems: [],
  });
});

test('documentation checks reject missing targets, path escapes, invalid encoding and missing maintained entries', () => {
  const root = workspace();
  fs.writeFileSync(
    path.join(root, 'docs', 'guide.md'),
    ['[Missing](gone.md)', '[Escape](../../outside.md)', '[Bad](%ZZ.md)'].join('\n'),
  );
  const report = checkDocs(root, ['docs/guide.md', 'docs/missing.md']);
  assert.equal(report.localLinks, 3);
  assert.deepEqual(
    report.problems.map((item) => item.reason),
    ['missing-target', 'outside-repository', 'invalid-url-encoding', 'missing-document'],
  );
});

test('all maintained repository entry points resolve their local file links', () => {
  const report = checkDocs(path.resolve(__dirname, '..'));
  assert.ok(report.documents >= 15);
  assert.ok(report.localLinks > 100);
  assert.deepEqual(report.problems, []);
});
