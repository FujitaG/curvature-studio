import { UNIT_EDGE_WEIGHT } from '../graph/edge';
import { activeStore } from './activeStore';
import { t } from '../i18n';
import { allocateIds, followingId, nextIdCursor } from './ids';
import { POSITION_ERROR, validPosition } from './coordinates';
import type { LayoutMessage } from '../layout/relax3d';
import { create } from 'zustand';
import { DEFAULT_PANELS } from './panels';
import { fitCamera2d, graphViewport, resizeCamera2d, usableGraphViewport } from './camera2d';
import { shortcut } from '../shortcuts';
import { computationKeyForDoc, inheritComputationKey, topologyKey } from '../math/graph';
import { storePreference } from './storage';
import type { EdgeKind, MetricResult } from '../math/types';
import { cancelActiveDrag } from './dragController';
import { appendHistory, applyDocPatch, createDocPatch, forkDoc, cleanSelection, cloneDoc, edgeArray, emptyDoc } from './history';
import {
  DEFAULT_STUDIO_STYLE,
  loadCustomGradients,
  loadStudioStyle,
  normalizeSavedGradients,
  normalizeStudioStyle,
  saveCustomGradients,
  saveStudioStyle
} from './style';
import type { Camera2d, Doc, Edge, ProjectionMode, SelectionItem, StudioState, Vertex } from './types';

const SOFT_VERTEX_LIMIT = 400;
const SOFT_EDGE_LIMIT = 1200;
const HARD_VERTEX_LIMIT = 1000;
const HARD_EDGE_LIMIT = 3000;

const initialColorblindSafe = storedBoolean('curvature-studio:colorblind-safe', false);
const initialStyle = loadStudioStyle(initialColorblindSafe);
const initialCustomGradients = loadCustomGradients();

function storedBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function storedProjection(): ProjectionMode {
  try {
    return localStorage.getItem('curvature-studio:projection') === 'orthographic' ? 'orthographic' : 'perspective';
  } catch {
    return 'perspective';
  }
}


