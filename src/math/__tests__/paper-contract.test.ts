import { expect, it } from 'vitest';
import { buildSimpleGraph, computeMetrics, computeEffectiveCurvatures, computeOllivierForEdge } from '..';
import { connected, referenceOllivier, referenceVariance, type Pair } from './reference';
import cases from '../../../qa/fixtures/paper-values.json';

const curvature = (variance: number) => 1 - Math.sqrt(Math.max(0, 1 - 2 / variance));
const close = (actual: number, expected: number, context: string, tolerance = 1e-9) => {
  expect(Number.isFinite(actual), context).toBe(true);
  expect(Math.abs(actual - expected), `${context}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
};

it('anchors the independent covariance solve and production results to paper values', () => {
  for (const fixture of cases) {
    const vertices = Array.from({ length: fixture.vertexCount }, (_, i) => ({ id: 101 + 7 * i }));
    expect(fixture.edges.every(edge => edge.weight === 1)).toBe(true);
    const edges = fixture.edges.map(edge => ({ ...edge, weight: edge.weight as 1, kind: edge.kind as 'bond' | 'brace' }));
    const result = computeMetrics(vertices, edges);
    // The braced K4 has a manually specified C3 quotient. Do not use the
    // production quotient builder to construct the oracle's reference graph.
    const pairs: Pair[] = fixture.name === 'Braced K4' ? [[0, 1], [0, 2], [1, 2]] :
      edges.map(e => [(e.a - 101) / 7, (e.b - 101) / 7]);
    const reference = referenceVariance(fixture.name === 'Braced K4' ? 3 : fixture.vertexCount, pairs);
    if (fixture.name !== 'Braced K4') edges.forEach((edge, i) => {
      const value = result.values[result.bondMap.get(edge.id) as number];
      close(value.vInf, reference[i], `${fixture.name} e${edge.id} covariance`);
      close(value.kEff, curvature(reference[i]), `${fixture.name} e${edge.id} effective`);
    });
    for (const check of fixture.checks) {
      const expectedV = check.variance[0] / check.variance[1];
      const index = fixture.name === 'Braced K4' ? 0 : edges.findIndex(e => e.id === check.id);
      close(reference[index], expectedV, `${fixture.name} reference`, 1e-11);
      const mapped = result.bondMap.get(check.id);
      expect(typeof mapped).toBe('number');
      const value = result.values[mapped as number];
      close(value.vInf, expectedV, `${fixture.name} V`);
      close(value.kEff, curvature(expectedV), `${fixture.name} effective`);
      expect(value.ollivierFrac).toEqual(check.ollivier);
      expect(value.converged).toBe(true);
    }
  }
});

it('matches independent covariance and transport duals on all 771 connected labelled graphs of order 2–5', () => {
  let graphs = 0, edgeCount = 0, maxVarianceError = 0, maxCurvatureError = 0, maxOllivierError = 0;
  for (let n = 2; n <= 5; n++) {
    const possible: Pair[] = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) possible.push([a, b]);
    let count = 0;
    const classes = new Set<number>();
    const permutations = (xs: number[]): number[][] => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => j !== i)).map(t => [x, ...t])) : [[]];
    const relabelings = permutations(Array.from({ length: n }, (_, i) => i));
    for (let mask = 1; mask < 2 ** possible.length; mask++) {
      const edges = possible.filter((_, i) => (mask & (1 << i)) !== 0);
      if (!connected(n, edges)) continue;
      graphs++; count++; edgeCount += edges.length;
      // Count topology classes separately from labelled inputs. A sorted degree
      // sequence is NOT an isomorphism test; minimize over all permutations.
      const adjacency = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
      for (const [a, b] of edges) adjacency[a][b] = adjacency[b][a] = true;
      classes.add(Math.min(...relabelings.map(p => possible.reduce((code, [a, b], i) =>
        code + (adjacency[p[a]][p[b]] ? 2 ** i : 0), 0))));
      const variance = referenceVariance(n, edges), ollivier = referenceOllivier(n, edges);
      // Deliberately use nonsequential vertex/edge IDs and reverse input order.
      const ids = Array.from({ length: n }, (_, i) => 101 + 7 * (n - i));
      const result = computeMetrics(ids.map(id => ({ id })).reverse(), edges.map(([a, b], i) =>
        ({ id: 1001 + 3 * i, a: ids[b], b: ids[a], kind: 'bond' as const })).reverse());
      edges.forEach((_, i) => {
        const value = result.values[result.bondMap.get(1001 + 3 * i) as number];
        const context = `n=${n} mask=${mask} edge=${i}`;
        close(value.vInf, variance[i], `${context} V`);
        close(value.kEff, curvature(variance[i]), `${context} effective`);
        close(value.ollivier, ollivier[i], `${context} Ollivier`, 1e-12);
        close(value.ollivierFrac[0] / value.ollivierFrac[1], ollivier[i], `${context} fraction`, 1e-12);
        expect(value.converged, context).toBe(true);
        if (n > 2) expect(value.vInf, `${context} nontrivial noise floor`).toBeGreaterThanOrEqual(2 + 1 / 16);
        const [wn, wd] = value.w1Frac, [on, od] = value.ollivierFrac;
        expect(wn * od + on * wd, `${context} rational W1 + curvature`).toBe(wd * od);
        expect(wn / wd, `${context} nonnegative transport`).toBeGreaterThanOrEqual(0);
        expect(wn / wd, `${context} local-support distance bound`).toBeLessThanOrEqual(3);
        maxVarianceError = Math.max(maxVarianceError, Math.abs(value.vInf - variance[i]));
        maxCurvatureError = Math.max(maxCurvatureError, Math.abs(value.kEff - curvature(variance[i])));
        maxOllivierError = Math.max(maxOllivierError, Math.abs(value.ollivier - ollivier[i]));
      });
    }
    expect(count).toBe([0, 0, 1, 4, 38, 728][n]);
    expect(classes.size).toBe([0, 0, 1, 2, 6, 21][n]);
  }
  expect(graphs).toBe(771); expect(edgeCount).toBe(4294);
  console.info('Paper reference comparison:', { graphs, edgeCount, maxVarianceError, maxCurvatureError, maxOllivierError });
}, 20000);

it('does not mistake iteration limits for certified infinite-sum results', () => {
  const edges: Pair[] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]];
  const graph = buildSimpleGraph(5, edges), reference = referenceVariance(5, edges);
  const short = computeEffectiveCurvatures(graph, 1), longer = computeEffectiveCurvatures(graph, 5);
  for (let i = 0; i < edges.length; i++) {
    expect(short[i].converged).toBe(false); expect(longer[i].converged).toBe(false);
    expect(short[i].vInf).toBeLessThan(longer[i].vInf);
    expect(longer[i].vInf).toBeLessThan(reference[i]);
    expect(short[i].kEff).toBeGreaterThan(longer[i].kEff);
    expect(longer[i].kEff).toBeGreaterThan(curvature(reference[i]));
  }
});

// A deliberately irregular graph is needed: transposing P is invisible on
// regular graphs. Also check transformations which change IDs/storage, not math.
it('preserves edge meaning under relabelling, order, orientation and disjoint union', () => {
  const pairs: Pair[] = [[0, 1], [1, 2], [2, 3]];
  const v = referenceVariance(4, pairs), o = referenceOllivier(4, pairs);
  const ids = [91, 7, 408, 23];
  const edges = pairs.map(([a, b], i) => ({ id: 51 + i, a: ids[b], b: ids[a], kind: 'bond' as const }));
  // Interleave a triangle with very different values and add isolated vertices.
  const extra = [{ id: 80, a: 2, b: 3, kind: 'bond' as const },
    { id: 81, a: 3, b: 5, kind: 'bond' as const }, { id: 82, a: 5, b: 2, kind: 'bond' as const }];
  const result = computeMetrics([...ids, 2, 3, 5, 999].reverse().map(id => ({ id })),
    [extra[1], edges[2], extra[0], edges[0], extra[2], edges[1]]);
  for (let i = 0; i < pairs.length; i++) {
    const value = result.values[result.bondMap.get(51 + i) as number];
    close(value.vInf, v[i], `disjoint P4 e${i}`);
    close(value.kEff, curvature(v[i]), `disjoint P4 effective e${i}`);
    close(value.ollivier, o[i], `disjoint P4 Ollivier e${i}`, 1e-12);
  }
  // This fixture must distinguish an interior edge from a terminal edge.
  expect(Math.abs(v[0] - v[1])).toBeGreaterThan(0.3);
  expect(Math.abs(o[0] - o[1])).toBeGreaterThan(0.4);
});

it('contracts a transitive rigid unit without counting duplicate contacts as weight', () => {
  const vertices = [1, 2, 3, 4, 5, 6].map(id => ({ id }));
  const edges = [
    { id: 10, a: 1, b: 2, kind: 'brace' as const },
    { id: 11, a: 2, b: 3, kind: 'brace' as const },
    { id: 12, a: 1, b: 3, kind: 'bond' as const }, // intra-unit
    { id: 13, a: 1, b: 4, kind: 'bond' as const },
    { id: 14, a: 3, b: 4, kind: 'bond' as const }, // duplicate quotient contact
    { id: 15, a: 4, b: 5, kind: 'bond' as const },
    { id: 16, a: 5, b: 6, kind: 'bond' as const }
  ];
  const result = computeMetrics(vertices, edges);
  const v = referenceVariance(4, [[0, 1], [1, 2], [2, 3]]);
  const o = referenceOllivier(4, [[0, 1], [1, 2], [2, 3]]);
  expect(result.quotientEdges).toHaveLength(3);
  expect(result.bondMap.has(10)).toBe(false); expect(result.bondMap.has(11)).toBe(false);
  expect(result.bondMap.get(12)).toBe('intra');
  expect(result.bondMap.get(13)).toBe(result.bondMap.get(14));
  for (const [id, index] of [[13, 0], [14, 0], [15, 1], [16, 2]]) {
    const value = result.values[result.bondMap.get(id) as number];
    close(value.vInf, v[index], `contracted e${id}`);
    close(value.kEff, curvature(v[index]), `contracted effective e${id}`);
    close(value.ollivier, o[index], `contracted Ollivier e${id}`, 1e-12);
  }
});


it('matches an irregular analytic family across degree and batching boundaries', () => {
  // Star K(1,m): for j>=1 the centre coordinate of q^T P^j is zero;
  // the leaf vector is 2^-j (1/m - delta_leaf). Hence
  // V = 2 + (m-1)/(3m), W1 = (m-1)/m, and Ollivier = 1/m.
  for (const leaves of [2, 7, 33, 65]) {
    const graph = buildSimpleGraph(leaves + 1, Array.from({ length: leaves }, (_, i) => [0, i + 1]));
    const expected = 2 + (leaves - 1) / (3 * leaves);
    for (const value of computeEffectiveCurvatures(graph)) {
      close(value.vInf, expected, `star ${leaves} V`);
      close(value.kEff, curvature(expected), `star ${leaves} effective`);
      expect(value.converged).toBe(true);
    }
    const transport = computeOllivierForEdge(graph, 0, leaves);
    expect(transport.ollivierFrac).toEqual([1, leaves]);
    close(transport.ollivier, 1 / leaves, `star ${leaves} Ollivier`, 1e-12);
  }
});
