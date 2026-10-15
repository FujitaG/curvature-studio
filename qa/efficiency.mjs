import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
function sourceModules(directory) {
  const cache = new Map();
  const load = (file) => {
    const path = resolve(directory, file.endsWith('.ts') ? file : `${file}.ts`);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('module', 'exports', 'require', code)(module, module.exports, id => {
      if (!id.startsWith('.')) throw new Error(`Unexpected dependency: ${id}`);
      return load(resolve(dirname(path), id));
    });
    cache.set(path, module.exports); return module.exports;
  };
  return load;
}
const current = sourceModules(root);
const baseline = process.env.QA_BASELINE_DIR ? sourceModules(resolve(process.env.QA_BASELINE_DIR)) : null;
const { buildSimpleGraph } = current('src/math/graph');
const templates = JSON.parse(readFileSync(resolve(root, 'src/data/templates.json'), 'utf8'));
const cube = templates.find(t => t.id === 'cube');
const copies = count => buildSimpleGraph(count * 8, Array.from({ length: count }, (_, index) => cube.edges.map(([a, b]) => [a + index * 8, b + index * 8])).flat());
const grid = (width, height) => {
  const edges = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id = y * width + x;
    if (x + 1 < width) edges.push([id, id + 1]);
    if (y + 1 < height) edges.push([id, id + width]);
  }
  return buildSimpleGraph(width * height, edges);
};
const measure = (fn, input) => { const start = performance.now(); const result = fn(input); return { ms: performance.now() - start, result }; };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = { node: process.version, method: 'Warm-up, then 5 alternating runs; medians. Computation only, no DOM/GPU. Each call uses a fresh component cache.', comparisons: [] };
for (const [name, source, method, input] of [
  ['Ollivier, 992-vertex grid', 'src/math/ollivier', 'computeOllivierCurvatures', grid(32, 31)],
  ['Effective, 32 cubes', 'src/math/effective', 'computeEffectiveCurvatures', copies(32)],
  ['Effective, 125 cubes', 'src/math/effective', 'computeEffectiveCurvatures', copies(125)]
]) {
  const next = current(source)[method], old = baseline?.(source)[method];
  for (let i = 0; i < 3; i++) { next(input); old?.(input); }
  const times = [], previous = [];
  for (let i = 0; i < 5; i++) {
    let a, b;
    if (i % 2) { b = old && measure(old, input); a = measure(next, input); }
    else { a = measure(next, input); b = old && measure(old, input); }
    times.push(a.ms);
    if (b) { previous.push(b.ms); assert.deepEqual(a.result, b.result); }
  }
  report.comparisons.push({ name, vertices: input.vertexCount, edges: input.edges.length, currentMs: median(times), ...(previous.length ? { baselineMs: median(previous), resultsExactlyEqual: true } : {}) });
}
const layoutInput = { vertices: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, x: 64 * Math.cos(i), y: 64 * Math.sin(i) })), edges: [], relaxAll: false };
const runLayout = load => input => { const runner = load('src/layout/relax3d').createRelaxation(input); runner.stepUntil(Infinity); return runner.result(); };
const nextLayout = runLayout(current), oldLayout = baseline && runLayout(baseline);
nextLayout(layoutInput); oldLayout?.(layoutInput);
const layoutTimes = [], previousLayout = [];
for (let i = 0; i < 3; i++) {
  const result = measure(nextLayout, layoutInput); layoutTimes.push(result.ms);
  assert(result.result.every(v => v.p3.every(Number.isFinite)));
  if (oldLayout) previousLayout.push(measure(oldLayout, layoutInput).ms);
}
report.layout = { vertices: 1000, currentMs: median(layoutTimes), ...(previousLayout.length ? { baselineMs: median(previousLayout) } : {}), positionsAreApproximate: true };
report.effectiveWorkBufferBytesAtLimits = (current('src/math/effective').EFFECTIVE_BATCH_SIZE + 1) * 1000 * 8;
const history = current('src/state/history');
const doc = { vertices: new Map(layoutInput.vertices.map(v => [v.id, v])), edges: new Map() };
const moved = history.forkDoc(doc); moved.vertices.set(1, { ...doc.vertices.get(1), x: 7 });
const patch = history.createDocPatch(doc, moved);
assert.deepEqual(history.applyDocPatch(moved, patch, 'before'), doc);
report.retainedChangesFor200SingleVertexMoves = 200 * (patch.vertices.length + patch.edges.length);
const artifacts = resolve(root, 'qa/artifacts/efficiency'); mkdirSync(artifacts, { recursive: true });
writeFileSync(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