function uniqueSelection(selection: SelectionItem[]): SelectionItem[] {
  const seen = new Set<string>();
  const result: SelectionItem[] = [];
  for (const item of selection) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// TODO(periodic): editing must address an edge orbit AND a cell translation.
function findEdgeBetween(doc: Doc, a: number, b: number): Edge | undefined {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return [...doc.edges.values()].find((edge) => Math.min(edge.a, edge.b) === lo && Math.max(edge.a, edge.b) === hi);
}

function nextVertexCounterFromDoc(doc: Doc): number {
  return nextIdCursor(doc.vertices.keys());
}

function nextEdgeCounterFromDoc(doc: Doc): number {
  return nextIdCursor(doc.edges.keys());
}



// TODO(weighted-graphs): planned setBondConductance(edgeId, value) is NOT callable
// yet. It must use the calculation-changing mutation path, preserve weight through
// clone/Undo, and NEVER inherit a coordinate-only key.
// Only calculation inputs invalidate results; layout and display changes keep them.
function computeFlags(
  newKey: string,
  before: Pick<StudioState, 'latestTopologyKey' | 'computing' | 'progress'>
): Partial<StudioState> {
  const changed = newKey !== before.latestTopologyKey;
  return {
    latestTopologyKey: newKey,
    computing: changed ? true : before.computing,
    progress: changed ? 0 : before.progress,
    ...(changed ? { results: null, computationError: null, computationPaused: false } : {})
  };
}

function withMutation(
  set: (partial: Partial<StudioState> | ((state: StudioState) => Partial<StudioState>)) => void,
  get: () => StudioState,
  mutate: (doc: Doc) => SelectionItem[] | void,
  topologyChange = true
): void {
  const before = get();
  const doc = forkDoc(before.doc);
  const selection = mutate(doc) ?? before.selection;
  if (!topologyChange && import.meta.env.DEV) {
    console.assert(topologyKey(edgeArray(doc)) === topologyKey(edgeArray(before.doc)), 'Non-topology mutation changed the topology key');
  }
  if (!topologyChange) { doc.edges = before.doc.edges; inheritComputationKey(before.doc, doc); }
  set({
    doc,
    historyPast: appendHistory(before.historyPast, createDocPatch(before.doc, doc)),
    historyFuture: [],
    selection: cleanSelection(doc, uniqueSelection(selection)),
    ...computeFlags(computationKeyForDoc(doc), before)
  });
}

function warnIfLarge(state: StudioState, beforeDoc: Doc): void {
  const crossedVertices = beforeDoc.vertices.size <= SOFT_VERTEX_LIMIT && state.doc.vertices.size > SOFT_VERTEX_LIMIT;
  const crossedEdges = beforeDoc.edges.size <= SOFT_EDGE_LIMIT && state.doc.edges.size > SOFT_EDGE_LIMIT;
  if (crossedVertices || crossedEdges) {
    state.pushToast('Large graph: computations may become slow');
  }
}

export function createStudioStore() {
let eraseGestureBase: Doc | null = null;
let eraseGestureChanged = false;
let activeLayout: { worker: Worker; unsubscribe: () => void; finish: () => boolean } | null = null;
const useStudioStore = create<StudioState>((set, get) => ({
  doc: emptyDoc(),
  nextVertexIdCounter: 1,
  nextEdgeIdCounter: 1,
  historyPast: [],
  historyFuture: [],
  selection: [],
  view: '2d',
  projection: storedProjection(),
  metric: 'keff',
  tool: 'bond',
  camera2d: { tx: window.innerWidth / 2, ty: window.innerHeight / 2, scale: 1 },
  camera2dMode: 'manual',
  viewport2d: graphViewport(window.innerWidth, window.innerHeight),
  labelsVisible: true,
  histogramCollapsed: storedBoolean('curvature-studio:histogram-collapsed', false),
  panels: { ...DEFAULT_PANELS },
  inspectorExpanded: false,
  colorblindSafe: initialColorblindSafe,
  style: initialStyle,
  customGradients: initialCustomGradients,
  templateDrawerOpen: false,
  shortcutSheetOpen: false,
  overflowOpen: false,
  relax3dAllNext: false,
  relax3dRunning: false,
  relax3dProgress: 0,
  relax3dError: null,
  computing: false,
  computationError: null,
  computationPaused: false,
  computationRequest: 0,
  progress: 0,
  results: null,
  histogramHoverBin: null,
  latestTopologyKey: '',
  toasts: [],

  setTool: (tool) => {
    cancelActiveDrag();
    set({ tool });
  },
  setView: (view) => set({ view }),
  setProjection: (projection) => {
    storePreference('curvature-studio:projection', projection);
    set({ projection });
  },
  toggleView: () => set((state) => ({ view: state.view === '2d' ? '3d' : '2d' })),
  toggleMetric: () => set((state) => ({ metric: state.metric === 'keff' ? 'ollivier' : 'keff' })),
  setMetric: (metric) => set({ metric }),
  setCamera2d: (camera) => set({ camera2d: camera, camera2dMode: 'manual' }),
  resizeViewport2d: (viewport2d) => {
    if (!usableGraphViewport(viewport2d)) return;
    const state = get();
    if (Object.entries(viewport2d).every(([key, value]) => state.viewport2d[key as keyof typeof viewport2d] === value)) return;
    set({ viewport2d, camera2d: state.camera2dMode === 'fit' ? fitCamera2d(state.doc, viewport2d) : resizeCamera2d(state.camera2d, state.viewport2d, viewport2d) });
  },
  fit2d: () => {
    const state = get();
    if (!usableGraphViewport(state.viewport2d)) return;
    set({ camera2d: fitCamera2d(state.doc, state.viewport2d), camera2dMode: 'fit' });
  },
  toggleLabels: () => set((state) => ({ labelsVisible: !state.labelsVisible })),
  setPanelVisible: (panel, visible) => set(state => ({ panels: { ...state.panels, [panel]: visible },
    ...(panel === 'histogram' && !visible ? { histogramHoverBin: null } : {}),
    ...(panel === 'inspector' ? { inspectorExpanded: false } : {}) })),
  setInspectorExpanded: (inspectorExpanded) => set({ inspectorExpanded }),
  setLabelsVisible: (labelsVisible) => set({ labelsVisible }),
  toggleHistogram: () => {
    const next = !get().histogramCollapsed;
    storePreference('curvature-studio:histogram-collapsed', String(next));
    set({ histogramCollapsed: next });
  },
  setHistogramCollapsed: (histogramCollapsed) => {
    storePreference('curvature-studio:histogram-collapsed', String(histogramCollapsed));
    set({ histogramCollapsed });
  },
  toggleColorblindSafe: () => {
    const next = !get().colorblindSafe;
    storePreference('curvature-studio:colorblind-safe', String(next));
    const style = normalizeStudioStyle({
      ...get().style,
      shared: { metricGradients: {
        keff: { type: 'preset', preset: next ? 'colorblind' : 'studio' },
        ollivier: { type: 'preset', preset: next ? 'colorblind' : 'studio' }
      } }
    });
    saveStudioStyle(style);
    set({ colorblindSafe: next, style });
  },
  setStyle: (updater) =>
    set((state) => {
      const next = normalizeStudioStyle(typeof updater === 'function' ? updater(state.style) : updater);
      saveStudioStyle(next);
      return { style: next };
    }),
  resetStyle: () => {
    const next = normalizeStudioStyle(DEFAULT_STUDIO_STYLE);
    saveStudioStyle(next);
    set({ style: next, labelsVisible: true, colorblindSafe: false });
    storePreference('curvature-studio:colorblind-safe', 'false');
  },
  setMetricGradient: (metric, setting) =>
    set((state) => {
      const next = normalizeStudioStyle({
        ...state.style,
        shared: { metricGradients: { ...state.style.shared.metricGradients, [metric]: setting } }
      });
      saveStudioStyle(next);
      return { style: next };
    }),
  setCustomGradients: (customGradients) => {
    const next = normalizeSavedGradients(customGradients);
    saveCustomGradients(next);
    set({ customGradients: next });
  },
  setTemplateDrawerOpen: (open) => set({ templateDrawerOpen: open }),
  setShortcutSheetOpen: (open) => set({ shortcutSheetOpen: open }),
  setOverflowOpen: (open) => set({ overflowOpen: open }),
  setSelection: (selection) => set((state) => ({ selection: cleanSelection(state.doc, uniqueSelection(selection)) })),
  clearSelection: () => set({ selection: [] }),

  addVertex: (x, y, p3, baked3d) => {
    let created = -1;
    const state = get();
    if (!validPosition({ x, y, p3 })) { state.pushToast(POSITION_ERROR); return created; }
    if (state.doc.vertices.size >= HARD_VERTEX_LIMIT) {
      state.pushToast('Hard limit reached: 1,000 vertices');
      return created;
    }
    const [vertexId] = allocateIds(state.doc.vertices.keys(), 1, state.nextVertexIdCounter);
    withMutation(set, get, (doc) => {
      created = vertexId;
      doc.vertices.set(created, { id: created, x, y, p3: p3 ? [...p3] : undefined, baked3d });
      return [{ kind: 'vertex', id: created }];
    });
    set({ nextVertexIdCounter: followingId(vertexId) });
    warnIfLarge(get(), state.doc);
    return created;
  },

  createOrConvertEdge: (a, b, kind) => {
    if (a === b) return null;
    let edgeId: number | null = null;
    const state = get();
    if (!state.doc.vertices.has(a) || !state.doc.vertices.has(b)) return null;
    const existingBefore = findEdgeBetween(state.doc, a, b);
    if (existingBefore?.kind === kind) {
      set({ selection: [{ kind: 'edge', id: existingBefore.id }] });
      return existingBefore.id;
    }
    if (state.doc.edges.size >= HARD_EDGE_LIMIT && !findEdgeBetween(state.doc, a, b)) {
      state.pushToast('Hard limit reached: 3,000 edges');
      return null;
    }
    const [newEdgeId] = allocateIds(state.doc.edges.keys(), 1, state.nextEdgeIdCounter);
    withMutation(set, get, (doc) => {
      const existing = findEdgeBetween(doc, a, b);
      if (existing) {
        doc.edges.set(existing.id, { ...existing, kind });
        edgeId = existing.id;
      } else {
        edgeId = newEdgeId;
        doc.edges.set(edgeId, { id: edgeId, a, b, kind, weight: UNIT_EDGE_WEIGHT });
      }
      return [{ kind: 'edge', id: edgeId }];
    });
    if (!existingBefore) set({ nextEdgeIdCounter: followingId(newEdgeId) });
    warnIfLarge(get(), state.doc);
    return edgeId;
  },

  createVertexAndEdge: (start, x, y, kind) => {
    let created: number | null = null;
    const state = get();
    if (!validPosition({ x, y })) { state.pushToast(POSITION_ERROR); return null; }
    if (!state.doc.vertices.has(start)) return null;
    if (state.doc.vertices.size >= HARD_VERTEX_LIMIT || state.doc.edges.size >= HARD_EDGE_LIMIT) {
      state.pushToast('Hard limit reached');
      return null;
    }
    const [vertexId] = allocateIds(state.doc.vertices.keys(), 1, state.nextVertexIdCounter);
    const [edgeId] = allocateIds(state.doc.edges.keys(), 1, state.nextEdgeIdCounter);
    withMutation(set, get, (doc) => {
      created = vertexId;
      doc.vertices.set(created, { id: created, x, y });
      doc.edges.set(edgeId, { id: edgeId, a: start, b: created, kind, weight: UNIT_EDGE_WEIGHT });
      return [{ kind: 'edge', id: edgeId }];
    });
    set({ nextVertexIdCounter: followingId(vertexId), nextEdgeIdCounter: followingId(edgeId) });
    warnIfLarge(get(), state.doc);
    return created;
  },

  createEdgeBetweenNewVertices: (ax, ay, bx, by, kind) => {
    let edgeId: number | null = null;
    const state = get();
    if (!validPosition({ x: ax, y: ay }) || !validPosition({ x: bx, y: by })) { state.pushToast(POSITION_ERROR); return null; }
    if (state.doc.vertices.size + 2 > HARD_VERTEX_LIMIT || state.doc.edges.size + 1 > HARD_EDGE_LIMIT) {
      state.pushToast('Hard limit reached');
      return null;
    }
    const [a, b] = allocateIds(state.doc.vertices.keys(), 2, state.nextVertexIdCounter);
    const [newEdgeId] = allocateIds(state.doc.edges.keys(), 1, state.nextEdgeIdCounter);
    withMutation(set, get, (doc) => {
      edgeId = newEdgeId;
      doc.vertices.set(a, { id: a, x: ax, y: ay });
      doc.vertices.set(b, { id: b, x: bx, y: by });
      doc.edges.set(edgeId, { id: edgeId, a, b, kind, weight: UNIT_EDGE_WEIGHT });
      return [{ kind: 'edge', id: edgeId }];
    });
    set({ nextVertexIdCounter: followingId(b), nextEdgeIdCounter: followingId(newEdgeId) });
    warnIfLarge(get(), state.doc);
    return edgeId;
  },

  convertEdge: (edgeId, kind) => {
    const current = get().doc.edges.get(edgeId);
    if (!current || current.kind === kind) {
      if (current) set({ selection: [{ kind: 'edge', id: edgeId }] });
      return;
    }
    withMutation(set, get, (doc) => {
      const edge = doc.edges.get(edgeId);
      if (edge) doc.edges.set(edgeId, { ...edge, kind });
      return [{ kind: 'edge', id: edgeId }];
    });
  },

  deleteSelection: () => {
    const selection = get().selection;
    if (selection.length === 0) return;
    withMutation(set, get, (doc) => {
      const vertexIds = new Set(selection.filter((item) => item.kind === 'vertex').map((item) => item.id));
      const edgeIds = new Set(selection.filter((item) => item.kind === 'edge').map((item) => item.id));
      for (const id of vertexIds) doc.vertices.delete(id);
      for (const [id, edge] of doc.edges) {
        if (edgeIds.has(id) || vertexIds.has(edge.a) || vertexIds.has(edge.b)) doc.edges.delete(id);
      }
      return [];
    });
  },

  deleteEntity: (item) => {
    set({ selection: [item] });
    get().deleteSelection();
  },

  beginEraseGesture: () => {
    eraseGestureBase = get().doc;
    eraseGestureChanged = false;
  },

  scrubEraseItem: (item) => {
    const state = get();
    if (item.kind === 'vertex' && !state.doc.vertices.has(item.id)) return;
    if (item.kind === 'edge' && !state.doc.edges.has(item.id)) return;
    const doc = forkDoc(state.doc);
    if (item.kind === 'vertex') {
      doc.vertices.delete(item.id);
      for (const [id, edge] of doc.edges) {
        if (edge.a === item.id || edge.b === item.id) doc.edges.delete(id);
      }
    } else {
      doc.edges.delete(item.id);
    }
    eraseGestureChanged = true;
    set({
      doc,
      selection: cleanSelection(doc, state.selection),
      ...computeFlags(computationKeyForDoc(doc), state)
    });
  },

  endEraseGesture: () => {
    const state = get();
    if (!eraseGestureBase || !eraseGestureChanged) {
      eraseGestureBase = null;
      eraseGestureChanged = false;
      return;
    }
    set({
      historyPast: appendHistory(state.historyPast, createDocPatch(eraseGestureBase, state.doc)),
      historyFuture: [],
      selection: cleanSelection(state.doc, state.selection)
    });
    eraseGestureBase = null;
    eraseGestureChanged = false;
  },

  moveVertices: (vertexIds, dx, dy) => {
    if (vertexIds.length === 0 || (dx === 0 && dy === 0)) return;
    const state = get();
    if (vertexIds.some(id => { const v = state.doc.vertices.get(id); return v && !validPosition({ ...v, x: v.x + dx, y: v.y + dy }); })) {
      state.pushToast(POSITION_ERROR); return;
    }
    withMutation(set, get, (doc) => {
      for (const id of vertexIds) {
        const vertex = doc.vertices.get(id);
        if (vertex) {
          doc.vertices.set(id, { ...vertex, x: vertex.x + dx, y: vertex.y + dy });
        }
      }
    }, false);
  },

  moveVertices3d: (positions) => {
    if (positions.length === 0) return;
    const state = get();
    if (positions.some(({ id, p3 }) => { const v = state.doc.vertices.get(id); return v && !validPosition({ ...v, p3 }); })) {
      state.pushToast(POSITION_ERROR); return;
    }
    withMutation(set, get, (doc) => {
      for (const { id, p3 } of positions) {
        const vertex = doc.vertices.get(id);
        if (vertex) doc.vertices.set(id, { ...vertex, p3: [...p3] });
      }
    }, false);
  },

  replaceDoc: (doc, selectAll = false, resetCounters = false) => {
    const before = get();
    const selection = selectAll
      ? [
          ...[...doc.vertices.keys()].map((id): SelectionItem => ({ kind: 'vertex', id })),
          ...[...doc.edges.keys()].map((id): SelectionItem => ({ kind: 'edge', id }))
        ]
      : [];
    const nextVertexCounter = nextVertexCounterFromDoc(doc);
    const nextEdgeCounter = nextEdgeCounterFromDoc(doc);
    set({
      doc: cloneDoc(doc),
      nextVertexIdCounter: resetCounters ? nextVertexCounter : nextIdCursor(doc.vertices.keys(), before.nextVertexIdCounter),
      nextEdgeIdCounter: resetCounters ? nextEdgeCounter : nextIdCursor(doc.edges.keys(), before.nextEdgeIdCounter),
      historyPast: appendHistory(before.historyPast, createDocPatch(before.doc, doc)),
      historyFuture: [],
      selection,
      ...computeFlags(computationKeyForDoc(doc), before)
    });
  },

  newDocument: () => {
    const before = get();
    if (before.doc.vertices.size === 0 && before.doc.edges.size === 0) return;
    const doc = emptyDoc();
    set({
      doc,
      historyPast: appendHistory(before.historyPast, createDocPatch(before.doc, doc)),
      historyFuture: [],
      selection: [],
      ...computeFlags('', before),
      results: null
    });
    get().pushToast(t('Canvas cleared — press {shortcut} to restore', { shortcut: shortcut('z') }));
  },

  relax3dLayout: () => {
    const state = get();
    if (state.doc.vertices.size === 0 || activeLayout) return;
    const relaxAll = state.relax3dAllNext;
    const baseDoc = state.doc;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../layout/worker.ts', import.meta.url), { type: 'module' });
    } catch {
      set({ relax3dError: '3D layout could not start. Retry, or reload the app.' });
      return;
    }
    const job = { worker, unsubscribe: () => {}, finish: () => {
      if (activeLayout !== job) return false;
      activeLayout = null;
      job.unsubscribe();
      worker.terminate();
      set({ relax3dRunning: false });
      return true;
    } };
    activeLayout = job;
    const fail = (message: string) => { if (job.finish()) set({ relax3dError: message }); };
    // Any graph edit, Undo or project open invalidates this snapshot immediately.
    job.unsubscribe = useStudioStore.subscribe((next) => {
      if (next.doc !== baseDoc && job.finish()) get().pushToast('3D layout cancelled because the graph changed');
    });
    worker.onerror = (event) => { event.preventDefault(); fail('3D layout could not finish. Retry, or use a smaller graph.'); };
    worker.onmessageerror = () => fail('3D layout returned unreadable data. Please retry.');
    worker.onmessage = (event: MessageEvent<LayoutMessage>) => {
      if (activeLayout !== job || get().doc !== baseDoc) return;
      const data = event.data;
      if (data.type === 'error') { fail(data.message); return; }
      if (data.type === 'progress') { set({ relax3dProgress: data.progress }); return; }
      if (data.type !== 'result') return;
      if (data.positions.length !== baseDoc.vertices.size || data.positions.some(({ id, p3 }) =>
        !baseDoc.vertices.has(id) || p3.length !== 3 || p3.some((v) => !Number.isFinite(v) || Math.abs(v) > 1_000_000))) {
        fail('3D layout returned invalid positions. The original graph is unchanged.'); return;
      }
      job.finish();
      const changed = data.positions.some(({ id, p3 }) => {
        const before = baseDoc.vertices.get(id)!.p3;
        return !before || before.some((v, axis) => v !== p3[axis]);
      });
      if (changed) withMutation(set, get, (doc) => {
        for (const { id, p3 } of data.positions) doc.vertices.set(id, { ...doc.vertices.get(id)!, p3: [...p3] });
      }, false);
      set({ relax3dAllNext: !relaxAll, relax3dProgress: 1 });
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('curvature-studio:fit-3d')), 0);
      get().pushToast('3D layout relaxed');
    };
    set({ relax3dRunning: true, relax3dProgress: 0, relax3dError: null, overflowOpen: false });
    try {
      worker.postMessage({ vertices: [...baseDoc.vertices.values()], edges: [...baseDoc.edges.values()], relaxAll });
    } catch { fail('3D layout could not start. Retry, or reload the app.'); }
  },
  stopRelax3dLayout: () => {
    if (activeLayout?.finish()) get().pushToast('3D layout stopped — original positions kept');
    set({ relax3dError: null });
  },

  undo: () => {
    const state = get();
    const patch = state.historyPast.at(-1);
    if (!patch) return;
    const previous = applyDocPatch(state.doc, patch, 'before');
    set({
      doc: previous,
      nextVertexIdCounter: nextIdCursor(previous.vertices.keys(), state.nextVertexIdCounter),
      nextEdgeIdCounter: nextIdCursor(previous.edges.keys(), state.nextEdgeIdCounter),
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [patch, ...state.historyFuture],
      selection: cleanSelection(previous, state.selection),
      ...computeFlags(computationKeyForDoc(previous), state)
    });
  },

  redo: () => {
    const state = get();
    const patch = state.historyFuture[0];
    if (!patch) return;
    const next = applyDocPatch(state.doc, patch, 'after');
    set({
      doc: next,
      nextVertexIdCounter: nextIdCursor(next.vertices.keys(), state.nextVertexIdCounter),
      nextEdgeIdCounter: nextIdCursor(next.edges.keys(), state.nextEdgeIdCounter),
      historyPast: appendHistory(state.historyPast, patch),
      historyFuture: state.historyFuture.slice(1),
      selection: cleanSelection(next, state.selection),
      ...computeFlags(computationKeyForDoc(next), state)
    });
  },

  setComputing: (computing, progress = get().progress) => set({ computing, progress }),
  setResults: (results: MetricResult, complete = true) => set((state) => {
    if (results.key !== computationKeyForDoc(state.doc)) return {};
    return { results, computing: !complete, computationError: null, progress: complete ? 1 : 0.2 };
  }),
  stopComputation: () => set({ computing: false, computationPaused: true }),
  retryComputation: () => set((state) => ({ computationPaused: false, computationError: null, computing: true, progress: 0, computationRequest: state.computationRequest + 1 })),
  setHistogramHoverBin: (histogramHoverBin) => set({ histogramHoverBin }),
  pushToast: (message) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    set((state) => ({ toasts: [...state.toasts, { id, message }].slice(-3) }));
    window.setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));
return useStudioStore;
}
export type StudioStore = ReturnType<typeof createStudioStore>;
const studioAccess = activeStore(createStudioStore());
export const useStudioStore = studioAccess.hook;
export const getActiveStudioStore = studioAccess.get;
export const selectStudioStore = studioAccess.select;


export function screenToModel(point: { x: number; y: number }, camera: Camera2d): { x: number; y: number } {
  return {
    x: (point.x - camera.tx) / camera.scale,
    y: (point.y - camera.ty) / camera.scale
  };
}

export function modelToScreen(point: { x: number; y: number }, camera: Camera2d): { x: number; y: number } {
  return {
    x: point.x * camera.scale + camera.tx,
    y: point.y * camera.scale + camera.ty
  };
}
