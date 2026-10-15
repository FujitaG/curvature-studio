import type { Camera2d, Doc } from './types';

// A camera translation is a screen offset, not a graph coordinate. At maximum
// zoom a valid ±1e6 graph may need ±1e10 offsets. Leave room for panning/resizing.
export const CAMERA_OFFSET_LIMIT = 1e12;
export const MIN_CAMERA_SCALE = 1e-8;
export const MAX_CAMERA_SCALE = 10000;
export const cameraNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= CAMERA_OFFSET_LIMIT;
export function validCamera2d(input: unknown): input is Camera2d {
  const c = input as Camera2d | undefined;
  return !!c && cameraNumber(c.tx) && cameraNumber(c.ty) && cameraNumber(c.scale) && c.scale >= MIN_CAMERA_SCALE && c.scale <= MAX_CAMERA_SCALE;
}

/** Screen area available for a fitted graph, in CSS pixels. Runtime state only. */
export interface Viewport2d { x: number; y: number; width: number; height: number }

/** A covered canvas is not a fitting target. Keep the last useful camera until
 * panels move away instead of persisting the 1×1 no-space sentinel or a slit. */
export function usableGraphViewport(area: Viewport2d): boolean {
  return Object.values(area).every(Number.isFinite) && area.width >= 32 && area.height >= 32 && area.width * area.height >= 4096;
}

export function graphViewport(width: number, height: number, chromeHeight = 108): Viewport2d {
  const x = Math.min(76, width / 4);
  const y = Math.min(chromeHeight + 48, height / 2);
  return { x, y, width: Math.max(1, width - x - 32), height: Math.max(1, height - y - Math.min(280, (height - y) * 0.5)) };
}

export function fitCamera2d(doc: Doc, viewport: Viewport2d): Camera2d {
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  const vertices = [...doc.vertices.values()];
  if (!vertices.length) return { tx: centerX, ty: centerY, scale: 1 };
  const minX = Math.min(...vertices.map((v) => v.x));
  const maxX = Math.max(...vertices.map((v) => v.x));
  const minY = Math.min(...vertices.map((v) => v.y));
  const maxY = Math.max(...vertices.map((v) => v.y));
  const scale = Math.min(40, viewport.width / Math.max(1, maxX - minX), viewport.height / Math.max(1, maxY - minY));
  return { scale, tx: centerX - (minX + maxX) / 2 * scale, ty: centerY - (minY + maxY) / 2 * scale };
}

/** Panning/zooming retains the same world point at the viewport centre. */
export function resizeCamera2d(camera: Camera2d, before: Viewport2d, after: Viewport2d): Camera2d {
  return { ...camera, tx: camera.tx + after.x + after.width / 2 - before.x - before.width / 2,
    ty: camera.ty + after.y + after.height / 2 - before.y - before.height / 2 };
}
