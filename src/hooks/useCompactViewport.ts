import { useLayoutEffect, useState } from 'react';
import { paneElement } from '../comparison/panes';
import { getActiveStudioStore } from '../state/store';
import { compactViewport, GRAPH_VIEWPORT_CHANGED } from '../state/viewport';

/** Track the active pane, including split-divider changes without a window resize. */
export function useCompactViewport(): boolean {
  const store = getActiveStudioStore();
  const [compact, setCompact] = useState(() => compactViewport(store));
  useLayoutEffect(() => {
    const measure = () => setCompact(compactViewport(store));
    const pane = paneElement(store);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (pane) observer?.observe(pane);
    window.addEventListener('resize', measure);
    window.addEventListener(GRAPH_VIEWPORT_CHANGED, measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener(GRAPH_VIEWPORT_CHANGED, measure);
    };
  }, [store]);
  return compact;
}
