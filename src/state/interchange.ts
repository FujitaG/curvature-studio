import { parsePanelLayout, type PanelLayout } from './panelLayout';
import { docToJson, parseDocJson, type DocumentJson } from './persistence';
import { normalizeSavedGradients, normalizeStudioStyle, type SavedGradient, type StudioStyle } from './style';
import type { Camera2d, Doc, MetricMode, ProjectionMode, ViewMode } from './types';
import { cameraNumber, fitCamera2d, graphViewport, validCamera2d } from './camera2d';
import { parsePanels, type PanelVisibility } from './panels';

export interface Camera3dJson {
  position: [number, number, number];
  target: [number, number, number];
  projection: ProjectionMode;
  orthographic?: { left: number; right: number; top: number; bottom: number; zoom: number };
}

export interface StyleJson {
  format: 'curvature-studio/style';
  version: 2;
  style: StudioStyle;
  customGradients: SavedGradient[];
}

export interface SessionJson {
  format: 'curvature-studio/session';
  version: 2;
  doc: DocumentJson;
  view: ViewMode;
  metric: MetricMode;
  labelsVisible: boolean;
  camera2d: Camera2d;
  projection?: ProjectionMode;
  viewport?: { width: number; height: number };
  camera3d?: Camera3dJson;
  histogramPos?: { x: number; y: number };
  histogramCollapsed: boolean;
  panels?: PanelVisibility;
  panelLayout?: PanelLayout;
  style: StudioStyle;
  customGradients: SavedGradient[];
}

export interface ParsedStyle { style: StudioStyle; customGradients: SavedGradient[] }
export interface ParsedSession extends Omit<SessionJson, 'doc' | 'style' | 'customGradients'>, ParsedStyle { doc: Doc; cameraWarnings?: string[] }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const vector3 = (value: unknown, label: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(cameraNumber)) throw new Error(`Invalid ${label}`);
  return [value[0], value[1], value[2]];
};

function requireFormat(value: unknown, format: string, versions: number[]): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('File must contain a JSON object');
  const raw = value as Record<string, unknown>;
  if (raw.format !== format) throw new Error(`Expected ${format}`);
  if (typeof raw.version !== 'number' || !versions.includes(raw.version)) throw new Error(`Unsupported ${format} version`);
  return raw;
}

export function styleToJson(style: StudioStyle, customGradients: SavedGradient[]): StyleJson {
  return { format: 'curvature-studio/style', version: 2, style: normalizeStudioStyle(style), customGradients: normalizeSavedGradients(customGradients) };
}

export function parseStyleJson(input: unknown): ParsedStyle {
  const raw = requireFormat(input, 'curvature-studio/style', [1, 2]);
  if (!raw.style || typeof raw.style !== 'object' || Array.isArray(raw.style) || !Array.isArray(raw.customGradients)) throw new Error('Style file must contain style and customGradients');
  if (raw.customGradients.length > 1000) throw new Error('Style exceeds the gradient limit');
  return { style: normalizeStudioStyle(raw.style), customGradients: normalizeSavedGradients(raw.customGradients) };
}

export function mergeGradients(existing: SavedGradient[], imported: SavedGradient[], style: StudioStyle): ParsedStyle {
  const merged = normalizeSavedGradients(existing);
  const usedIds = new Set(merged.map((gradient) => gradient.id));
  const usedNames = new Set(merged.map((gradient) => gradient.name));
  const remap = new Map<string, string>();
  for (const source of normalizeSavedGradients(imported)) {
    let id = source.id;
    if (usedIds.has(id)) {
      do id = `gradient-${crypto.randomUUID()}`; while (usedIds.has(id));
    }
    let name = source.name;
    if (usedNames.has(name)) {
      let suffix = 2;
      while (usedNames.has(`${source.name} (${suffix})`)) suffix += 1;
      name = `${source.name} (${suffix})`;
    }
    usedIds.add(id);
    usedNames.add(name);
    remap.set(source.id, id);
    merged.push({ ...source, id, name });
  }
  const normalized = normalizeStudioStyle(style);
  for (const metric of ['keff', 'ollivier'] as const) {
    const setting = normalized.shared.metricGradients[metric];
    if (setting.type === 'custom' && remap.has(setting.id)) normalized.shared.metricGradients[metric] = { type: 'custom', id: remap.get(setting.id)! };
  }
  return { style: normalized, customGradients: merged };
}

export function sessionToJson(input: Omit<SessionJson, 'format' | 'version' | 'doc' | 'style' | 'customGradients'> & { doc: Doc; style: StudioStyle; customGradients: SavedGradient[] }): SessionJson {
  const { cameraWarnings: _warnings, ...portable } = input as typeof input & { cameraWarnings?: string[] };
  return { format: 'curvature-studio/session', version: 2, ...portable, doc: docToJson(input.doc), style: normalizeStudioStyle(input.style), customGradients: normalizeSavedGradients(input.customGradients) };
}

