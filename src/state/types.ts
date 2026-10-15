import type { UnitEdge } from '../graph/edge';
import type { EdgeKind, MetricResult } from '../math/types';
import type { MetricGradientSetting, SavedGradient, StudioStyle } from './style';
import type { Viewport2d } from './camera2d';
import type { DocPatch } from './history';
import type { PanelVisibility } from './panels';

export type VertexId = number;
export type EdgeId = number;

export interface Vertex {
  id: VertexId;
  x: number;
  y: number;
  p3?: [number, number, number];
  baked3d?: boolean;
}

/** Canonical live edges always carry explicit unit weight. */
export interface Edge extends UnitEdge {}

export interface Doc {
  // Once published in the store, edit through store actions. Replace changed
  // values instead of mutating them so history and derived caches remain valid.
  vertices: Map<VertexId, Vertex>;
  edges: Map<EdgeId, Edge>;
}

export type ViewMode = '2d' | '3d';
export type MetricMode = 'ollivier' | 'keff';
export type ProjectionMode = 'perspective' | 'orthographic';
export type ToolMode = 'select' | 'bond' | 'brace' | 'erase';

export interface SelectionItem {
  kind: 'vertex' | 'edge';
  id: number;
}

export interface Camera2d {
  tx: number;
  ty: number;
  scale: number;
}

export interface Toast {
  id: number;
  message: string;
}

export interface StudioState {
  doc: Doc;
  nextVertexIdCounter: number;
  nextEdgeIdCounter: number;
  historyPast: DocPatch[];
  historyFuture: DocPatch[];
  selection: SelectionItem[];
  view: ViewMode;
  projection: ProjectionMode;
  metric: MetricMode;
  tool: ToolMode;
  camera2d: Camera2d;
  camera2dMode: 'fit' | 'manual';
  viewport2d: Viewport2d;
  labelsVisible: boolean;
  histogramCollapsed: boolean;
  panels: PanelVisibility;
  inspectorExpanded: boolean;
  colorblindSafe: boolean;
  style: StudioStyle;
  customGradients: SavedGradient[];
  templateDrawerOpen: boolean;
  shortcutSheetOpen: boolean;
  overflowOpen: boolean;
  relax3dAllNext: boolean;
  relax3dRunning: boolean;
  relax3dProgress: number;
  relax3dError: string | null;
  computing: boolean;
  computationError: string | null;
  computationPaused: boolean;
  computationRequest: number;
  progress: number;
  results: MetricResult | null;
  histogramHoverBin: { min: number; max: number } | null;
  latestTopologyKey: string;
  toasts: Toast[];
  setTool: (tool: ToolMode) => void;
  setView: (view: ViewMode) => void;
  setProjection: (projection: ProjectionMode) => void;
  toggleView: () => void;
  toggleMetric: () => void;
  setMetric: (metric: MetricMode) => void;
  setCamera2d: (camera: Camera2d) => void;
  resizeViewport2d: (viewport: Viewport2d) => void;
  fit2d: () => void;
  toggleLabels: () => void;
  setLabelsVisible: (visible: boolean) => void;
  toggleHistogram: () => void;
  setHistogramCollapsed: (collapsed: boolean) => void;
  setPanelVisible: (panel: keyof PanelVisibility, visible: boolean) => void;
  setInspectorExpanded: (expanded: boolean) => void;
  toggleColorblindSafe: () => void;
  setStyle: (updater: StudioStyle | ((style: StudioStyle) => StudioStyle)) => void;
  resetStyle: () => void;
  setMetricGradient: (metric: MetricMode, setting: MetricGradientSetting) => void;
  setCustomGradients: (gradients: SavedGradient[]) => void;
  setTemplateDrawerOpen: (open: boolean) => void;
  setShortcutSheetOpen: (open: boolean) => void;
  setOverflowOpen: (open: boolean) => void;
  setSelection: (selection: SelectionItem[]) => void;
  clearSelection: () => void;
  addVertex: (x: number, y: number, p3?: [number, number, number], baked3d?: boolean) => VertexId;
  createOrConvertEdge: (a: VertexId, b: VertexId, kind: EdgeKind) => EdgeId | null;
  createVertexAndEdge: (start: VertexId, x: number, y: number, kind: EdgeKind) => VertexId | null;
  createEdgeBetweenNewVertices: (ax: number, ay: number, bx: number, by: number, kind: EdgeKind) => EdgeId | null;
  convertEdge: (edgeId: EdgeId, kind: EdgeKind) => void;
  deleteSelection: () => void;
  deleteEntity: (item: SelectionItem) => void;
  beginEraseGesture: () => void;
  scrubEraseItem: (item: SelectionItem) => void;
  endEraseGesture: () => void;
  moveVertices: (vertexIds: VertexId[], dx: number, dy: number) => void;
  moveVertices3d: (positions: Array<{ id: VertexId; p3: [number, number, number] }>) => void;
  replaceDoc: (doc: Doc, selectAll?: boolean, resetCounters?: boolean) => void;
  newDocument: () => void;
  relax3dLayout: () => void;
  stopRelax3dLayout: () => void;
  undo: () => void;
  redo: () => void;
  setComputing: (computing: boolean, progress?: number) => void;
  setResults: (results: MetricResult, complete?: boolean) => void;
  stopComputation: () => void;
  retryComputation: () => void;
  setHistogramHoverBin: (bin: { min: number; max: number } | null) => void;
  pushToast: (message: string) => void;
  dismissToast: (id: number) => void;
}
