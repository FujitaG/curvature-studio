import { checkImportTarget, parseJsonText } from './files';
import type { Template } from '../data/templates';

export const IMPORTED_TEMPLATES_KEY = 'curvature-studio:imported-templates';

interface Polyhedron { name: string; vertices: Array<[number, number, number]>; edges: Array<[number, number]>; faces?: number[][] }
export interface ImportedTemplate extends Template { importedAt: number; approximateLayout: boolean }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function validate(name: unknown, verticesRaw: unknown, edgesRaw: unknown, facesRaw: unknown): Polyhedron {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Polyhedron name is required');
  if (!Array.isArray(verticesRaw) || verticesRaw.length === 0 || verticesRaw.length > 1000) throw new Error('Polyhedron must contain 1 to 1,000 vertices');
  const vertices = verticesRaw.map((point) => {
    if (!Array.isArray(point) || point.length !== 3 || !point.every((value) => finite(value) && Math.abs(value) <= 1_000_000)) throw new Error('Invalid vertex coordinate (maximum magnitude: 1,000,000)');
    return [point[0], point[1], point[2]] as [number, number, number];
  });
  let faces: number[][] | undefined;
  if (facesRaw !== undefined) {
    if (!Array.isArray(facesRaw)) throw new Error('Faces must be an array');
    faces = facesRaw.map((face) => {
      if (!Array.isArray(face) || face.length < 3 || !face.every((id) => Number.isInteger(id) && id >= 0 && id < vertices.length)) throw new Error('Invalid face');
      if (new Set(face).size !== face.length) throw new Error('Face repeats a vertex');
      return [...face];
    });
  }
  if (edgesRaw === undefined && !faces?.length) throw new Error('At least one of edges or faces is required');
  // TODO(periodic): polyhedra are finite inputs, not crystallographic unit cells.
  const pairs = new Set<string>();
  const edges: Array<[number, number]> = [];
  const addEdge = (a: number, b: number, rejectDuplicate: boolean) => {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= vertices.length || b >= vertices.length) throw new Error('Edge index is out of range');
    if (a === b) throw new Error('Self-loops are not supported');
    const pair: [number, number] = a < b ? [a, b] : [b, a];
    const key = `${pair[0]}-${pair[1]}`;
    if (pairs.has(key)) { if (rejectDuplicate) throw new Error('Duplicate edge'); return; }
    pairs.add(key); edges.push(pair);
  };
  if (edgesRaw !== undefined) {
    if (!Array.isArray(edgesRaw)) throw new Error('Edges must be an array');
    for (const edge of edgesRaw) {
      if (!Array.isArray(edge) || edge.length !== 2) throw new Error('Invalid edge');
      addEdge(edge[0], edge[1], true);
    }
  } else {
    for (const face of faces ?? []) for (let i = 0; i < face.length; i += 1) addEdge(face[i], face[(i + 1) % face.length], false);
  }
  if (edges.length > 3000) throw new Error('Polyhedron exceeds the 3,000 edge limit');
  return { name: name.trim().slice(0, 80), vertices, edges, ...(faces ? { faces } : {}) };
}

export function parsePolyhedronJson(input: unknown): Polyhedron {
  if (!input || typeof input !== 'object') throw new Error('File must contain a JSON object');
  const raw = input as Record<string, unknown>;
  if (raw.format !== 'curvature-studio/polyhedron') throw new Error('Expected curvature-studio/polyhedron');
  if (raw.version !== 1) throw new Error('Unsupported curvature-studio/polyhedron version');
  return validate(raw.name, raw.vertices, raw.edges, raw.faces);
}

