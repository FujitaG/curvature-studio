// Deliberately corrupt TEMPORARY source copies to check regression-test sensitivity.
// No edits to the working source. No package installation or network access.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), 'curvature-math-sensitivity-'));
const mutations = [
  ['column-instead-of-row', 'src/math/effective.ts', 'const degree = graph.degree[w];', 'const degree = graph.degree[u];'],
  ['missing-fresh-noise', 'src/math/effective.ts', 'totals.fill(2);', 'totals.fill(0);'],
  ['wrong-holding-probability', 'src/math/effective.ts', 'let value = 0.5 * v[u];', 'let value = 0.25 * v[u];'],
  ['all-bonds-get-first-value', 'src/math/quotient.ts', 'bondMap.set(edge.id, index);', 'bondMap.set(edge.id, 0);']
];
try {
  for (const name of ['src', 'qa/fixtures', 'package.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.node.json']) {
    cpSync(join(root, name), join(temp, name), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  function run() {
    const result = spawnSync(process.execPath, [join(temp, 'node_modules/vitest/vitest.mjs'), 'run',
      'src/math/__tests__/paper-contract.test.ts', '--reporter=json', '--outputFile=report.json'],
    { cwd: temp, encoding: 'utf8', timeout: 60000 });
    assert(!result.error, String(result.error));
    const report = JSON.parse(readFileSync(join(temp, 'report.json'), 'utf8'));
    // A syntax/startup failure must NOT count as successful mutation detection.
    assert(report.numTotalTests >= 5 && report.numPendingTests === 0, 'All contract tests must execute');
    return { status: result.status, report };
  }
  assert.equal(run().status, 0, 'Unmodified baseline must pass');
  const summary = [];
  for (const [name, file, from, to] of mutations) {
    const path = join(temp, file), original = readFileSync(path, 'utf8');
    assert.equal(original.split(from).length, 2, `${name}: mutation target must be unique`);
    writeFileSync(path, original.replace(from, to));
    rmSync(join(temp, 'report.json'));
    try {
      const { status, report } = run();
      const failed = report.testResults.flatMap(r => r.assertionResults)
        .filter(t => t.status === 'failed' && t.failureMessages.some(m => /AssertionError/.test(m)))
        .map(t => t.title);
      assert.notEqual(status, 0, `${name}: mutation survived`);
      assert(failed.includes('anchors the independent covariance solve and production results to paper values'),
        `${name}: expected a numerical anchor assertion failure, not a tooling error`);
      summary.push({ mutation: name, detectedBy: failed });
    } finally { writeFileSync(path, original); }
  }
  console.log(JSON.stringify({ baseline: 'passed', mutations: summary }, null, 2));
} finally { rmSync(temp, { recursive: true, force: true }); }
