const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkDocs, runCli } = require('../scripts/check-docs');

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

test('selected-document command checks new reports rather than silently falling back to maintained entries', () => {
  const root = workspace(),
    output = [];
  const reporter = { log: (line) => output.push(line), error: (line) => output.push(line) };
  const file = path.join(root, 'docs', 'new-report.md');
  fs.writeFileSync(file, '[Source](../README.md)');
  assert.equal(runCli(root, ['docs/new-report.md'], reporter), 0);
  assert.match(output.at(-1), /1 selected documents \/ 1 local links passed/);
  fs.writeFileSync(file, '[Lost](../missing-task-index.csv)');
  assert.equal(runCli(root, ['docs/new-report.md'], reporter), 1);
  assert.match(output.at(-1), /missing-target.*missing-task-index/);
});

test('selected-document command rejects unknown options, non-Markdown files and absolute paths', () => {
  const root = workspace();
  for (const input of [
    '--unknown',
    'private.json',
    path.join(root, 'README.md'),
    'C:\\private.md',
  ]) {
    const output = [];
    const reporter = { log: (line) => output.push(line), error: (line) => output.push(line) };
    assert.equal(runCli(root, [input], reporter), 2);
    assert.equal(output.length, 1);
    assert.match(output[0], /^Usage:/);
    assert.doesNotMatch(output[0], /private/);
  }
});

test('documentation source paths cannot read outside the repository before link validation', () => {
  const container = workspace();
  const root = path.join(container, 'repo');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(container, 'outside.md'), '[Private](SYNTHETIC_PRIVATE_SENTINEL.md)');
  const result = checkDocs(root, ['../outside.md']);
  assert.equal(result.localLinks, 0);
  assert.deepEqual(result.problems, [
    { file: '../outside.md', target: '../outside.md', reason: 'outside-repository' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_SENTINEL/);
});