export function parseSessionJson(input: unknown, repairCameras = true): ParsedSession {
  const raw = requireFormat(input, 'curvature-studio/session', [1, 2]);
  const doc = parseDocJson(raw.doc);
  const cameraWarnings: string[] = [];
  if (raw.view !== '2d' && raw.view !== '3d') throw new Error('Invalid session view');
  if (raw.metric !== 'ollivier' && raw.metric !== 'keff') throw new Error('Invalid session metric');
  let projection = raw.projection;
  if (projection !== undefined && projection !== 'perspective' && projection !== 'orthographic') {
    if (!repairCameras) throw new Error('Invalid session projection');
    projection = undefined;
    cameraWarnings.push('The saved projection was invalid and has been reset. Your graph is intact.');
  }
  let viewport: { width: number; height: number } | undefined;
  if (raw.viewport !== undefined) {
    const size = raw.viewport as Record<string, unknown>;
    if (!size || !finite(size.width) || !finite(size.height) || size.width <= 0 || size.height <= 0) throw new Error('Invalid viewport dimensions');
    viewport = { width: size.width, height: size.height };
  }
  if (typeof raw.labelsVisible !== 'boolean' || typeof raw.histogramCollapsed !== 'boolean') throw new Error('Invalid session visibility settings');
  let c2: Camera2d;
  if (validCamera2d(raw.camera2d)) {
    const { tx, ty, scale } = raw.camera2d;
    c2 = { tx, ty, scale };
  } else {
    if (!repairCameras) throw new Error('Invalid 2D camera');
    c2 = fitCamera2d(doc, graphViewport(viewport?.width ?? window.innerWidth, viewport?.height ?? window.innerHeight));
    cameraWarnings.push('The saved 2D view was invalid and has been fitted to the graph. Your graph is intact.');
  }
  let camera3d: Camera3dJson | undefined;
  try {
    if (raw.camera3d !== undefined) {
      const c3 = raw.camera3d as Record<string, unknown>;
      if (!c3 || (c3.projection !== 'perspective' && c3.projection !== 'orthographic')) throw new Error('Invalid 3D camera projection');
      camera3d = { position: vector3(c3.position, '3D camera position'), target: vector3(c3.target, '3D camera target'), projection: c3.projection };
      if (c3.orthographic !== undefined) {
        const ortho = c3.orthographic as Record<string, unknown>;
        if (!ortho || !cameraNumber(ortho.left) || !cameraNumber(ortho.right) || !cameraNumber(ortho.top) || !cameraNumber(ortho.bottom) || !cameraNumber(ortho.zoom) || ortho.zoom < 1e-8 || ortho.zoom > 1e8) throw new Error('Invalid orthographic camera');
        if (ortho.left >= ortho.right || ortho.bottom >= ortho.top) throw new Error('Orthographic camera bounds must have positive width and height');
        camera3d.orthographic = { left: ortho.left, right: ortho.right, top: ortho.top, bottom: ortho.bottom, zoom: ortho.zoom };
      }
    }
    if (camera3d && camera3d.position.every((coordinate, index) => coordinate === camera3d!.target[index])) throw new Error('3D camera must be distinct from its target');
    if (camera3d && projection && camera3d.projection !== projection) throw new Error('Session and 3D camera projections must agree');
  } catch (error) {
    if (!repairCameras) throw error;
    camera3d = undefined;
    cameraWarnings.push('The saved 3D view was invalid and has been reset. Your graph is intact.');
  }
  let histogramPos: { x: number; y: number } | undefined;
  if (raw.histogramPos !== undefined) {
    const pos = raw.histogramPos as Record<string, unknown>;
    if (!pos || !finite(pos.x) || !finite(pos.y)) throw new Error('Invalid histogram position');
    histogramPos = { x: pos.x, y: pos.y };
  }
  if (!raw.style || typeof raw.style !== 'object' || Array.isArray(raw.style) || !Array.isArray(raw.customGradients)) throw new Error('Session must contain style and customGradients');
  if (raw.customGradients.length > 1000) throw new Error('Session exceeds the gradient limit');
  return {
    format: 'curvature-studio/session', version: 2, doc, view: raw.view, metric: raw.metric,
    labelsVisible: raw.labelsVisible, camera2d: c2,
    ...(cameraWarnings.length ? { cameraWarnings } : {}),
    ...(projection ? { projection: projection as ProjectionMode } : {}), ...(viewport ? { viewport } : {}),
    ...(camera3d ? { camera3d } : {}), ...(histogramPos ? { histogramPos } : {}),
    ...(raw.panelLayout !== undefined ? { panelLayout: parsePanelLayout(raw.panelLayout) } : {}),
    histogramCollapsed: raw.histogramCollapsed, ...(raw.panels !== undefined ? { panels: parsePanels(raw.panels) } : {}),
    style: normalizeStudioStyle(raw.style), customGradients: normalizeSavedGradients(raw.customGradients)
  };
}
