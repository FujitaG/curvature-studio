import { unitEdgeWeight } from '../graph/edge';
import { CALCULATION_CACHE_KEY } from './calculation';
import type { MathEdge, MathVertex, SimpleGraph } from './types';

interface GraphDocument {
  vertices: ReadonlyMap<number, MathVertex>;
  edges: ReadonlyMap<number, MathEdge>;
}
const documentKeys = new WeakMap<GraphDocument, string>();

/** Documents are immutable after publication; coordinate edits inherit this key. */
export function computationKeyForDoc(doc: GraphDocument): string {
  let key = documentKeys.get(doc);
  if (key === undefined) { key = computationKey(doc.vertices.values(), doc.edges.values()); documentKeys.set(doc, key); }
  return key;
}

export function inheritComputationKey(before: GraphDocument, after: GraphDocument): void {
  documentKeys.set(after, computationKeyForDoc(before));
}

// TODO(weighted-graphs): future model/version/parameters and every conductance
// belong in the calculation key; never normalize away a changed input here.
// Results contain ID-indexed maps, so topology alone is not a safe cache key.
// Coordinates are deliberately excluded: moving a vertex does not change curvature.
export function computationKey(vertices: Iterable<MathVertex>, edges: Iterable<MathEdge>): string {
  const ids = [...vertices].map(({ id }) => id).sort((a, b) => a - b);
  const records = [...edges].map(edge => [edge.id, Math.min(edge.a, edge.b), Math.max(edge.a, edge.b), edge.kind, unitEdgeWeight(edge)] as const)
    .sort((a, b) => a[0] - b[0]);
  return ids.length || records.length ? JSON.stringify([CALCULATION_CACHE_KEY, ids, records]) : '';
}

// TODO(periodic): finite endpoint identity only. Infinite connections also carry
// integer translations, including nonzero self-orbit bonds; use a separate key.
export function canonicalPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function topologyKey(edges: Iterable<MathEdge>): string {
  return [...edges]
    .map((edge) => {
      const [a, b] = canonicalPair(edge.a, edge.b);
      return { a, b, kind: edge.kind };
    })
    .sort((u, v) => u.a - v.a || u.b - v.b || u.kind.localeCompare(v.kind))
    .map(({ a, b, kind }) => `${a}-${b}:${kind === 'bond' ? 'b' : 'x'}`)
    .join(';');
}

// TODO(periodic): this real finite simple graph cannot represent Bloch fibers.
export function buildSimpleGraph(vertexCount: number, edges: Array<[number, number]>): SimpleGraph {
  const adjacency: number[][] = Array.from({ length: vertexCount }, () => []);
  for (const [a, b] of edges) {
    if (a === b) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  for (const list of adjacency) list.sort((a, b) => a - b);
  const degree = new Int32Array(vertexCount);
  adjacency.forEach((neighbors, index) => {
    degree[index] = neighbors.length;
  });
  return { vertexCount, edges, adjacency, degree };
}

export function bfsDistances(graph: SimpleGraph, source: number, queue = new Int32Array(graph.vertexCount)): Int32Array {
  const dist = new Int32Array(graph.vertexCount);
  dist.fill(-1);
  let head = 0;
  let tail = 0;
  dist[source] = 0;
  queue[tail++] = source;
  while (head < tail) {
    const v = queue[head++];
    for (const next of graph.adjacency[v]) {
      if (dist[next] !== -1) continue;
      dist[next] = dist[v] + 1;
      queue[tail++] = next;
    }
  }
  return dist;
}

export function assertFiniteDistance(dist: Int32Array, target: number): number {
  const d = dist[target];
  if (d < 0) {
    throw new Error(`Internal error: disconnected transport support at vertex ${target}`);
  }
  return d;
}
