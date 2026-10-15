import { useLayoutEffect } from 'react';
import { getActiveStudioStore } from '../state/store';
import { usableGraphViewport } from '../state/camera2d';
import { registeredStores, paneElement, paneSize, paneMeasured } from '../comparison/panes';
import { compactViewport, GRAPH_OBSTACLES, GRAPH_VIEWPORT_CHANGED, readGraphViewport } from '../state/viewport';

/** Observe UI layout, never individual graph transforms during pan/rotation. */
export function useGraphViewport(): void {
  useLayoutEffect(() => {
    const app = document.querySelector('.app');
    if (!app) return;
    let frame = 0, signature = '';
    let windowWidth = window.innerWidth, windowHeight = window.innerHeight;
    const observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      const topbar = document.querySelector('.topbar'), bar = document.querySelector('.project-bar');
      if (topbar) document.documentElement.style.setProperty('--topbar-height', `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
      if (bar) document.documentElement.style.setProperty('--chrome-height', `${Math.ceil(bar.getBoundingClientRect().bottom) + 4}px`);
      // A compact results sheet temporarily covers the canvas. It must not shrink
      // the graph or replace a useful saved view while the user reads results.
      if (document.querySelector('.panel-dragging') || compactViewport() && document.querySelector('#results-panel')) return;
      const stores = registeredStores();
      if (!stores.length) stores.push(getActiveStudioStore());
      let changed = false;
      const resized = windowWidth !== window.innerWidth || windowHeight !== window.innerHeight;
      for (const store of stores) {
        const pane = paneElement(store), size = paneSize(store);
        // The pane's ResizeObserver owns camera recentering. Do not overwrite its
        // previous viewport before it can apply the resize, especially on restore.
        if (pane && (!paneMeasured(store) || size?.width !== pane.clientWidth || size?.height !== pane.clientHeight)) continue;
        const viewport = readGraphViewport(undefined, undefined, store);
        if (!usableGraphViewport(viewport)) continue;
        const state = store.getState();
        if (JSON.stringify(viewport) === JSON.stringify(state.viewport2d)) continue;
        if (state.camera2dMode === 'fit' || signature && resized) state.resizeViewport2d(viewport);
        else store.setState({ viewport2d: viewport });
        changed = true;
      }
      signature = 'measured';
      if (changed) window.dispatchEvent(new Event(GRAPH_VIEWPORT_CHANGED));
      windowWidth = window.innerWidth; windowHeight = window.innerHeight;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      for (const node of observed) if (!node.isConnected) { resize.unobserve(node); observed.delete(node); }
      for (const node of app.querySelectorAll(GRAPH_OBSTACLES)) if (!observed.has(node)) { observed.add(node); resize.observe(node); }
      schedule();
    };
    const mutations = new MutationObserver(records => {
      if (records.some(record => record.target === app || (record.target instanceof Element && record.target.closest(GRAPH_OBSTACLES)) ||
        [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(GRAPH_OBSTACLES) || node.querySelector(GRAPH_OBSTACLES))))) observe();
    });
    mutations.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', schedule);
    measure(); observe();
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); window.removeEventListener('resize', schedule); };
  }, []);
}
