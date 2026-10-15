/** Test-only reference, with no imports from the production graph/math code.
 * P is row stochastic. H = I - 11^T/n, B = HP, and
 * S - B S B^T = H gives V(e) = S_uu + S_vv - 2 S_uv.
 * This dense linear solve has no time stepping or estimated-tail stopping rule.
 * It is a floating-point cross-check for SMALL connected graphs, not a certificate.
 */
export type Pair = [number, number];

export function connected(n: number, edges: Pair[]): boolean {
  const seen = new Set([0]);
  for (let pass = 0; pass < n; pass++) for (const [a, b] of edges) {
    if (seen.has(a)) seen.add(b);
    if (seen.has(b)) seen.add(a);
  }
  return seen.size === n;
}

function solve(matrix: number[][], rhs: number[]): number[] {
  const a = matrix.map((row, i) => [...row, rhs[i]]), n = a.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-13) throw new Error('Singular reference system');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let j = col + 1; j <= n; j++) a[row][j] -= factor * a[col][j];
      a[row][col] = 0;
    }
  }
  const x = Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let value = a[row][n];
    for (let j = row + 1; j < n; j++) value -= a[row][j] * x[j];
    x[row] = value / a[row][row];
  }
  const residual = Math.max(...matrix.map((row, i) => Math.abs(row.reduce((sum, c, j) => sum + c * x[j], 0) - rhs[i])));
  if (residual > 1e-11) throw new Error(`Reference residual too large: ${residual}`);
  return x;
}

export function referenceVariance(n: number, edges: Pair[]): number[] {
  if (n < 2 || n > 8 || !connected(n, edges)) throw new Error('Reference requires a connected graph with 2–8 vertices');
  const degree = Array<number>(n).fill(0);
  for (const [a, b] of edges) { degree[a]++; degree[b]++; }
  const p: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0.5 : 0));
  for (const [a, b] of edges) { p[a][b] = 0.5 / degree[a]; p[b][a] = 0.5 / degree[b]; }
  const columnMean = Array.from({ length: n }, (_, j) => p.reduce((sum, row) => sum + row[j], 0) / n);
  const b = p.map(row => row.map((value, j) => value - columnMean[j]));
  const matrix: number[][] = [], rhs: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const row: number[] = [];
    for (let k = 0; k < n; k++) for (let l = 0; l < n; l++) {
      row.push(Number(i === k && j === l) - b[i][k] * b[j][l]);
    }
    matrix.push(row); rhs.push(Number(i === j) - 1 / n);
  }
  const s = solve(matrix, rhs);
  return edges.map(([a, b]) => s[a * n + a] + s[b * n + b] - s[a * n + b] - s[b * n + a]);
}

/** Independent transport dual: enumerate integer 1-Lipschitz potentials, f(0)=0.
 * With integer graph distances an optimal potential can be integral (difference
 * constraints are integral). Small graphs only; no min-cost flow implementation.
 */
export function referenceOllivier(n: number, edges: Pair[]): number[] {
  if (n < 2 || n > 5 || !connected(n, edges)) throw new Error('Transport reference requires 2–5 connected vertices');
  const neighbors = Array.from({ length: n }, () => [] as number[]);
  for (const [a, b] of edges) { neighbors[a].push(b); neighbors[b].push(a); }
  const distances = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : Infinity));
  for (const [a, b] of edges) distances[a][b] = distances[b][a] = 1;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    distances[i][j] = Math.min(distances[i][j], distances[i][k] + distances[k][j]);
  }
  const f = Array<number>(n).fill(0), costs = edges.map(() => -Infinity);
  function visit(v: number) {
    if (v === n) {
      const expectations = neighbors.map((list, i) => 0.5 * f[i] + list.reduce((sum, j) => sum + f[j], 0) / (2 * list.length));
      edges.forEach(([a, b], i) => { costs[i] = Math.max(costs[i], expectations[a] - expectations[b]); });
      return;
    }
    for (let value = -distances[0][v]; value <= distances[0][v]; value++) {
      if (neighbors[v].some(u => u < v && Math.abs(value - f[u]) > 1)) continue;
      f[v] = value; visit(v + 1);
    }
  }
  visit(1);
  return costs.map(w1 => 1 - w1);
}
