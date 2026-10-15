import { describe, expect, it } from 'vitest';
import { buildSimpleGraph, computeMetrics, TAIL_TOLERANCE, type MathEdge, type MathVertex } from '..';
import { templates } from '../../data/templates';
import { edgeArray, emptyDoc, vertexArray } from '../../state/history';
import { useStudioStore } from '../../state/store';

function vertices(n: number): MathVertex[] {
  return Array.from({ length: n }, (_, id) => ({ id }));
}

function bond(id: number, a: number, b: number): MathEdge {
  return { id, a, b, kind: 'bond' };
}

function brace(id: number, a: number, b: number): MathEdge {
  return { id, a, b, kind: 'brace' };
}

function completeGraph(startId: number, ids: number[]): MathEdge[] {
  const edges: MathEdge[] = [];
  let edgeId = startId;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      edges.push(bond(edgeId++, ids[i], ids[j]));
    }
  }
  return edges;
}

function cycle(n: number): MathEdge[] {
  return Array.from({ length: n }, (_, i) => bond(i, i, (i + 1) % n));
}

function cube(): MathEdge[] {
  const edges: MathEdge[] = [];
  let id = 0;
  for (let a = 0; a < 8; a += 1) {
    for (let bit = 0; bit < 3; bit += 1) {
      const b = a ^ (1 << bit);
      if (a < b) edges.push(bond(id++, a, b));
    }
  }
  return edges;
}

function bridge(): MathEdge[] {
  return [...completeGraph(0, [0, 1, 2, 3]), ...completeGraph(6, [4, 5, 6, 7]), bond(12, 0, 4)];
}

function ringVInf(n: number): number {
  let sum = 0;
  for (let k = 1; k < n; k += 1) {
    sum += 8 / (n * (3 + Math.cos((2 * Math.PI * k) / n)));
  }
  return sum;
}

function kEffFromVInf(vInf: number): number {
  return (2 / vInf) / (1 + Math.sqrt(Math.max(0, 1 - 2 / vInf)));
}

