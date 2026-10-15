import { storePreference } from './storage';
import type { MetricMode } from './types';

export type GradientPresetId = 'studio' | 'colorblind' | 'viridis' | 'coolwarm' | 'grayscale';

export interface GradientStop {
  color: string;
  position: number;
}

export interface ThresholdGradient {
  type: 'threshold'; threshold: number; width: number; lowColor: string; highColor: string;
}

export type MetricGradientSetting =
  | ThresholdGradient
  | { type: 'preset'; preset: GradientPresetId }
  | { type: 'custom'; id: string }
  | { type: 'draft'; name: string; stops: GradientStop[] };

export interface PaintSetting {
  enabled: boolean;
  color: string;
}

export type EdgeLineStyle = 'single' | 'double' | 'dashed';

export interface SavedGradient {
  id: string;
  metric: MetricMode;
  name: string;
  stops: GradientStop[];
}

export interface OrnamentalStyle {
  labelScale: number;
  vertexFill: PaintSetting;
  vertexOutline: PaintSetting;
  vertexSize: number;
  vertexOutlineWidth: number;
  verticesHidden: boolean;
  bondStyle: EdgeLineStyle;
  bondCasing: PaintSetting;
  bondCasingWidth: number;
  braceColor: string;
  braceStyle: EdgeLineStyle;
  bondWidth: number;
}

export interface SharedStyle { metricGradients: Record<MetricMode, MetricGradientSetting> }
export interface StudioStyle { shared: SharedStyle; view2d: OrnamentalStyle; view3d: OrnamentalStyle }
export type ViewStyle = OrnamentalStyle & SharedStyle;

export const STYLE_STORAGE_KEY = 'curvature-studio:style';
export const CUSTOM_GRADIENTS_STORAGE_KEY = 'curvature-studio:gradients';
export const DEFAULT_VERTEX_COLOR = '#2A2D31';
export const DEFAULT_VERTEX_OUTLINE_COLOR = '#FFFFFF';
export const DEFAULT_RIGID_COLOR = '#2A2D31';
export const DEFAULT_BOND_CASING_COLOR = '#FFFFFF';

export const DEFAULT_ORNAMENTAL_STYLE: OrnamentalStyle = {
  labelScale: 1,
  vertexFill: { enabled: true, color: DEFAULT_VERTEX_COLOR },
  vertexOutline: { enabled: true, color: DEFAULT_VERTEX_OUTLINE_COLOR },
  vertexSize: 4.5,
  vertexOutlineWidth: 1.5,
  verticesHidden: false,
  bondStyle: 'single',
  bondCasing: { enabled: false, color: DEFAULT_BOND_CASING_COLOR },
  bondCasingWidth: 1.5,
  braceColor: DEFAULT_RIGID_COLOR,
  braceStyle: 'double',
  bondWidth: 2
};

export const DEFAULT_SHARED_STYLE: SharedStyle = {
  metricGradients: {
    keff: { type: 'preset', preset: 'studio' },
    ollivier: { type: 'preset', preset: 'studio' }
  }
};

export const DEFAULT_STUDIO_STYLE: StudioStyle = {
  shared: DEFAULT_SHARED_STYLE,
  view2d: DEFAULT_ORNAMENTAL_STYLE,
  view3d: DEFAULT_ORNAMENTAL_STYLE
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!HEX_COLOR.test(trimmed)) return fallback;
  return trimmed.toUpperCase();
}

function normalizePaint(value: unknown, fallback: PaintSetting): PaintSetting {
  const raw = value as Partial<PaintSetting> | undefined;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    color: normalizeHexColor(raw?.color, fallback.color)
  };
}

