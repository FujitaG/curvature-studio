import { getActiveStudioStore, type StudioStore } from './store';
import { parsePanelLayout, type PanelLayout } from './panelLayout';
import type { Camera3dJson } from './interchange';
import { storePreference } from './storage';

export const HISTOGRAM_POS_KEY = 'curvature-studio:histogram-pos';
export const WORKSPACE_CHANGED = 'curvature-studio:workspace-changed';
type Memory = { camera3d: Camera3dJson | null; position: { x: number; y: number } | null; layout: PanelLayout };
const memories = new WeakMap<StudioStore, Memory>();
function memory(store = getActiveStudioStore()): Memory {
  let item = memories.get(store);
  if (!item) { item = { camera3d: null, position: null, layout: parsePanelLayout(undefined) }; memories.set(store, item); }
  return item;
}
try {
  const p = JSON.parse(localStorage.getItem(HISTOGRAM_POS_KEY) ?? 'null');
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) memory().position = { x: p.x, y: p.y };
} catch { /* Preferences are optional. */ }
export function getSavedCamera3d(store = getActiveStudioStore()): Camera3dJson | null { return structuredClone(memory(store).camera3d); }
export function setSavedCamera3d(camera: Camera3dJson | null, store = getActiveStudioStore()): void { memory(store).camera3d = structuredClone(camera); }
export function getHistogramPosition(store = getActiveStudioStore()) { const p = memory(store).position; return p ? { ...p } : null; }
export function setHistogramPosition(position: { x: number; y: number } | null, store = getActiveStudioStore()): void {
  memory(store).position = position ? { ...position } : null;
  storePreference(HISTOGRAM_POS_KEY, position ? JSON.stringify(position) : null);
  window.dispatchEvent(new Event(WORKSPACE_CHANGED));
}
export const PANEL_LAYOUT_CHANGED = 'curvature-studio:panel-layout';
export function getPanelLayout(store = getActiveStudioStore()): PanelLayout { return memory(store).layout; }
export function setPanelLayout(value: PanelLayout, store = getActiveStudioStore()): void {
  memory(store).layout = parsePanelLayout(value);
  window.dispatchEvent(new Event(PANEL_LAYOUT_CHANGED)); window.dispatchEvent(new Event(WORKSPACE_CHANGED));
}
export function subscribePanelLayout(notify: () => void): () => void {
  window.addEventListener(PANEL_LAYOUT_CHANGED, notify);
  return () => window.removeEventListener(PANEL_LAYOUT_CHANGED, notify);
}
