import type { Camera2d } from '../state/types';
import type { Viewport2d } from '../state/camera2d';

export interface FigureFrame { x: number; y: number; width: number; height: number }
export interface FigureSettings {
  widthMm: number;
  heightMm: number;
  paddingMm: number;
  dpi: number;
  background: 'white' | 'transparent';
  range: 'fit' | 'current';
  frame?: FigureFrame;
  labelSizePt: number;
  decimals: number;
  labels: 'decimal' | 'fraction' | 'hidden';
  font: 'sans-serif' | 'serif' | 'monospace';
}
export const DEFAULT_FIGURE: FigureSettings = {
  widthMm: 120, heightMm: 90, paddingMm: 8, dpi: 300, background: 'white', range: 'fit',
  labelSizePt: 7.875, decimals: 2, labels: 'decimal', font: 'sans-serif'
};
/** Paper size after the display multiplier, shared by the preview UI and SVG writer. */
export const actualFigureLabelSizePt = (basePt: number, displayScale: number): number => basePt * displayScale;
export const MM_TO_PX = 96 / 25.4;
export function figurePixels(settings: FigureSettings): { width: number; height: number } {
  return { width: Math.max(1, Math.round(settings.widthMm * settings.dpi / 25.4)), height: Math.max(1, Math.round(settings.heightMm * settings.dpi / 25.4)) };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseFigure(input: unknown): FigureSettings {
  if (input === undefined) return { ...DEFAULT_FIGURE };
  if (!object(input)) throw new Error('Invalid figure setup');
  const names = { widthMm: 'Width (mm)', heightMm: 'Height (mm)', paddingMm: 'Margin (mm)', dpi: 'PNG DPI', labelSizePt: 'Label size (pt)', decimals: 'Decimal places' };
  for (const [key, min, max] of [['widthMm', 20, 500], ['heightMm', 20, 500], ['paddingMm', 0, 200], ['dpi', 72, 600], ['labelSizePt', 3, 36], ['decimals', 0, 10]] as const) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${names[key]} must be between ${min} and ${max}`);
  }
  if (!Number.isInteger(input.decimals) || !Number.isInteger(input.dpi)) throw new Error('DPI and decimal places must be whole numbers');
  if (!['white', 'transparent'].includes(String(input.background)) || !['fit', 'current'].includes(String(input.range)) ||
      !['decimal', 'fraction', 'hidden'].includes(String(input.labels)) || !['sans-serif', 'serif', 'monospace'].includes(String(input.font))) throw new Error('Invalid figure background, range, labels, or font');
  if (Number(input.paddingMm) * 2 >= Math.min(Number(input.widthMm), Number(input.heightMm))) throw new Error('Margins must leave room for the figure');
  let frame: FigureFrame | undefined;
  if (input.frame !== undefined) {
    const f = input.frame;
    if (!object(f) || ['x', 'y', 'width', 'height'].some(k => typeof f[k] !== 'number' || !Number.isFinite(f[k]) || Math.abs(Number(f[k])) > 1e12) || Number(f.width) <= 0 || Number(f.height) <= 0) throw new Error('Invalid figure view range');
    frame = { x: Number(f.x), y: Number(f.y), width: Number(f.width), height: Number(f.height) };
  }
  if (input.range === 'current' && !frame) throw new Error('Capture a 2D view range before exporting');
  const result: FigureSettings = { widthMm: Number(input.widthMm), heightMm: Number(input.heightMm), paddingMm: Number(input.paddingMm), dpi: Number(input.dpi),
    background: input.background as FigureSettings['background'], range: input.range as FigureSettings['range'], ...(frame ? { frame } : {}),
    labelSizePt: Number(input.labelSizePt), decimals: Number(input.decimals), labels: input.labels as FigureSettings['labels'], font: input.font as FigureSettings['font'] };
  const pixels = figurePixels(result);
  if (Math.max(pixels.width, pixels.height) > 8192 || pixels.width * pixels.height > 16_777_216) throw new Error('PNG would exceed 8192 pixels per side or 16 megapixels. Reduce the paper size or DPI.');
  return result;
}
export function captureFigureFrame(camera: Camera2d, viewport: Viewport2d): FigureFrame {
  return { x: (viewport.x - camera.tx) / camera.scale, y: (viewport.y - camera.ty) / camera.scale, width: viewport.width / camera.scale, height: viewport.height / camera.scale };
}

/** Rasterize the exact vector preview. Physical dimensions determine pixels; no hidden downscaling. */
export async function figurePng(svg: string, settings: FigureSettings): Promise<string> {
  const size = figurePixels(parseFigure(settings));
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  // Raster image dimensions must equal the target, so viewBox remains the single transform.
  parsed.documentElement.setAttribute('width', String(size.width));
  parsed.documentElement.setAttribute('height', String(size.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(parsed)], { type: 'image/svg+xml' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Unable to render the figure PNG')); image.src = url;
    });
    const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('PNG canvas is unavailable');
    if (settings.background === 'white') { context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, size.width, size.height); }
    context.drawImage(image, 0, 0, size.width, size.height);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