export function normalizeGradientStops(metric: MetricMode, input: unknown): GradientStop[] {
  const raw = Array.isArray(input) ? input : [];
  const stops = raw
    .map((stop) => {
      const value = stop as Partial<GradientStop>;
      const color = normalizeHexColor(value.color, '');
      const position = Number(value.position);
      return color && Number.isFinite(position) ? { color, position: clamp(position, 0, 100) } : null;
    })
    .filter((stop): stop is GradientStop => Boolean(stop))
    .sort((a, b) => a.position - b.position);

  const minimum = metric === 'ollivier' ? 3 : 2;
  const limited = stops.slice(0, 6);
  if (metric === 'ollivier') {
    const withoutMiddle = limited.filter((stop) => Math.abs(stop.position - 50) > 0.0001);
    const middle = limited.find((stop) => Math.abs(stop.position - 50) <= 0.0001) ?? { position: 50, color: '#8A9098' };
    const next = [...withoutMiddle.slice(0, 5), { position: 50, color: middle.color }].sort((a, b) => a.position - b.position);
    while (next.length < minimum) {
      next.unshift({ position: 0, color: '#991B1B' });
      if (next.length < minimum) next.push({ position: 100, color: '#166534' });
    }
    return next.slice(0, 6);
  }
  while (limited.length < minimum) {
    limited.push(limited.length === 0 ? { position: 0, color: '#B91C1C' } : { position: 100, color: '#166534' });
  }
  return limited;
}

export function defaultCustomStops(metric: MetricMode): GradientStop[] {
  return metric === 'ollivier'
    ? [
        { position: 0, color: '#991B1B' },
        { position: 50, color: '#8A9098' },
        { position: 100, color: '#166534' }
      ]
    : [
        { position: 0, color: '#B91C1C' },
        { position: 50, color: '#B45309' },
        { position: 100, color: '#166534' }
      ];
}

function normalizeMetricGradient(metric: MetricMode, input: unknown): MetricGradientSetting {
  const value = input as Partial<MetricGradientSetting> | undefined;
  if (value?.type === 'preset') {
    const preset = value.preset;
    if (preset === 'studio' || preset === 'colorblind' || preset === 'viridis' || preset === 'coolwarm' || preset === 'grayscale') {
      return { type: 'preset', preset };
    }
  }
  if (value?.type === 'custom' && typeof value.id === 'string' && value.id.trim()) {
    return { type: 'custom', id: value.id };
  }
  if (value?.type === 'threshold') {
    const min = metric === 'ollivier' ? -1 : 0, span = 1 - min;
    if (typeof value.threshold !== 'number' || !Number.isFinite(value.threshold) || value.threshold < min || value.threshold > 1 ||
        typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width < 0 || value.width > span ||
        !normalizeHexColor(value.lowColor, '') || !normalizeHexColor(value.highColor, '')) throw new Error(`Invalid ${metric} color threshold or transition width`);
    return { type: 'threshold', threshold: value.threshold, width: value.width, lowColor: normalizeHexColor(value.lowColor, ''), highColor: normalizeHexColor(value.highColor, '') };
  }
  if (value?.type === 'draft') {
    return {
      type: 'draft',
      name: typeof value.name === 'string' ? value.name.slice(0, 60) : '',
      stops: normalizeGradientStops(metric, value.stops)
    };
  }
  return { type: 'preset', preset: 'studio' };
}

function normalizeEdgeLineStyle(value: unknown, fallback: EdgeLineStyle): EdgeLineStyle {
  return value === 'single' || value === 'double' || value === 'dashed' ? value : fallback;
}