class ExpressionParser {
  private index = 0;
  constructor(private readonly text: string, private readonly constants: Map<string, number>) {}
  parse(): number { const value = this.sum(); this.space(); if (this.index !== this.text.length || !finite(value)) throw new Error('Invalid constant expression'); return value; }
  private space() { while (/\s/.test(this.text[this.index] ?? '')) this.index += 1; }
  private sum(): number { let v = this.product(); for (;;) { this.space(); const op = this.text[this.index]; if (op !== '+' && op !== '-') return v; this.index += 1; const n = this.product(); v = op === '+' ? v + n : v - n; } }
  private product(): number { let v = this.unary(); for (;;) { this.space(); const op = this.text[this.index]; if (op !== '*' && op !== '/') return v; this.index += 1; const n = this.unary(); v = op === '*' ? v * n : v / n; } }
  private unary(): number { this.space(); if (this.text[this.index] === '-') { this.index += 1; return -this.unary(); } if (this.text[this.index] === '+') { this.index += 1; return this.unary(); } return this.atom(); }
  private atom(): number { this.space(); if (this.text[this.index] === '(') { this.index += 1; const v = this.sum(); this.space(); if (this.text[this.index++] !== ')') throw new Error('Invalid constant expression'); return v; } const rest = this.text.slice(this.index); if (rest.startsWith('sqrt')) { this.index += 4; this.space(); if (this.text[this.index++] !== '(') throw new Error('Invalid sqrt expression'); const v = this.sum(); this.space(); if (this.text[this.index++] !== ')') throw new Error('Invalid sqrt expression'); return Math.sqrt(v); } const match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?|^C\d+/); if (!match) throw new Error('Invalid constant expression'); this.index += match[0].length; if (match[0][0] === 'C') { const v = this.constants.get(match[0]); if (v === undefined) throw new Error(`Unknown constant ${match[0]}`); return v; } return Number(match[0]); }
}

// Limited user-supplied text format; built-in templates are independently generated.
export function parseDmccooey(text: string, filename: string): Polyhedron {
  const constants = new Map<string, number>();
  const vertices: Array<[number, number, number]> = [];
  const faces: number[][] = [];
  let inFaces = false;
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^Faces\s*:/i.test(line)) { inFaces = true; continue; }
    if (inFaces) {
      const match = line.match(/^\{([^}]+)\}\s*,?$/);
      if (!match || !match[1].split(',').every(part => /^\d+$/.test(part.trim()))) throw new Error(`Invalid face on line ${lineIndex + 1}. Use a list of vertex indices such as {0, 1, 2}.`);
      faces.push(match[1].split(',').map((part) => Number(part.trim())));
      continue;
    }
    const constant = line.match(/^(C\d+)\s*=\s*([^=]+)(?:=.*)?$/);
    if (constant) { constants.set(constant[1], new ExpressionParser(constant[2], constants).parse()); continue; }
    const vertex = line.match(/^V(\d+)\s*=\s*\((.+)\)$/);
    if (vertex) {
      const index = Number(vertex[1]);
      if (index !== vertices.length) throw new Error('Vertex indices must be contiguous');
      const parts = vertex[2].split(',');
      if (parts.length !== 3) throw new Error('Invalid vertex');
      vertices.push(parts.map((part) => new ExpressionParser(part, constants).parse()) as [number, number, number]);
      continue;
    }
    if (/^(?:V\d+|C\d+|Faces\b)/i.test(line)) throw new Error(`Invalid polyhedron declaration on line ${lineIndex + 1}. See File format & examples in Templates.`);
  }
  return validate(filename.replace(/\.[^.]+$/, '') || 'Imported polyhedron', vertices, undefined, faces);
}

function approximateLayout(vertices: Array<[number, number, number]>): Array<[number, number]> {
  const axes: Array<[0 | 1 | 2, 0 | 1 | 2]> = [[0, 1], [0, 2], [1, 2]];
  const [a, b] = axes.sort((u, v) => {
    const spread = (axis: number) => Math.max(...vertices.map((p) => p[axis])) - Math.min(...vertices.map((p) => p[axis]));
    return spread(v[0]) * spread(v[1]) - spread(u[0]) * spread(u[1]);
  })[0];
  return normalizeLayout(vertices.map((p) => [p[a], p[b]]));
}

