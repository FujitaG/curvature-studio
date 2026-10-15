import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve(process.argv[2] ?? 'dist');
let checked = 0;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name), name = relative(root, path);
    if (entry.isSymbolicLink()) throw new Error(`Public asset is a symbolic link: ${name}`);
    if (entry.isDirectory()) { await check(path); continue; }
    if (/\.map$/i.test(name)) throw new Error(`Source map must not be deployed: ${name}`);
    if (/\.(js|mjs|css)$/i.test(name)) {
      const body = await readFile(path, 'utf8');
      if (/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/.test(body)) throw new Error(`Source map reference must not be deployed: ${name}`);
    }
    checked++;
  }
}
await check(root);
if (!checked) throw new Error('Public asset directory is empty');
console.log(`Public asset guard passed: ${checked} files; no source maps or sourceMappingURL directives`);
