const assert = require('node:assert/strict');
const test = require('node:test');
const { due, allowed } = require('./control.cjs');
test('Two-day cadence remains anchored across month and year boundaries', () => {
  for (const date of [
    '2026-11-24',
    '2026-11-26',
    '2026-11-28',
    '2026-11-30',
    '2026-12-02',
    '2027-01-01',
  ]) {
    assert.equal(due(new Date(date + 'T01:00:00Z')), true, date);
  }
  for (const date of ['2026-11-22', '2026-11-25', '2026-11-27', '2026-12-01', '2027-01-02']) {
    assert.equal(due(new Date(date + 'T01:00:00Z')), false, date);
  }
  assert.equal(due(new Date('2026-11-25T07:00:00Z'), true), true);
});
test('Publication stays within QC files and rejects credentials/control edits', () => {
  for (const file of [
    'miniprogram/pages/tasks/index.js',
    'miniprogram/modules/tasks/cloud.js',
    'tools/alpha-qc/verify.cjs',
    'docs/alpha/qizhen-chen/c3/progress.md',
    'tests/week6-qc-task-flows.test.js',
  ])
    assert.equal(allowed(file), true, file);
  for (const file of [
    '.github/workflows/qc-cloud.yml',
    'AGENTS.md',
    'package.json',
    'miniprogram/config/environment.local.js',
    'docs/alpha/yuen-lin/progress.md',
    '../secrets',
    '/tmp/test',
    'tools/alpha-qc/../../secrets',
    'tools\\alpha-qc\\x',
  ])
    assert.equal(allowed(file), false, file);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { intake, stage, bundle, publish } = require('./control.cjs');
function coreStub() {
  const output = {};
  const summary = {
    addRaw() {
      return summary;
    },
    async write() {},
  };
  return {
    output,
    setOutput(key, value) {
      output[key] = value;
    },
    summary,
  };
}
test('Current QC PR and all dependency comments are captured without inferring acceptance', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-intake-'));
  const old = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = dir;
  const core = coreStub();
  const pull = {
    number: 246,
    title: 'test(alpha-qc): current work',
    body: 'Refs #206',
    user: { login: 'grrrced' },
    head: { sha: 'a'.repeat(40), ref: 'test/qc', repo: { full_name: 'HX-Jan/MoodSky' } },
  };
  const github = {
    rest: {
      issues: {
        async get() {
          return { data: { state: 'open' } };
        },
        listComments: 'comments',
      },
      repos: {
        async getBranch() {
          return { data: { commit: { sha: 'b'.repeat(40) } } };
        },
      },
      pulls: { list: 'pulls' },
    },
    async paginate(method, options) {
      return method === 'pulls'
        ? [pull]
        : [
            {
              user: { login: 'reviewer' },
              updated_at: 'now',
              body: 'pending review',
              html_url: String(options.issue_number),
            },
          ];
    },
  };
  try {
    await intake({
      github,
      context: {
        repo: { owner: 'HX-Jan', repo: 'MoodSky' },
        runId: 1,
        eventName: 'workflow_dispatch',
      },
      core,
    });
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'qc-plan.json')));
    assert.equal(plan.pr, 246);
    assert.equal(plan.base, 'a'.repeat(40));
    assert.deepEqual(Object.keys(plan.comments), ['198', '199', '203', '205', '206', '208']);
    assert.equal(core.output.run, 'true');
    assert.equal(core.output.complete, 'false');
    pull.user.login = 'HX-Jan';
    pull.head.ref = 'automation/qc-123';
    pull.body = 'Refs #206\n<!-- moodsky-qc-cloud -->';
    await intake({
      github,
      context: {
        repo: { owner: 'HX-Jan', repo: 'MoodSky' },
        runId: 2,
        eventName: 'workflow_dispatch',
      },
      core,
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'qc-plan.json'))).pr, 246);
  } finally {
    if (old === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('Completed issue skips AI and marks the workflow for shutdown', async () => {
  const core = coreStub();
  const github = {
    rest: {
      issues: {
        async get() {
          return { data: { state: 'closed', state_reason: 'completed' } };
        },
      },
    },
  };
  await intake({
    github,
    context: { repo: { owner: 'HX-Jan', repo: 'MoodSky' }, eventName: 'workflow_dispatch' },
    core,
  });
  assert.equal(core.output.run, 'false');
  assert.equal(core.output.complete, 'true');
});
test('A branch changed by a person during the run is protected from publication', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-race-'));
  const old = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = dir;
  const evidence = path.join(dir, 'qc-evidence');
  fs.mkdirSync(evidence);
  const patch = Buffer.from('nonempty patch');
  fs.writeFileSync(path.join(evidence, 'changes.patch'), patch);
  fs.writeFileSync(
    path.join(evidence, 'publication.json'),
    JSON.stringify({
      main: 'b'.repeat(40),
      base: 'a'.repeat(40),
      pr: 246,
      branch: 'test/qc',
      files: ['docs/alpha/qizhen-chen/progress.md'],
      patchSha256: crypto.createHash('sha256').update(patch).digest('hex'),
    }),
  );
  const github = {
    rest: {
      repos: {
        async getBranch() {
          return { data: { commit: { sha: 'b'.repeat(40) } } };
        },
      },
      pulls: {
        async get() {
          return {
            data: {
              state: 'open',
              user: { login: 'grrrced' },
              head: { sha: 'c'.repeat(40), ref: 'test/qc' },
            },
          };
        },
      },
    },
  };
  try {
    await assert.rejects(
      publish({
        github,
        context: { repo: { owner: 'HX-Jan', repo: 'MoodSky' } },
        core: coreStub(),
      }),
      /preserve concurrent work/,
    );
  } finally {
    if (old === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('Evidence bundle includes new QC files and refuses an out-of-scope edit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-bundle-'));
  const repo = path.join(dir, 'repo'),
    temp = path.join(dir, 'temp');
  fs.mkdirSync(repo);
  fs.mkdirSync(temp);
  const oldCwd = process.cwd(),
    oldTemp = process.env.RUNNER_TEMP;
  function git(...args) {
    return cp
      .execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .trim();
  }
  try {
    git('init');
    git('config', 'user.name', 'QC Test');
    git('config', 'user.email', 'qc@example.invalid');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'original\n');
    git('add', '.');
    git('commit', '-m', 'baseline');
    fs.writeFileSync(path.join(temp, 'qc-execution-base'), git('rev-parse', 'HEAD'));
    fs.writeFileSync(path.join(temp, 'qc-plan.json'), '{}');
    process.chdir(repo);
    process.env.RUNNER_TEMP = temp;
    fs.mkdirSync('docs/alpha/qizhen-chen', { recursive: true });
    fs.writeFileSync('docs/alpha/qizhen-chen/progress.md', 'actual result\n');
    bundle();
    const out = 'node_modules/.cache/moodsky-qc-cloud';
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'publication.json')));
    assert.deepEqual(manifest.files, ['docs/alpha/qizhen-chen/progress.md']);
    assert.equal(manifest.testedTree, git('write-tree'));
    assert.match(fs.readFileSync(path.join(out, 'changes.patch'), 'utf8'), /actual result/);
    fs.writeFileSync('AGENTS.md', 'changed outside QC\n');
    assert.throws(stage, /Outside QC edit scope/);
  } finally {
    process.chdir(oldCwd);
    if (oldTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = oldTemp;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
