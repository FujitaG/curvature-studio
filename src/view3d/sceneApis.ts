import { getActiveStudioStore, type StudioStore } from '../state/store';
export const sceneApis = new Map<StudioStore, { capture: () => string | null; svg: () => string; stats: (projection?: boolean) => unknown; navigate: (rotation: [number,number,number,number], zoom: number) => void }>();
/** Capture only the renderer owned by the requested document, never a raw canvas. */
export function exportScene(store: StudioStore, format: 'svg' | 'png'): string {
  const scene = sceneApis.get(store);
  const output = format === 'svg' ? scene?.svg() : scene?.capture();
  if (!output || (format === 'png' && !output.startsWith('data:image/png;'))) {
    throw new Error('The 3D view is not ready. Wait for it to finish drawing, then export again. If needed, switch to 2D and back to 3D.');
  }
  return output;
}
export function installSceneApis() {
  Object.assign(window, {
    __curvatureStudioCapture3d: () => sceneApis.get(getActiveStudioStore())?.capture() ?? null,
    __curvatureStudioSvg3d: () => sceneApis.get(getActiveStudioStore())?.svg() ?? null,
    __curvatureStudioRenderStats: (projection?: boolean) => sceneApis.get(getActiveStudioStore())?.stats(projection)
  });
}
