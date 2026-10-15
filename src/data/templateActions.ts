import { instantiateTemplate, resolveTemplate, type Template } from './templateCore';
import { cancelActiveDrag } from '../state/dragController';
import { cloneDoc, emptyDoc } from '../state/history';
import { useStudioStore } from '../state/store';
import { useProjectStore } from '../project/store';
import type { Doc, Vertex } from '../state/types';
import { COORDINATE_LIMIT, POSITION_ERROR, validPosition } from '../state/coordinates';

export type PlacementMode = 'add' | 'replace';

/** A draft may be incomplete while typing; validation never rewrites the draft. */
export function templateParameter(draft: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(draft.trim())) return null;
  const n = Number(draft);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

const point3d = (vertex: Vertex) => vertex.p3 ?? [vertex.x / 64, -vertex.y / 64, 0];

/** Separate bounding boxes in both layouts, without changing existing vertices. */
export function positionTemplate(instance: { vertices: Vertex[] }, doc: Doc): void {
  if (!doc.vertices.size || !instance.vertices.length) return;
  const existing = [...doc.vertices.values()];
  const minY = Math.min(...existing.map((v) => v.y));
  const maxY = Math.max(...existing.map((v) => v.y));
  const minNewY = Math.min(...instance.vertices.map((v) => v.y));
  const maxNewY = Math.max(...instance.vertices.map((v) => v.y));
  let dx = Math.max(...existing.map((v) => v.x)) + 96 - Math.min(...instance.vertices.map((v) => v.x));
  if (Math.max(...instance.vertices.map(v => v.x)) + dx > COORDINATE_LIMIT) dx = Math.min(...existing.map(v => v.x)) - 96 - Math.max(...instance.vertices.map(v => v.x));
  const dy = (minY + maxY - minNewY - maxNewY) / 2;
  const old3d = existing.map(point3d);
  const new3d = instance.vertices.map(point3d);
  const delta = [0, 1, 2].map((axis) => axis === 0
    ? Math.max(...old3d.map((p) => p[axis])) + 1.5 - Math.min(...new3d.map((p) => p[axis]))
    : (Math.min(...old3d.map((p) => p[axis])) + Math.max(...old3d.map((p) => p[axis])) - Math.min(...new3d.map((p) => p[axis])) - Math.max(...new3d.map((p) => p[axis]))) / 2);
  if (Math.max(...new3d.map(p => p[0])) + delta[0] > COORDINATE_LIMIT) delta[0] = Math.min(...old3d.map(p => p[0])) - 1.5 - Math.max(...new3d.map(p => p[0]));
  instance.vertices.forEach((vertex, i) => {
    vertex.x += dx; vertex.y += dy;
    vertex.p3 = [new3d[i][0] + delta[0], new3d[i][1] + delta[1], new3d[i][2] + delta[2]];
  });
}

export function stampTemplate(template: Template, n?: number, mode: PlacementMode = 'add'): boolean {
  if (template.parametric && templateParameter(String(n ?? template.defaultN), template.minN ?? 3, template.maxN ?? 128) === null) return false;
  cancelActiveDrag();
  const state = useStudioStore.getState();
  const resolved = resolveTemplate(template, n);
  const base = mode === 'replace' ? emptyDoc() : state.doc;
  if (base.vertices.size + resolved.vertices3d.length > 1000 || base.edges.size + resolved.edges.length > 3000) {
    state.pushToast('Hard limit reached'); return false;
  }
  const instance = instantiateTemplate(resolved, state.nextVertexIdCounter, state.nextEdgeIdCounter, { x: 0, y: 0 }, { vertices: base.vertices.keys(), edges: base.edges.keys() });
  positionTemplate(instance, base);
  if (!instance.vertices.every(validPosition)) { state.pushToast(POSITION_ERROR); return false; }
  const next = cloneDoc(base);
  instance.vertices.forEach((v) => next.vertices.set(v.id, v));
  instance.edges.forEach((e) => next.edges.set(e.id, e));
  if ((base.vertices.size <= 400 && next.vertices.size > 400) || (base.edges.size <= 1200 && next.edges.size > 1200)) state.pushToast('Large graph: computations may become slow');
  state.replaceDoc(next);
  state.setSelection([...instance.vertices.map((v) => ({ kind: 'vertex' as const, id: v.id })), ...instance.edges.map((e) => ({ kind: 'edge' as const, id: e.id }))]);
  if (!state.doc.vertices.size && mode === 'add' && useProjectStore.getState().metadata.title === 'Untitled project') useProjectStore.getState().setTitle(resolved.label);
  state.fit2d();
  // React must rebuild the 3D scene before fitting its content.
  window.setTimeout(() => window.dispatchEvent(new Event('curvature-studio:fit-3d')), 0);
  return true;
}
