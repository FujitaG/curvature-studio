import { unitEdgeWeight } from '../graph/edge';
import { buildSimpleGraph, canonicalPair } from './graph';
import type { MathEdge, MathVertex, QuotientResult } from './types';

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== x) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra] += 1;
  }
}

// TODO(weighted-graphs): implement a separate versioned weighted quotient.
// Summing duplicate Bonds would change all-unit results; policy is unresolved.
// Reserve source Bond IDs before aggregation. Brace is always a rigid merge.
// TODO(periodic): finite-only merge/dedup. A periodic Brace needs relative-cell
// offsets; same unit does not imply an intra bond unless residual shift is zero.
export function buildQuotient(vertices: MathVertex[], edges: MathEdge[]): QuotientResult {
  // Direct math/Worker callers must not silently drop a non-unit weight.
  for (const edge of edges) unitEdgeWeight(edge);
  const sortedVertices = [...vertices].sort((a, b) => a.id - b.id);
  const indexOf = new Map<number, number>();
  sortedVertices.forEach((vertex, index) => indexOf.set(vertex.id, index));

  const uf = new UnionFind(sortedVertices.length);
  for (const edge of edges) {
    const ia = indexOf.get(edge.a);
    const ib = indexOf.get(edge.b);
    if (ia === undefined || ib === undefined) {
      throw new Error(`Dangling edge ${edge.id}`);
    }
    if (edge.kind === 'brace') uf.union(ia, ib);
  }

  const firstVertexByRoot = new Map<number, number>();
  for (let i = 0; i < sortedVertices.length; i += 1) {
    const root = uf.find(i);
    const previous = firstVertexByRoot.get(root);
    const id = sortedVertices[i].id;
    if (previous === undefined || id < previous) firstVertexByRoot.set(root, id);
  }

  const orderedRoots = [...firstVertexByRoot.entries()].sort((a, b) => a[1] - b[1]).map(([root]) => root);
  const unitIndexByRoot = new Map<number, number>();
  orderedRoots.forEach((root, index) => unitIndexByRoot.set(root, index));

  const unitOf = new Map<number, number>();
  for (let i = 0; i < sortedVertices.length; i += 1) {
    const unit = unitIndexByRoot.get(uf.find(i));
    if (unit === undefined) throw new Error('Internal quotient indexing error');
    unitOf.set(sortedVertices[i].id, unit);
  }

  const quotientEdges: Array<[number, number]> = [];
  const quotientEdgeIndex = new Map<string, number>();
  const bondMap = new Map<number, number | 'intra'>();

  for (const edge of edges) {
    if (edge.kind !== 'bond') continue;
    const ua = unitOf.get(edge.a);
    const ub = unitOf.get(edge.b);
    if (ua === undefined || ub === undefined) throw new Error(`Dangling edge ${edge.id}`);
    if (ua === ub) {
      bondMap.set(edge.id, 'intra');
      continue;
    }
    const [u, v] = canonicalPair(ua, ub);
    const key = `${u}-${v}`;
    let index = quotientEdgeIndex.get(key);
    if (index === undefined) {
      index = quotientEdges.length;
      quotientEdges.push([u, v]);
      quotientEdgeIndex.set(key, index);
    }
    bondMap.set(edge.id, index);
  }

  return {
    unitOf,
    quotientEdges,
    bondMap,
    graph: buildSimpleGraph(orderedRoots.length, quotientEdges)
  };
}
