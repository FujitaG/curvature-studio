import { CALCULATION_CACHE_KEY } from './calculation';
import { buildSimpleGraph } from './graph';
import type { SimpleGraph } from './types';

export interface GraphComponent {
  graph: SimpleGraph;
  /** Local edge index -> original quotient edge index. */
  edgeIndices: number[];
  key: string;
}

/** Relabel in ascending vertex order, preserving both edge and summation order. */
export function graphComponents(graph: SimpleGraph): GraphComponent[] {
  if (!graph.edges.length) return [];
  const componentOf = new Int32Array(graph.vertexCount).fill(-1);
  const localOf = new Int32Array(graph.vertexCount);
  const groups: Array<{ vertices: number[]; edges: Array<[number, number]>; edgeIndices: number[] }> = [];
  for (let seed = 0; seed < graph.vertexCount; seed += 1) {
    if (componentOf[seed] !== -1 || !graph.degree[seed]) continue;
    const vertices = [seed];
    const id = groups.length;
    componentOf[seed] = id;
    for (let head = 0; head < vertices.length; head += 1) {
      for (const next of graph.adjacency[vertices[head]]) {
        if (componentOf[next] !== -1) continue;
        componentOf[next] = id;
        vertices.push(next);
      }
    }
    vertices.sort((a, b) => a - b).forEach((vertex, index) => { localOf[vertex] = index; });
    groups.push({ vertices, edges: [], edgeIndices: [] });
  }
  graph.edges.forEach(([a, b], index) => {
    const group = groups[componentOf[a]];
    group.edges.push([localOf[a], localOf[b]]);
    group.edgeIndices.push(index);
  });
  return groups.map(({ vertices, edges, edgeIndices }) => ({
    graph: vertices.length === graph.vertexCount ? graph : buildSimpleGraph(vertices.length, edges),
    edgeIndices,
    // TODO(weighted-graphs): weighted keys must include local conductances and
    // the quotient aggregation policy. Unit-only caches must not be reused.
    // IDs and positions are irrelevant here; values are mapped back by edgeIndices.
    key: JSON.stringify([CALCULATION_CACHE_KEY, vertices.length, edges])
  }));
}
