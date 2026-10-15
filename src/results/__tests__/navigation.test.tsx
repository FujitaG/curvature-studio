import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResultsPanel } from '../../ui/ResultsPanel';
import { Inspector } from '../../ui/Inspector';
import { useStudioStore as studio } from '../../state/store';
import { useProjectStore as project } from '../../project/store';
import { docFromArrays } from '../../state/persistence';
import { computeMetrics } from '../../math';
import { getActiveStudioStore } from '../../state/store';
import { registerPane } from '../../comparison/panes';
import { navigateToEdge } from '../../ui/navigation';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const doc = docFromArrays([{ id: 1, x: 0, y: 0 }, { id: 2, x: 64, y: 0 }], [{ id: 1, a: 1, b: 2, kind: 'bond' }]);
  studio.setState({ ...studio.getInitialState(), doc, results: computeMetrics([...doc.vertices.values()], [...doc.edges.values()]) });
  project.setState({ ...project.getInitialState(), resultsOpen: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); registerPane(getActiveStudioStore(), null); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['2d', '3d'] as const)('locates a %s edge, closes the narrow panel, and transfers keyboard focus to the graph', async view => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  studio.setState({ view, inspectorExpanded: true });
  const moved = vi.fn(); window.addEventListener('curvature-studio:locate-3d', moved);
  await act(async () => root.render(<><div className="view-pane active"><canvas data-graph-canvas tabIndex={0} /></div><Inspector /><ResultsPanel /></>));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Locate edge e1"]')!;
  button.focus();
  await act(async () => button.click());
  expect(project.getState().resultsOpen).toBe(false);
  expect(studio.getState().selection).toEqual([{ kind: 'edge', id: 1 }]);
  expect(document.activeElement).toBe(host.querySelector('canvas'));
  expect(host.querySelector('.inspector')).toBeNull();
  expect(host.querySelector('.inspector-toggle')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('.inspector-toggle')!.click());
  expect(host.querySelector('.inspector')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close inspector"]')!.click());
  expect(studio.getState().selection).toEqual([{ kind: 'edge', id: 1 }]);
  expect(host.querySelector('.inspector')).toBeNull();
  if (view === '3d') expect(moved).toHaveBeenCalledOnce();
  window.removeEventListener('curvature-studio:locate-3d', moved);
});

it.each(['2d', '3d'] as const)('treats a narrow desktop comparison pane as compact in %s', async view => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1084);
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 544, top: 180, width: 532, height: 630 } as DOMRect);
  registerPane(getActiveStudioStore(), host);
  studio.setState({ view, inspectorExpanded: true, camera2d: { scale: 0.001, tx: 0, ty: 0 }, camera2dMode: 'manual' });
  await act(async () => root.render(<><canvas data-graph-canvas tabIndex={0} /><Inspector /><ResultsPanel /></>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Locate edge e1"]')!.click());
  expect(project.getState().resultsOpen).toBe(false);
  expect(host.querySelector('.inspector')).toBeNull();
  expect(host.querySelector('.inspector-toggle')).not.toBeNull();
  expect(document.activeElement).toBe(host.querySelector('canvas'));
  if (view === '2d') expect(studio.getState().camera2d.scale * 64).toBeGreaterThanOrEqual(96);
});

it('does not persist a tiny Locate camera when a floating panel covers the canvas', async () => {
  const panel = document.createElement('div'); panel.className = 'histogram'; document.body.append(panel);
  vi.spyOn(panel, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } as DOMRect);
  const camera = studio.getState().camera2d;
  try {
    await act(async () => navigateToEdge(1));
    expect(studio.getState().camera2d).toBe(camera);
    expect(studio.getState().toasts.at(-1)?.message).toMatch(/Not enough space/);
    expect(studio.getState().selection).toEqual([{ kind: 'edge', id: 1 }]);
  } finally { panel.remove(); }
});
