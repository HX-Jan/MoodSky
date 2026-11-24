const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const REPO = { owner: 'HX-Jan', repo: 'MoodSky' };
function due(now, manual = false) {
  if (manual) return true;
  const day = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const anchor = new Date('2026-11-24T00:00:00Z');
  const days = Math.round((day - anchor) / 86400000);
  return days >= 0 && days % 2 === 0;
}
function allowed(file) {
  if (!file || file.includes('..') || file.includes('\\') || file.startsWith('/')) return false;
  return (
    /^(miniprogram\/(pages\/tasks|modules\/tasks)\/|tools\/alpha-qc\/|docs\/alpha\/qizhen-chen\/)/.test(
      file,
    ) ||
    /^(docs\/README\.md|docs\/collaboration\/updates\.md|tools\/week6-qc\/local-world\.cjs)$/.test(
      file,
    ) ||
    /^tests\/(alpha-qc[^/]*|week6-qc-task-flows|tasks-[^/]*)\.test\.js$/.test(file)
  );
}
function git(args, options = {}) {
  return cp
    .execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
    .trim();
}
function location(name) {
  if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required');
  return path.join(process.env.RUNNER_TEMP, name);
}
async function intake({ github, context, core }) {
  if (context.repo.owner !== REPO.owner || context.repo.repo !== REPO.repo)
    throw new Error('Repository mismatch');
  const issue = (await github.rest.issues.get({ ...REPO, issue_number: 206 })).data;
  const complete = issue.state === 'closed' && issue.state_reason === 'completed';
  const cancelled = issue.state === 'closed';
  const run = !cancelled && due(new Date(), context.eventName === 'workflow_dispatch');
  core.setOutput('run', String(run));
  core.setOutput('complete', String(complete));
  if (!run) {
    await core.summary
      .addRaw(complete ? 'Issue #206 已完成。' : '本次不是两天一次的执行日，或议题已关闭。')
      .write();
    return;
  }
  const main = (await github.rest.repos.getBranch({ ...REPO, branch: 'main' })).data.commit.sha;
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...REPO,
    state: 'open',
    per_page: 100,
  });
  const own = pulls.filter(
    (p) =>
      p.user.login === 'grrrced' &&
      /^test\(alpha-qc\)/.test(p.title) &&
      /#206\b/.test(p.body || ''),
  );
  if (own.length > 1)
    throw new Error('Multiple active QC work PRs; choose a continuation explicitly');
  const pull = own[0];
  if (pull && pull.head.repo.full_name !== 'HX-Jan/MoodSky')
    throw new Error('Unexpected QC source repository');
  const base = pull ? pull.head.sha : main;
  const branch = pull ? pull.head.ref : 'automation/qc-' + context.runId;
  const comments = {};
  for (const number of [198, 199, 203, 205, 206, 208]) {
    const rows = await github.paginate(github.rest.issues.listComments, {
      ...REPO,
      issue_number: number,
      per_page: 100,
    });
    comments[number] = rows.map((c) => ({
      author: c.user.login,
      date: c.updated_at,
      body: c.body,
      url: c.html_url,
    }));
  }
  const plan = {
    capturedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    main,
    base,
    branch,
    pr: pull ? pull.number : null,
    issue,
    comments,
    openPulls: pulls.map((p) => ({
      number: p.number,
      author: p.user.login,
      title: p.title,
      head: p.head.sha,
      url: p.html_url,
    })),
    prerequisites:
      'Review is separate from local passing tests; no GUI, cloud writes, or member sign-off is provided by this runner.',
  };
  fs.writeFileSync(location('qc-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  core.setOutput('main', main);
  core.setOutput('base', base);
  await core.summary
    .addRaw(
      '北京时间两天一次09:00；本轮目标在周期末17:00前形成可交审成果。\n基线 ' +
        base +
        '；主干 ' +
        main,
    )
    .write();
}
function stage() {
  const expected = fs.readFileSync(location('qc-execution-base'), 'utf8').trim();
  if (git(['rev-parse', 'HEAD']) !== expected) throw new Error('Agent changed Git history');
  const changed = git(['diff', '--name-only', 'HEAD', '-z']).split('\0').filter(Boolean);
  const added = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  for (const file of [...changed, ...added]) {
    if (!allowed(file)) throw new Error('Outside QC edit scope: ' + file);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw new Error('Symlink is not permitted: ' + file);
  }
  if (added.length) git(['add', '--intent-to-add', '--', ...added]);
}
function bundle() {
  stage();
  const plan = JSON.parse(fs.readFileSync(location('qc-plan.json'), 'utf8'));
  const names = git(['diff', '--name-only', 'HEAD', '-z']).split('\0').filter(Boolean);
  const patch = cp.execFileSync('git', ['diff', '--binary', '--full-index', 'HEAD'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (names.length) git(['add', '--', ...names]);
  const output = path.resolve('node_modules/.cache/moodsky-qc-cloud');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'changes.patch'), patch);
  fs.writeFileSync(
    path.join(output, 'publication.json'),
    JSON.stringify(
      {
        ...plan,
        files: names,
        testedTree: git(['write-tree']),
        patchSha256: crypto.createHash('sha256').update(patch).digest('hex'),
        validatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
}
async function publish({ github, context, core }) {
  if (context.repo.owner !== REPO.owner || context.repo.repo !== REPO.repo)
    throw new Error('Repository mismatch');
  const directory = location('qc-evidence');
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'publication.json'), 'utf8'));
  const patch = fs.readFileSync(path.join(directory, 'changes.patch'));
  if (crypto.createHash('sha256').update(patch).digest('hex') !== plan.patchSha256)
    throw new Error('Patch fingerprint mismatch');
  if (!plan.files.every(allowed)) throw new Error('Publication exceeds QC scope');
  if (!patch.length) {
    await core.summary.addRaw('检查完成，没有需要提交的QC变更。').write();
    return;
  }
  const currentMain = (await github.rest.repos.getBranch({ ...REPO, branch: 'main' })).data.commit
    .sha;
  if (currentMain !== plan.main)
    throw new Error('main changed during this run; regenerate and retest');
  if (plan.pr) {
    const pull = (await github.rest.pulls.get({ ...REPO, pull_number: plan.pr })).data;
    if (
      pull.state !== 'open' ||
      pull.user.login !== 'grrrced' ||
      pull.head.sha !== plan.base ||
      pull.head.ref !== plan.branch
    ) {
      throw new Error('QC PR changed during this run; preserve concurrent work');
    }
  }
  git(['config', 'user.name', 'MoodSky QC automation']);
  git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  git(['fetch', '--no-tags', 'origin', plan.base, plan.main]);
  git(['checkout', '--detach', plan.base]);
  git(['merge', '--no-edit', plan.main]);
  git(['apply', '--index', path.join(directory, 'changes.patch')]);
  const actual = git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
  if (!actual.every(allowed) || actual.length !== plan.files.length)
    throw new Error('Patch paths differ from validated manifest');
  git(['commit', '-m', 'test(alpha-qc): 云端接续周期验证与交付']);
  // The local merge tree must be the one validated by the work job.
  // Assemble the entire local commit tree using its diff from the original PR/main base.
  const publicationFiles = git(['diff', '--name-only', plan.base, 'HEAD', '-z'])
    .split('\0')
    .filter(Boolean);
  const baseTree = (await github.rest.git.getCommit({ ...REPO, commit_sha: plan.base })).data.tree
    .sha;
  const entries = [];
  for (const file of publicationFiles) {
    const mode = git(['ls-files', '--stage', '--', file]).split(' ')[0];
    if (!fs.existsSync(file)) {
      entries.push({ path: file, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    if (!['100644', '100755'].includes(mode) || fs.lstatSync(file).isSymbolicLink())
      throw new Error('Unsupported file mode: ' + file);
    const blob = await github.rest.git.createBlob({
      ...REPO,
      content: fs.readFileSync(file).toString('base64'),
      encoding: 'base64',
    });
    entries.push({ path: file, mode, type: 'blob', sha: blob.data.sha });
  }
  const resultTree = (
    await github.rest.git.createTree({ ...REPO, base_tree: baseTree, tree: entries })
  ).data.sha;
  const localTree = git(['rev-parse', 'HEAD^{tree}']);
  if (localTree !== plan.testedTree) throw new Error('Publication differs from tested tree');
  if (resultTree !== localTree)
    throw new Error('Remote publication tree does not match locally validated tree');
  const commit = (
    await github.rest.git.createCommit({
      ...REPO,
      message: 'test(alpha-qc): 云端接续周期验证与交付\n\nRefs #206',
      tree: resultTree,
      parents: plan.base === plan.main ? [plan.base] : [plan.base, plan.main],
    })
  ).data;
  if (plan.pr)
    await github.rest.git.updateRef({
      ...REPO,
      ref: 'heads/' + plan.branch,
      sha: commit.sha,
      force: false,
    });
  else
    await github.rest.git.createRef({ ...REPO, ref: 'refs/heads/' + plan.branch, sha: commit.sha });
  if (!plan.pr) {
    const report = fs.readFileSync(path.join(directory, 'agent-report.md'), 'utf8').slice(0, 24000);
    const pr = (
      await github.rest.pulls.create({
        ...REPO,
        title: 'test(alpha-qc): 云端周期验证与交付',
        head: plan.branch,
        base: 'main',
        body:
          'Refs #206\n\n' +
          report +
          '\n\n由云端工作流运行本地/合成检查；GUI、真机、部署和指定成员复核另记。工作流链接：https://github.com/HX-Jan/MoodSky/actions/runs/' +
          context.runId,
      })
    ).data;
    plan.pr = pr.number;
  }
  await core.summary
    .addRaw(
      '已提交可复核成果：https://github.com/HX-Jan/MoodSky/pull/' +
        plan.pr +
        '\n保持拥有者审批，不自动合并。',
    )
    .write();
}
module.exports = { due, allowed, intake, stage, bundle, publish };
if (require.main === module) {
  const action = process.argv[2];
  if (action === 'stage') stage();
  else if (action === 'bundle') bundle();
  else throw new Error('Use stage or bundle');
}