function close(actual: number, expected: number, tolerance = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe('curvature golden values', () => {
  it('computes K2 exactly', () => {
    const result = computeMetrics(vertices(2), [bond(0, 0, 1)]);
    expect(result.values).toHaveLength(1);
    close(result.values[0].ollivier, 1);
    close(result.values[0].vInf, 2);
    close(result.values[0].kEff, 1);
    expect(result.values[0].ollivierFrac).toEqual([1, 1]);
    expect(result.values[0].w1Frac).toEqual([0, 1]);
  });

  it('computes K4 values and the left eigenvector consequence', () => {
    const result = computeMetrics(vertices(4), completeGraph(0, [0, 1, 2, 3]));
    for (const value of result.values) {
      close(value.ollivier, 2 / 3);
      close(value.vInf, 9 / 4);
      close(value.kEff, 2 / 3);
      expect(value.ollivierFrac).toEqual([2, 3]);
    }

    const graph = buildSimpleGraph(4, completeGraph(0, [0, 1, 2, 3]).map((edge) => [edge.a, edge.b]));
    const dipole = new Float64Array([1, -1, 0, 0]);
    const next = new Float64Array(4);
    for (let u = 0; u < 4; u += 1) {
      next[u] = 0.5 * dipole[u] + 0.5 * graph.adjacency[u].reduce((sum, w) => sum + dipole[w] / graph.degree[w], 0);
    }
    close(next[0], 1 / 3);
    close(next[1], -1 / 3);
    close(next[2], 0);
    close(next[3], 0);
  });

  it('computes P3 terminal edge values', () => {
    const result = computeMetrics(vertices(3), [bond(0, 0, 1), bond(1, 1, 2)]);
    close(result.values[0].ollivier, 1 / 2);
    close(result.values[0].vInf, 13 / 6);
    close(result.values[0].kEff, 1 - Math.sqrt(1 - 12 / 13));
  });

  it('computes triangle C3 values', () => {
    const result = computeMetrics(vertices(3), cycle(3));
    for (const value of result.values) {
      close(value.ollivier, 3 / 4);
      close(value.vInf, 32 / 15);
      close(value.kEff, 3 / 4);
    }
  });

  it('computes cube Q3 values', () => {
    const result = computeMetrics(vertices(8), cube());
    for (const value of result.values) {
      close(value.ollivier, 1 / 3);
      close(value.vInf, 101 / 40);
      close(value.kEff, 1 - Math.sqrt(21 / 101));
    }
  });

  it('computes cycle C5 and C6 Ollivier values', () => {
    const c5 = computeMetrics(vertices(5), cycle(5));
    close(c5.values[0].ollivier, 1 / 4);
    const c6 = computeMetrics(vertices(6), cycle(6));
    close(c6.values[0].ollivier, 0);
    close(c6.values[0].vInf, 262 / 105);
    close(c6.values[0].kEff, kEffFromVInf(262 / 105));
  });

  it('calibrates the estimated tail against the ring Fourier closed form', () => {
    for (const n of [5, 6, 8, 12, 20, 34, 64, 128]) {
      const result = computeMetrics(vertices(n), cycle(n));
      const exact = ringVInf(n);
      for (const value of result.values) {
        expect(value.converged).toBe(true);
        // Calibration for this analytic family only, not a certified global bound.
        expect(value.vInf).toBeLessThanOrEqual(exact + 1e-12);
        expect(exact - value.vInf).toBeLessThanOrEqual(2 * TAIL_TOLERANCE);
        expect(value.kEff).toBeGreaterThanOrEqual(kEffFromVInf(exact) - 1e-12);
      }
    }
  }, 20000);

  it('computes the mixed-degree bridge values', () => {
    const result = computeMetrics(vertices(8), bridge());
    const value = result.values[result.bondMap.get(12) as number];
    close(value.ollivier, -1 / 2);
    close(value.vInf, 250 / 59);
    close(value.kEff, 1 - Math.sqrt(330) / 25);
  });

  it('preserves the rhombic dodecahedron numerical regression snapshot', () => {
    const template = templates.find((entry) => entry.id === 'rhombic-dodecahedron');
    expect(template).toBeDefined();
    const result = computeMetrics(
      vertices(template!.vertices3d.length),
      template!.edges.map(([a, b], id) => bond(id, a, b))
    );
    expect(result.values).toHaveLength(24);
    const first = result.values[0];
    for (const value of result.values) {
      close(value.vInf, first.vInf, 1e-10);
      close(value.kEff, first.kEff, 1e-10);
      close(value.ollivier, first.ollivier, 1e-10);
    }
    close(first.vInf, 2.614316239, 1e-6);
    close(first.kEff, 0.515251, 1e-6);
  });

  it('ignores disconnected components when evaluating an edge', () => {
    const edges = completeGraph(0, [0, 1, 2, 3]);
    edges.push(...completeGraph(6, [4, 5, 6, 7]));
    edges.splice(7, 1);
    const result = computeMetrics(vertices(8), edges);
    const untouched = result.values[result.bondMap.get(0) as number];
    close(untouched.ollivier, 2 / 3);
    close(untouched.vInf, 9 / 4);
  });
});

describe('rigid-unit quotient metamorphic tests', () => {
  it('K4 with one braced edge is C3 and attributes values to parallel contacts', () => {
    const edges = completeGraph(0, [0, 1, 2, 3]);
    edges[0] = brace(edges[0].id, edges[0].a, edges[0].b);
    const result = computeMetrics(vertices(4), edges);
    expect(result.quotientEdges).toHaveLength(3);
    for (const edge of edges) {
      if (edge.kind === 'brace') {
        expect(result.bondMap.has(edge.id)).toBe(false);
        continue;
      }
      const value = result.values[result.bondMap.get(edge.id) as number];
      close(value.ollivier, 3 / 4);
      close(value.vInf, 32 / 15);
      close(value.kEff, 3 / 4);
    }
  });

  it('P4 with middle brace is P3', () => {
    const edges = [bond(0, 0, 1), brace(1, 1, 2), bond(2, 2, 3)];
    const result = computeMetrics(vertices(4), edges);
    expect(result.quotientEdges).toHaveLength(2);
    for (const edgeId of [0, 2]) {
      const value = result.values[result.bondMap.get(edgeId) as number];
      close(value.ollivier, 1 / 2);
      close(value.vInf, 13 / 6);
    }
  });

  it('C4 plus a diagonal brace collapses parallel contacts into P3', () => {
    const edges = [bond(0, 0, 1), bond(1, 1, 2), bond(2, 2, 3), bond(3, 3, 0), brace(4, 0, 2)];
    const result = computeMetrics(vertices(4), edges);
    expect(result.quotientEdges).toHaveLength(2);
    expect(result.bondMap.get(0)).toBe(result.bondMap.get(1));
    expect(result.bondMap.get(2)).toBe(result.bondMap.get(3));
    for (const edgeId of [0, 1, 2, 3]) {
      const value = result.values[result.bondMap.get(edgeId) as number];
      close(value.ollivier, 1 / 2);
      close(value.vInf, 13 / 6);
    }
  });

  it('intra-unit bonds disappear without crashing', () => {
    const result = computeMetrics(vertices(3), [brace(0, 0, 1), brace(1, 1, 2), bond(2, 0, 2)]);
    expect(result.quotientEdges).toHaveLength(0);
    expect(result.values).toHaveLength(0);
    expect(result.bondMap.get(2)).toBe('intra');
  });

  it('toggling a brace back to a bond restores K4 values', () => {
    const result = computeMetrics(vertices(4), completeGraph(0, [0, 1, 2, 3]));
    for (const value of result.values) {
      close(value.ollivier, 2 / 3);
      close(value.vInf, 9 / 4);
      close(value.kEff, 2 / 3);
    }
  });

  it('round-trips a K4 brace toggle through store mutations', () => {
    useStudioStore.setState({
      doc: emptyDoc(),
      nextVertexIdCounter: 1,
      nextEdgeIdCounter: 1,
      historyPast: [],
      historyFuture: [],
      selection: [],
      results: null,
      latestTopologyKey: ''
    });
    const store = useStudioStore.getState();
    const ids = [
      store.addVertex(0, -74),
      store.addVertex(72, 42),
      store.addVertex(-72, 42),
      store.addVertex(0, 0)
    ];
    const edgeIds: number[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const edgeId = useStudioStore.getState().createOrConvertEdge(ids[i], ids[j], 'bond');
        expect(edgeId).not.toBeNull();
        edgeIds.push(edgeId!);
      }
    }
    useStudioStore.getState().convertEdge(edgeIds[0], 'brace');
    const bracedDoc = useStudioStore.getState().doc;
    const braced = computeMetrics(
      vertexArray(bracedDoc).map(({ id }) => ({ id })),
      edgeArray(bracedDoc).map(({ id, a, b, kind }) => ({ id, a, b, kind }))
    );
    for (const edge of edgeArray(bracedDoc)) {
      if (edge.kind === 'brace') continue;
      const value = braced.values[braced.bondMap.get(edge.id) as number];
      close(value.ollivier, 3 / 4);
      close(value.vInf, 32 / 15);
    }

    useStudioStore.getState().convertEdge(edgeIds[0], 'bond');
    const restoredDoc = useStudioStore.getState().doc;
    const restored = computeMetrics(
      vertexArray(restoredDoc).map(({ id }) => ({ id })),
      edgeArray(restoredDoc).map(({ id, a, b, kind }) => ({ id, a, b, kind }))
    );
    for (const value of restored.values) {
      close(value.ollivier, 2 / 3);
      close(value.vInf, 9 / 4);
    }
  });

  it('does not reuse vertex ids after undo', () => {
    useStudioStore.setState({
      doc: emptyDoc(),
      nextVertexIdCounter: 1,
      nextEdgeIdCounter: 1,
      historyPast: [],
      historyFuture: [],
      selection: [],
      results: null,
      latestTopologyKey: ''
    });
    expect(useStudioStore.getState().addVertex(0, 0)).toBe(1);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().doc.vertices.size).toBe(0);
    expect(useStudioStore.getState().addVertex(10, 0)).toBe(2);
  });
});
