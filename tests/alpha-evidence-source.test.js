const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readGitHead } = require('../tools/alpha-xy/c1-request-log.cjs');

test('evidence source resolves shared loose and packed refs in a linked worktree', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const common = path.join(root, 'common');
  const meta = path.join(common, 'worktrees', 'review');
  const checkout = path.join(root, 'checkout');
  fs.mkdirSync(meta, { recursive: true });
  fs.mkdirSync(checkout);
  fs.mkdirSync(path.join(common, 'refs', 'heads'), { recursive: true });
  const revision = 'a'.repeat(40);
  fs.writeFileSync(path.join(checkout, '.git'), 'gitdir: ../common/worktrees/review\n');
  fs.writeFileSync(path.join(meta, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(meta, 'HEAD'), 'ref: refs/heads/review\n');
  const ref = path.join(common, 'refs', 'heads', 'review');
  fs.writeFileSync(ref, revision + '\n');
  assert.equal(readGitHead(checkout), revision);
  fs.rmSync(ref);
  fs.writeFileSync(path.join(common, 'packed-refs'), revision + ' refs/heads/review\n');
  assert.equal(readGitHead(checkout), revision);
  fs.writeFileSync(path.join(meta, 'HEAD'), 'b'.repeat(40) + '\n');
  assert.equal(readGitHead(checkout), 'b'.repeat(40));
});

test('regenerated service evidence records its actual time rather than a historical run date', (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'moodsky-evidence-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  for (const file of ['task-mode-samples.json', 'account-boundaries.json']) {
    fs.copyFileSync(
      path.join(__dirname, '../docs/week6/jiawei-fang', file),
      path.join(output, file),
    );
  }
  const start = Date.now();
  execFileSync(process.execPath, [path.join(__dirname, '../tools/week6-jf/export-c3.cjs'), output]);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'final-service-samples.json')));
  const stamp = Date.parse(report.generatedAt);
  assert(stamp >= start && stamp <= Date.now());
  assert.match(report.docsHead, /^[a-f0-9]{40}$/);
  assert.equal(report.realCloud, false);
});
