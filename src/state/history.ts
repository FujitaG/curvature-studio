import type { Doc, Edge, SelectionItem, Vertex } from './types';
import { inheritComputationKey } from '../math/graph';
import { inheritCanvasDocument } from './documentView';
import { nextIdCursor } from './ids';

type Change<T> = { id: number; before: T | null; after: T | null };
export interface DocPatch {
  vertices: Change<Vertex>[];
  edges: Change<Edge>[];
  // Also invalidates calculations. TODO(weighted-graphs): separate calculation
  // changes from structural/rendering topology when weight editing is introduced.
  topologyChanged: boolean;
}

const copyVertex = (vertex: Vertex): Vertex => ({ ...vertex, ...(vertex.p3 ? { p3: [...vertex.p3] as [number, number, number] } : {}) });

/** Copy map containers only. Mutators must replace the objects they change. */
export function forkDoc(doc: Doc): Doc {
  return { vertices: new Map(doc.vertices), edges: new Map(doc.edges) };
}

export function createDocPatch(before: Doc, after: Doc): DocPatch {
  function changes<T>(a: Map<number, T>, b: Map<number, T>, equal: (a: T, b: T) => boolean, copy: (v: T) => T): Change<T>[] {
    const result: Change<T>[] = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const old = a.get(id), next = b.get(id);
      if (old === next || old && next && equal(old, next)) continue;
      result.push({ id, before: old ? copy(old) : null, after: next ? copy(next) : null });
    }
    return result;
  }
  const vertices = changes(before.vertices, after.vertices, (a, b) =>
    a.x === b.x && a.y === b.y && a.baked3d === b.baked3d &&
    (a.p3 === b.p3 || !!a.p3 && !!b.p3 && a.p3.every((v, i) => v === b.p3![i])), copyVertex);
  const edges = changes(before.edges, after.edges, (a, b) => a.a === b.a && a.b === b.b && a.kind === b.kind && a.weight === b.weight, (v) => ({ ...v }));
  const patch = { vertices, edges, topologyChanged: edges.length > 0 || vertices.some(v => !v.before || !v.after) };
  inheritUnchangedCanvas(before, after, patch);
  return patch;
}

function inheritUnchangedCanvas(before: Doc, after: Doc, patch: DocPatch): void {
  if (!patch.topologyChanged && patch.vertices.every(v => v.before!.x === v.after!.x && v.before!.y === v.after!.y)) inheritCanvasDocument(before, after);
}

/** Ordinary moves keep 200 steps; large replacements also have a retained-change budget. */
export function appendHistory(past: DocPatch[], patch: DocPatch): DocPatch[] {
  const next = [...past, patch];
  let records = next.reduce((sum, entry) => sum + entry.vertices.length + entry.edges.length, 0);
  let start = 0;
  while (next.length - start > 1 && (next.length - start > 200 || records > 40_000)) {
    records -= next[start].vertices.length + next[start].edges.length;
    start += 1;
  }
  return next.slice(start);
}

export function applyDocPatch(doc: Doc, patch: DocPatch, direction: 'before' | 'after'): Doc {
  const next = { vertices: patch.vertices.length ? new Map(doc.vertices) : doc.vertices, edges: patch.edges.length ? new Map(doc.edges) : doc.edges };
  for (const change of patch.vertices) {
    const value = change[direction];
    if (value) next.vertices.set(change.id, copyVertex(value)); else next.vertices.delete(change.id);
  }
  for (const change of patch.edges) {
    const value = change[direction];
    if (value) next.edges.set(change.id, { ...value }); else next.edges.delete(change.id);
  }
  if (!patch.topologyChanged) inheritComputationKey(doc, next);
  inheritUnchangedCanvas(doc, next, patch);
  return next;
}

export function emptyDoc(): Doc {
  return { vertices: new Map(), edges: new Map() };
}

export function cloneDoc(doc: Doc): Doc {
  return {
    vertices: new Map([...doc.vertices.entries()].map(([id, vertex]) => [id, { ...vertex, p3: vertex.p3 ? [...vertex.p3] as [number, number, number] : undefined }])),
    edges: new Map([...doc.edges.entries()].map(([id, edge]) => [id, { ...edge }]))
  };
}

export function nextVertexId(doc: Doc): number {
  return nextIdCursor(doc.vertices.keys());
}

export function nextEdgeId(doc: Doc): number {
  return nextIdCursor(doc.edges.keys());
}

export function cleanSelection(doc: Doc, selection: SelectionItem[]): SelectionItem[] {
  return selection.filter((item) => (item.kind === 'vertex' ? doc.vertices.has(item.id) : doc.edges.has(item.id)));
}

export function vertexArray(doc: Doc): Vertex[] {
  return [...doc.vertices.values()].sort((a, b) => a.id - b.id);
}

export function edgeArray(doc: Doc): Edge[] {
  return [...doc.edges.values()].sort((a, b) => a.id - b.id);
}

export function isolatedVertexIds(doc: Doc): number[] {
  const incident = new Set<number>();
  for (const edge of doc.edges.values()) {
    incident.add(edge.a);
    incident.add(edge.b);
  }
  return vertexArray(doc).filter((vertex) => !incident.has(vertex.id)).map((vertex) => vertex.id);
}

export function selectedVertexIds(doc: Doc, selection: SelectionItem[]): number[] {
  const ids = new Set<number>();
  for (const item of selection) {
    if (item.kind === 'vertex' && doc.vertices.has(item.id)) ids.add(item.id);
    if (item.kind === 'edge') {
      const edge = doc.edges.get(item.id);
      if (edge) {
        ids.add(edge.a);
        ids.add(edge.b);
      }
    }
  }
  return [...ids];
}
