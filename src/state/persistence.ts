import { parseJsonText } from '../import/files';
import { normalizeUnitEdge, type UnitEdgeInput, type EdgeJsonInput } from '../graph/edge';
import type { Doc, Edge, Vertex } from './types';
import { emptyDoc } from './history';
import { validEntityId } from './ids';
import { validCoordinate as finite } from './coordinates';

export const AUTOSAVE_KEY = 'curvature-studio:doc:v1';

export interface DocumentJson {
  format: 'curvature-studio/doc';
  version: 1;
  vertices: Array<{ id: number; x: number; y: number; p3?: [number, number, number]; baked3d?: boolean }>;
  edges: EdgeJsonInput[];
}

export function docToJson(doc: Doc): DocumentJson {
  return {
    format: 'curvature-studio/doc',
    version: 1,
    vertices: [...doc.vertices.values()]
      .sort((a, b) => a.id - b.id)
      .map((vertex) => ({
        id: vertex.id,
        x: vertex.x,
        y: vertex.y,
        ...(vertex.p3 ? { p3: [...vertex.p3] as [number, number, number] } : {}),
        ...(vertex.baked3d !== undefined ? { baked3d: vertex.baked3d } : {})
      })),
    edges: [...doc.edges.values()].sort((a, b) => a.id - b.id).map(normalizeUnitEdge)
  };
}

export function parseDocJson(input: unknown): Doc {
  const value = input as Partial<DocumentJson>;
  if (value?.format !== 'curvature-studio/doc' || value.version !== 1) {
    throw new Error('Unsupported document format');
  }
  if (!Array.isArray(value.vertices) || !Array.isArray(value.edges)) {
    throw new Error('Document must contain vertex and edge arrays');
  }
  if (value.vertices.length > 1000 || value.edges.length > 3000) {
    throw new Error('Document exceeds the hard size limit: at most 1,000 vertices and 3,000 edges are supported.');
  }

  const doc = emptyDoc();
  for (const [index, raw] of value.vertices.entries()) {
    if (!raw || !validEntityId(raw.id) || !finite(raw.x) || !finite(raw.y)) {
      throw new Error(`Invalid vertex at vertices[${index}]. Use a unique positive integer id (at most 9,007,199,254,740,990) and numeric x/y coordinates between -1,000,000 and 1,000,000.`);
    }
    if (doc.vertices.has(raw.id)) throw new Error(`Duplicate vertex id ${raw.id}. Each vertex needs a unique id.`);
    let p3: [number, number, number] | undefined;
    if (raw.p3 !== undefined) {
      if (!Array.isArray(raw.p3) || raw.p3.length !== 3 || !raw.p3.every(finite)) throw new Error(`Invalid 3D point for vertex ${raw.id}. p3 must contain three numbers between -1,000,000 and 1,000,000.`);
      p3 = [raw.p3[0], raw.p3[1], raw.p3[2]];
    }
    if (raw.baked3d !== undefined && typeof raw.baked3d !== 'boolean') throw new Error('Invalid 3D pin setting');
    doc.vertices.set(raw.id, { id: raw.id, x: raw.x, y: raw.y, ...(p3 ? { p3 } : {}), ...(raw.baked3d !== undefined ? { baked3d: raw.baked3d } : {}) });
  }

  // TODO(periodic): v1 is finite. A future reader must validate translated
  // connections instead of rejecting all self-orbit edges or deduping endpoints.
  const pairs = new Set<string>();
  for (const [index, raw] of value.edges.entries()) {
    if (!raw || !validEntityId(raw.id) || !doc.vertices.has(raw.a) || !doc.vertices.has(raw.b)) {
      throw new Error(`Invalid edge at edges[${index}]. Use a unique positive integer id (at most 9,007,199,254,740,990) and endpoints that refer to existing vertex ids.`);
    }
    if (raw.a === raw.b) throw new Error(`Self-loops are not supported (edge ${raw.id}). Choose two different endpoints.`);
    if (raw.kind !== 'bond' && raw.kind !== 'brace') throw new Error(`Invalid edge kind for edge ${raw.id}. Use bond or brace.`);
    let edge: Edge;
    try { edge = normalizeUnitEdge(raw); } catch (error) { throw new Error(`Edge ${raw.id}: ${error instanceof Error ? error.message : 'Invalid weight'}`); } // Explicit unit weight before entering live state.
    if (doc.edges.has(raw.id)) throw new Error(`Duplicate edge id ${raw.id}. Each edge needs a unique id.`);
    const lo = Math.min(raw.a, raw.b);
    const hi = Math.max(raw.a, raw.b);
    const key = `${lo}-${hi}`;
    if (pairs.has(key)) throw new Error(`Duplicate edge endpoints on edge ${raw.id}. Only one edge may connect a pair of vertices.`);
    pairs.add(key);
    doc.edges.set(raw.id, edge);
  }

  return doc;
}

export function loadAutosave(): Doc | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return parseDocJson(JSON.parse(raw));
  } catch (error) {
    console.warn('Discarding invalid Curvature Studio autosave', error);
    return null;
  }
}

export function saveAutosave(doc: Doc): void {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(docToJson(doc)));
}

export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function readTextFile(file: File, maxBytes = MAX_IMPORT_BYTES): Promise<string> {
  if (file.size > maxBytes) throw new Error(`This file is ${(file.size / 1048576).toFixed(2)} MiB (${file.size.toLocaleString('en-US')} bytes) and exceeds ${maxBytes / 1048576} MiB. Use a smaller file or remove unnecessary JSON whitespace.`);
  try { return (await file.text()).replace(/^\uFEFF/, ''); }
  catch { throw new Error('The file could not be read. Check that it is available on this device, then select it again.'); }
}

export async function readJsonFile(file: File, maxBytes = MAX_IMPORT_BYTES): Promise<Record<string, unknown>> {
  return parseJsonText(await readTextFile(file, maxBytes));
}

export function docFromArrays(vertices: Vertex[], edges: UnitEdgeInput[]): Doc {
  return {
    vertices: new Map(vertices.map((vertex) => [vertex.id, vertex])),
    edges: new Map(edges.map((edge) => [edge.id, normalizeUnitEdge(edge)]))
  };
}