function normalizeOrnamentalStyle(input: unknown): OrnamentalStyle {
  const value = input as Partial<OrnamentalStyle> | undefined;
  const legacy = input as { vertexColor?: unknown; rigidColor?: unknown } | undefined;
  return {
    labelScale: clamp(Number(value?.labelScale ?? DEFAULT_ORNAMENTAL_STYLE.labelScale), 0.7, 2),
    vertexFill: normalizePaint(value?.vertexFill ?? (legacy?.vertexColor ? { enabled: true, color: legacy.vertexColor } : undefined), DEFAULT_ORNAMENTAL_STYLE.vertexFill),
    vertexOutline: normalizePaint(value?.vertexOutline, DEFAULT_ORNAMENTAL_STYLE.vertexOutline),
    vertexSize: clamp(Number(value?.vertexSize ?? DEFAULT_ORNAMENTAL_STYLE.vertexSize), 2, 10),
    vertexOutlineWidth: clamp(Number(value?.vertexOutlineWidth ?? DEFAULT_ORNAMENTAL_STYLE.vertexOutlineWidth), 0, 4),
    verticesHidden: value?.verticesHidden === true,
    bondStyle: normalizeEdgeLineStyle(value?.bondStyle, DEFAULT_ORNAMENTAL_STYLE.bondStyle),
    bondCasing: normalizePaint(value?.bondCasing, DEFAULT_ORNAMENTAL_STYLE.bondCasing),
    bondCasingWidth: clamp(Number(value?.bondCasingWidth ?? DEFAULT_ORNAMENTAL_STYLE.bondCasingWidth), 0.5, 4),
    braceColor: normalizeHexColor(value?.braceColor ?? legacy?.rigidColor, DEFAULT_RIGID_COLOR),
    braceStyle: normalizeEdgeLineStyle(value?.braceStyle, DEFAULT_ORNAMENTAL_STYLE.braceStyle),
    bondWidth: clamp(Number(value?.bondWidth ?? DEFAULT_ORNAMENTAL_STYLE.bondWidth), 1, 4)
  };
}

export function normalizeStudioStyle(input: unknown, legacyColorblindSafe = false): StudioStyle {
  const value = input as { shared?: Partial<SharedStyle>; view2d?: unknown; view3d?: unknown; metricGradients?: Partial<Record<MetricMode, MetricGradientSetting>> } | undefined;
  const basePreset: MetricGradientSetting = legacyColorblindSafe ? { type: 'preset', preset: 'colorblind' } : { type: 'preset', preset: 'studio' };
  const isV2 = Boolean(value?.shared && value?.view2d && value?.view3d);
  const gradients = isV2 ? value?.shared?.metricGradients : value?.metricGradients;
  return {
    shared: { metricGradients: {
      keff: gradients ? normalizeMetricGradient('keff', gradients.keff) : basePreset,
      ollivier: gradients ? normalizeMetricGradient('ollivier', gradients.ollivier) : basePreset
    } },
    view2d: normalizeOrnamentalStyle(isV2 ? value?.view2d : input),
    view3d: normalizeOrnamentalStyle(isV2 ? value?.view3d : input)
  };
}

export function styleForView(style: StudioStyle, view: '2d' | '3d'): ViewStyle {
  return { ...(view === '2d' ? style.view2d : style.view3d), ...style.shared };
}

export function loadStudioStyle(legacyColorblindSafe = false): StudioStyle {
  try {
    const raw = localStorage.getItem(STYLE_STORAGE_KEY);
    return normalizeStudioStyle(raw ? JSON.parse(raw) : undefined, legacyColorblindSafe);
  } catch {
    return normalizeStudioStyle(undefined, legacyColorblindSafe);
  }
}

export function saveStudioStyle(style: StudioStyle): void {
  storePreference(STYLE_STORAGE_KEY, JSON.stringify(normalizeStudioStyle(style)));
}

export function normalizeSavedGradients(input: unknown): SavedGradient[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const value = item as Partial<SavedGradient>;
      const metric = value.metric === 'ollivier' ? 'ollivier' : value.metric === 'keff' ? 'keff' : null;
      if (!metric || typeof value.id !== 'string' || !value.id.trim()) return null;
      return {
        id: value.id,
        metric,
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'Custom gradient',
        stops: normalizeGradientStops(metric, value.stops)
      };
    })
    .filter((item): item is SavedGradient => Boolean(item));
}

export function loadCustomGradients(): SavedGradient[] {
  try {
    const raw = localStorage.getItem(CUSTOM_GRADIENTS_STORAGE_KEY);
    return normalizeSavedGradients(raw ? JSON.parse(raw) : undefined);
  } catch {
    return [];
  }
}

export function saveCustomGradients(gradients: SavedGradient[]): void {
  storePreference(CUSTOM_GRADIENTS_STORAGE_KEY, JSON.stringify(normalizeSavedGradients(gradients)));
}
