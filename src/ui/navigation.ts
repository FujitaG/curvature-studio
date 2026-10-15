import { paneElement } from '../comparison/panes';
import { setLocalCamera2d } from '../comparison/store';
import { flushSync } from 'react-dom';
import { useProjectStore } from '../project/store';
import { fitCamera2d, usableGraphViewport } from '../state/camera2d';
import { useStudioStore } from '../state/store';
import type { SelectionItem } from '../state/types';
import { compactViewport, readGraphViewport } from '../state/viewport';

export function focusGraphCanvas(): void {
  (paneElement()?.querySelector<HTMLElement>('[data-graph-canvas]') ?? document.querySelector<HTMLElement>('.view-pane.active [data-graph-canvas]'))?.focus({ preventScroll: true });
}

export function fitGraphView(): void {
  const state = useStudioStore.getState();
  if (compactViewport()) flushSync(() => {
    useProjectStore.getState().setResultsOpen(false); state.setInspectorExpanded(false);
  });
  const viewport = readGraphViewport();
  if (!usableGraphViewport(viewport)) {
    state.pushToast('Not enough space to show the graph. Hide or move a panel, then try Fit again.');
    return;
  }
  state.resizeViewport2d(viewport);
  if (state.view === '3d') window.dispatchEvent(new Event('curvature-studio:fit-3d'));
  else state.fit2d();
}

/** Commit panel changes before measuring the area available for both endpoints. */
export function navigateToEdge(id: number, selection: SelectionItem[] = [{ kind: 'edge', id }]): void {
  const state = useStudioStore.getState(), edge = state.doc.edges.get(id);
  if (!edge) return;
  flushSync(() => {
    state.setTool('select'); state.setSelection(selection);
    if (compactViewport() || !usableGraphViewport(readGraphViewport())) {
      useProjectStore.getState().setResultsOpen(false);
      state.setInspectorExpanded(false);
    }
  });
  focusGraphCanvas();
  const viewport = readGraphViewport();
  if (!usableGraphViewport(viewport)) {
    state.pushToast('Not enough space to show this edge. Hide or move a panel, then locate it again.');
    return;
  }
  if (state.view === '3d') {
    window.dispatchEvent(new CustomEvent('curvature-studio:locate-3d', { detail: { edgeId: id } }));
    return;
  }
  const a = state.doc.vertices.get(edge.a)!, b = state.doc.vertices.get(edge.b)!;
  state.resizeViewport2d(viewport);
  const fitted = fitCamera2d({ vertices: new Map([[a.id, a], [b.id, b]]), edges: new Map() }, viewport);
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  // Recover a previously zoomed-out view enough to distinguish the endpoints.
  const scale = Math.min(fitted.scale, Math.max(state.camera2d.scale, length > 0 ? 96 / length : state.camera2d.scale));
  setLocalCamera2d({ scale, tx: viewport.x + viewport.width / 2 - (a.x + b.x) / 2 * scale,
    ty: viewport.y + viewport.height / 2 - (a.y + b.y) / 2 * scale });
}
