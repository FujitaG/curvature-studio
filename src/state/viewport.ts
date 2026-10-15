import { paneElement } from '../comparison/panes';
import { getActiveStudioStore, type StudioStore } from './store';
import type { Viewport2d } from './camera2d';

export const GRAPH_VIEWPORT_CHANGED = 'curvature-studio:graph-viewport';
export const GRAPH_OBSTACLES = '.topbar, .project-bar, .tool-rail, .histogram, .inspector, .inspector-toggle, .interaction-guide, .results-panel, .dense-label-chip, .undo-open, .isolated-chip';
/** A split pane can be compact even on a wide desktop window. */
export function compactViewport(store: StudioStore = getActiveStudioStore()): boolean {
  const pane = paneElement(store), rect = pane?.getBoundingClientRect();
  // In comparison, a global Inspector can cover the peer as well as this pane.
  // Open details explicitly so both structures remain available after Locate.
  return !!pane?.closest('.comparison-surface.compare') ||
    (rect?.width ?? window.innerWidth) <= 760 || (rect?.height ?? window.innerHeight) <= 500;
}

/** Largest axis-aligned rectangle left by UI panels; independent of projection. */
export function availableRectangle(bounds: Viewport2d, obstacles: Viewport2d[]): Viewport2d {
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
  const blocked = obstacles.map(r => ({ x: Math.max(bounds.x, r.x), y: Math.max(bounds.y, r.y),
    right: Math.min(right, r.x + r.width), bottom: Math.min(bottom, r.y + r.height) }))
    .filter(r => r.right > r.x && r.bottom > r.y);
  const xs = [...new Set([bounds.x, right, ...blocked.flatMap(r => [r.x, r.right])])].sort((a, b) => a - b);
  let best: Viewport2d = { ...bounds, width: 1, height: 1 }, area = 0;
  for (let i = 0; i < xs.length - 1; i++) for (let j = i + 1; j < xs.length; j++) {
    const intervals = blocked.filter(r => r.x < xs[j] && r.right > xs[i]).sort((a, b) => a.y - b.y);
    let y = bounds.y;
    for (const r of [...intervals, { y: bottom, bottom }]) {
      const width = xs[j] - xs[i], height = r.y - y;
      if (width * height > area) { best = { x: xs[i], y, width, height }; area = width * height; }
      y = Math.max(y, r.bottom);
    }
  }
  return best;
}

export function readGraphViewport(width = window.innerWidth, height = window.innerHeight, store: StudioStore = getActiveStudioStore()): Viewport2d {
  const root = paneElement(store), rect = root?.getBoundingClientRect();
  const ox = rect?.left ?? 0, oy = rect?.top ?? 0;
  if (rect) { width = rect.width; height = rect.height; }
  const obstacles: Viewport2d[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(GRAPH_OBSTACLES)) {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
    const r = element.getBoundingClientRect();
    if (r.width && r.height) obstacles.push({ x: r.x - ox - 10, y: r.y - oy - 10, width: r.width + 20, height: r.height + 20 });
  }
  return availableRectangle({ x: 16, y: 16, width: Math.max(1, width - 32), height: Math.max(1, height - 32) }, obstacles);
}
