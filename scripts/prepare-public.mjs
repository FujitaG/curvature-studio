// Prepare a new, review-only standalone tree; never publish, overwrite or deploy.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const source = dirname(dirname(fileURLToPath(import.meta.url)));
assert(process.argv.length === 3, 'Usage: npm run prepare:public -- /absolute/new/staging-directory');
const target = resolve(process.argv[2]);
assert(!existsSync(target), 'Destination already exists; choose a new directory');
assert(!target.startsWith(source + '/'), 'Destination must be outside the source tree');
const roots = ['src', 'qa', 'scripts', 'examples', 'public'];
const files = ['.gitignore', '.gitattributes', '.nvmrc', 'SECURITY.md', 'RELEASING.md', 'CHANGELOG.md', 'CITATION.cff', 'LICENSE', 'NOTICE', 'README.md', 'CONTRIBUTING.md', 'THIRD_PARTY.md',
  'FORMATS.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json',
  'tsconfig.node.json', 'vite.config.ts', 'wrangler.jsonc', 'docs/user-guide.md',
  'docs/reproducibility.md', 'docs/math-validation.md', 'docs/model-scope.md', 'docs/template-construction.md'];
const selected = [];
function collect(path) {
  if (path === 'qa/artifacts') return;
  assert(path !== 'scripts/vendor', 'Former coordinate tables must not be staged');
  const full = join(source, path), stat = lstatSync(full);
  assert(!stat.isSymbolicLink(), `Refusing symbolic link: ${path}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(full).sort()) collect(`${path}/${name}`);
  } else {
    assert(stat.isFile(), `Not a regular file: ${path}`);
    assert(!/(^|\/)(?:\.env.*|\.dev.vars.*|node_modules|\.git|\.wrangler)(\/|$)/.test(path), `Private/build path: ${path}`);
    selected.push(path);
  }
}
for (const path of [...files, ...roots]) collect(path);
const workflowRoot = existsSync(join(source, '.github/workflows/curvature-studio.yml')) ? source : dirname(source);
let workflow = readFileSync(join(workflowRoot, '.github/workflows/curvature-studio.yml'), 'utf8');
// The private parent repository nests the app; the public repository is its root.
workflow = workflow.replaceAll("    paths: ['curvature-studio/**', '.github/workflows/curvature-studio.yml']\n", '')
  .replace('working-directory: curvature-studio', 'working-directory: .')
  .replace('cache-dependency-path: curvature-studio/package-lock.json', 'cache-dependency-path: package-lock.json');
const dependabot = readFileSync(join(workflowRoot, '.github/dependabot.yml'), 'utf8').replace('directory: /curvature-studio', 'directory: /');
assert(!workflow.includes('curvature-studio/'), 'Unadapted nested workflow path');
const content = new Map(selected.sort().map(path => [path, readFileSync(join(source, path))]));
content.set('.github/workflows/curvature-studio.yml', Buffer.from(workflow));
content.set('.github/dependabot.yml', Buffer.from(dependabot));
// Fail before writing if curated Markdown has dangling local links.
for (const [path, bytes] of content) {
  if (!path.endsWith('.md')) continue;
  for (const match of bytes.toString().matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].split('#')[0];
    if (!link || /^[a-z]+:/i.test(link)) continue;
    const destination = relative(source, resolve(source, dirname(path), link));
    assert(content.has(destination), `${path}: local link not included: ${link}`);
  }
}
mkdirSync(target, { recursive: true });
for (const [path, bytes] of content) {
  mkdirSync(dirname(join(target, path)), { recursive: true }); writeFileSync(join(target, path), bytes);
}
const manifest = Object.fromEntries([...content].sort(([a], [b]) => a.localeCompare(b))
  .map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]));
writeFileSync(join(target, 'SOURCE_MANIFEST.json'), JSON.stringify({
  purpose: 'Standalone source inventory; excludes this manifest and generated files',
  publicationDecisions: ['Review release evidence and repository setup: see RELEASING.md'],
  files: manifest
}, null, 2) + '\n');
console.log(`Prepared ${content.size} files at ${target}. Review THIRD_PARTY.md and RELEASING.md before publication.`);
