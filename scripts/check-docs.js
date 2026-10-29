const fs = require('node:fs');
const path = require('node:path');

// Maintained guidance only. Member reports and old evidence remain snapshots.
const ENTRY_DOCUMENTS = Object.freeze([
  'AGENTS.md',
  'README.md',
  'GETTING_STARTED.md',
  'CONTRIBUTING.md',
  'docs/README.md',
  'docs/development.md',
  'docs/architecture.md',
  'docs/api.md',
  'docs/team.md',
  'docs/collaboration/README.md',
  'docs/collaboration/submission-guide.md',
  'docs/collaboration/updates.md',
  'docs/troubleshooting/storage-tests.md',
  'docs/week1/README.md',
  'docs/week2/README.md',
  'docs/week3/README.md',
]);

function checkDocs(root, files = ENTRY_DOCUMENTS) {
  root = path.resolve(root);
  const problems = [];
  let links = 0;
  for (const file of files) {
    const source = path.resolve(root, file);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      problems.push({ file, target: file, reason: 'missing-document' });
      continue;
    }
    // The maintained entries use inline Markdown links. Ignore fenced examples
    // and remote/anchor-only URLs; this is not a full Markdown or web validator.
    const body = fs
      .readFileSync(source, 'utf8')
      .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, '');
    for (const match of body.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g)) {
      const value = match[1].trim();
      const target = value.startsWith('<') ? value.slice(1, -1) : value.replace(/\s+["'].*$/, '');
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) {
        continue;
      }
      const pathname = target.split(/[?#]/)[0];
      if (!pathname) {
        continue;
      }
      links++;
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch (_error) {
        problems.push({ file, target, reason: 'invalid-url-encoding' });
        continue;
      }
      const resolved = decoded.startsWith('/')
        ? path.resolve(root, '.' + decoded)
        : path.resolve(path.dirname(source), decoded);
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        problems.push({ file, target, reason: 'outside-repository' });
      } else if (!fs.existsSync(resolved)) {
        problems.push({ file, target, reason: 'missing-target' });
      }
    }
  }
  return { documents: files.length, localLinks: links, problems };
}

if (require.main === module) {
  const result = checkDocs(path.resolve(__dirname, '..'));
  if (result.problems.length) {
    for (const problem of result.problems) {
      console.error(problem.file + ': ' + problem.reason + ': ' + problem.target);
    }
    process.exitCode = 1;
  } else {
    console.log(
      result.documents + ' maintained documents / ' + result.localLinks + ' local links passed.',
    );
  }
}
module.exports = { checkDocs, ENTRY_DOCUMENTS };