function normalizeLayout(points: Array<[number, number]>): Array<[number, number]> {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const radius = Math.max(1e-6, ...points.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
  return points.map((p) => [((p[0] - cx) / radius) * 92, ((p[1] - cy) / radius) * 92]);
}

function hasCrossing(points: Array<[number, number]>, edges: Array<[number, number]>): boolean {
  const orient = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < edges.length; i += 1) for (let j = i + 1; j < edges.length; j += 1) {
    const [a, b] = edges[i], [c, d] = edges[j];
    if (a === c || a === d || b === c || b === d) continue;
    if (orient(points[a], points[b], points[c]) * orient(points[a], points[b], points[d]) < -1e-9 && orient(points[c], points[d], points[a]) * orient(points[c], points[d], points[b]) < -1e-9) return true;
  }
  return false;
}

function tutteLayout(poly: Polyhedron): Array<[number, number]> | null {
  if (!poly.faces?.length) return null;
  const outer = [...poly.faces].sort((a, b) => b.length - a.length)[0];
  const boundary = new Set(outer);
  const neighbors = Array.from({ length: poly.vertices.length }, () => new Set<number>());
  for (const [a, b] of poly.edges) { neighbors[a].add(b); neighbors[b].add(a); }
  if (neighbors.some((set) => set.size === 0)) return null;
  const points: Array<[number, number]> = Array.from({ length: poly.vertices.length }, () => [0, 0]);
  outer.forEach((id, i) => { const angle = (2 * Math.PI * i) / outer.length - Math.PI / 2; points[id] = [Math.cos(angle), Math.sin(angle)]; });
  for (let iteration = 0; iteration < 1200; iteration += 1) for (let id = 0; id < points.length; id += 1) if (!boundary.has(id)) { const list = [...neighbors[id]]; points[id] = [list.reduce((s, n) => s + points[n][0], 0) / list.length, list.reduce((s, n) => s + points[n][1], 0) / list.length]; }
  if (points.some((p) => !p.every(finite)) || hasCrossing(points, poly.edges)) return null;
  return normalizeLayout(points);
}

export function toImportedTemplate(poly: Polyhedron): ImportedTemplate {
  const planar = tutteLayout(poly);
  return { id: `imported-${crypto.randomUUID()}`, group: 'Imported', label: poly.name, vertices3d: poly.vertices, edges: poly.edges, ...(poly.faces ? { faces: poly.faces } : {}), layout2d: planar ?? approximateLayout(poly.vertices), importedAt: Date.now(), approximateLayout: planar === null };
}

export function parsePolyhedronFile(text: string, filename: string): ImportedTemplate {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('This file is empty. Choose a polyhedron JSON or TXT file.');
  const isJson = /\.json$/i.test(filename) || /^[{\[]/.test(trimmed);
  let poly: Polyhedron;
  if (isJson) { const input = parseJsonText(trimmed); checkImportTarget(input, 'polyhedron'); poly = parsePolyhedronJson(input); }
  else {
    if (!/^\s*V\d+\s*=/m.test(trimmed)) throw new Error('Unsupported polyhedron text. Use polyhedron JSON or a TXT file with V0 = (x, y, z) vertices and a Faces: section. See File format & examples in Templates.');
    poly = parseDmccooey(trimmed, filename);
  }
  return toImportedTemplate(poly);
}

export function loadImportedTemplates(): ImportedTemplate[] {
  try {
    const raw = JSON.parse(localStorage.getItem(IMPORTED_TEMPLATES_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is ImportedTemplate => item && typeof item.id === 'string' && typeof item.label === 'string' && Array.isArray(item.vertices3d) && Array.isArray(item.edges) && Array.isArray(item.layout2d));
  } catch { return []; }
}

export function saveImportedTemplates(items: ImportedTemplate[]): boolean {
  try { localStorage.setItem(IMPORTED_TEMPLATES_KEY, JSON.stringify(items)); return true; }
  catch { return false; }
}
