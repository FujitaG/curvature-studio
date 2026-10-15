export const tokens = {
  white: '#FFFFFF',
  canvas: '#FAFAF7',
  panel: 'rgba(255,255,255,0.92)',
  control: 'rgba(255,255,255,0.84)',
  segmentPanel: 'rgba(255,255,255,0.86)',
  stickyPanel: 'rgba(255,255,255,0.94)',
  border: '#E7E5E0',
  shadow: '0 4px 24px rgba(20,20,17,0.08)',
  ink900: '#1C1E21',
  ink800: '#2A2D31',
  ink700: '#4B5057',
  ink500: '#8A9098',
  neutral400: '#C9CCCF',
  accent: '#4A6FE3',
  accentWash: 'rgba(74,111,227,0.08)',
  accentSoft: '#CFD7F6',
  spinnerTrack: '#D9DDE8',
  backdrop: 'rgba(28,30,33,0.16)',
  warning: '#D97706',
  warningBorder: 'rgba(217,119,6,0.34)',
  warningInk: '#8A4B04',
  warningWash: 'rgba(255,247,237,0.94)'
} as const;

type MetricName = 'ollivier' | 'keff';
type GradientPresetId = 'studio' | 'colorblind' | 'viridis' | 'coolwarm' | 'grayscale';
type GradientStopLike = { color: string; position: number };
type MetricGradientSettingLike =
  | { type: 'threshold'; threshold: number; width: number; lowColor: string; highColor: string }
  | { type: 'preset'; preset: GradientPresetId }
  | { type: 'custom'; id: string }
  | { type: 'draft'; name?: string; stops: GradientStopLike[] };
type StyleResolutionLike = {
  metricGradients?: Partial<Record<MetricName, MetricGradientSettingLike>>;
};
type SavedGradientLike = {
  id: string;
  metric: MetricName;
  stops: GradientStopLike[];
};

function cssVarName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).replace(/([a-z])([0-9])/g, '$1-$2')}`;
}

export function applyCssTokenVariables(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(cssVarName(key), value);
  }
}

type Rgb = [number, number, number];
type Oklab = [number, number, number];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ];
}

function srgbToLinear(x: number): number {
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

function rgbToOklab(rgb: Rgb): Oklab {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function oklabToRgb(lab: Oklab): Rgb {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2];
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    clamp01(linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))
  ];
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(clamp01(channel) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function mixOklab(a: string, b: string, t: number): string {
  const left = rgbToOklab(hexToRgb(a));
  const right = rgbToOklab(hexToRgb(b));
  const lab: Oklab = [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t
  ];
  return rgbToHex(oklabToRgb(lab));
}

function sequentialScale(value: number, anchors: Array<[number, string]>): string {
  const t = clamp01(value);
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [ta, ca] = anchors[i];
    const [tb, cb] = anchors[i + 1];
    if (t >= ta && t <= tb) return mixOklab(ca, cb, (t - ta) / (tb - ta));
  }
  return anchors.at(-1)?.[1] ?? tokens.ink500;
}

function studioMetricColor(metric: MetricName, value: number, colorblindSafe: boolean): string {
  if (!Number.isFinite(value)) return tokens.neutral400;
  if (metric === 'ollivier') {
    const t = Math.max(-1, Math.min(1, value));
    const neutral = tokens.ink500;
    if (colorblindSafe) {
      if (t < 0) return mixOklab(neutral, '#8C510A', Math.abs(t) ** 0.8);
      return mixOklab(neutral, '#01665E', t ** 0.8);
    }
    if (t < 0) return mixOklab(neutral, '#991B1B', Math.abs(t) ** 0.8);
    return mixOklab(neutral, '#166534', t ** 0.8);
  }
  if (colorblindSafe) {
    return sequentialScale(value, [
      [0, '#00204D'],
      [0.25, '#31446B'],
      [0.5, '#666870'],
      [0.75, '#8E834D'],
      [1, '#B5A036']
    ]);
  }
  return sequentialScale(value, [
    [0, '#B91C1C'],
    [0.25, '#C2410C'],
    [0.5, '#B45309'],
    [0.75, '#4D7C0F'],
    [1, '#166534']
  ]);
}

// Published colormap stops sampled from Matplotlib's viridis/coolwarm reference maps;
// grayscale is a linear neutral ramp. The original Studio OKLab anchors above stay
// untouched and remain the default preset.
const VIRIDIS_STOPS: GradientStopLike[] = [
  { position: 0, color: '#440154' },
  { position: 25, color: '#3B528B' },
  { position: 50, color: '#21918C' },
  { position: 75, color: '#5EC962' },
  { position: 100, color: '#FDE725' }
];

const COOL_WARM_STOPS: GradientStopLike[] = [
  { position: 0, color: '#3B4CC0' },
  { position: 25, color: '#8DB0FE' },
  { position: 50, color: '#DDDDDD' },
  { position: 75, color: '#F4987A' },
  { position: 100, color: '#B40426' }
];

const GRAYSCALE_STOPS: GradientStopLike[] = [
  { position: 0, color: '#222222' },
  { position: 50, color: '#8A9098' },
  { position: 100, color: '#EEEEEE' }
];

function metricPosition(metric: MetricName, value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return metric === 'ollivier' ? clamp01((Math.max(-1, Math.min(1, value)) + 1) / 2) : clamp01(value);
}

function colorFromStops(metric: MetricName, value: number, stops: GradientStopLike[]): string {
  const t = metricPosition(metric, value);
  if (!Number.isFinite(t)) return tokens.neutral400;
  const normalized = stops
    .filter((stop) => isHexColor(stop.color) && Number.isFinite(stop.position))
    .map((stop) => [clamp01(stop.position / 100), stop.color] as [number, string])
    .sort((a, b) => a[0] - b[0]);
  if (normalized.length === 0) return tokens.neutral400;
  if (normalized.length === 1) return normalized[0][1];
  return sequentialScale(t, normalized);
}

function customStops(setting: MetricGradientSettingLike, metric: MetricName, customGradients: SavedGradientLike[]): GradientStopLike[] | null {
  if (setting.type === 'draft') return setting.stops;
  if (setting.type !== 'custom') return null;
  const saved = customGradients.find((gradient) => gradient.id === setting.id && gradient.metric === metric);
  return saved?.stops ?? null;
}

export function metricColor(
  metric: MetricName,
  value: number,
  colorblindSafe: boolean,
  style?: StyleResolutionLike,
  customGradients: SavedGradientLike[] = []
): string {
  const setting = style?.metricGradients?.[metric];
  if (!setting) return studioMetricColor(metric, value, colorblindSafe);
  if (setting.type === 'threshold') {
    if (!Number.isFinite(value)) return tokens.neutral400;
    if (setting.width === 0) return value < setting.threshold ? setting.lowColor : setting.highColor;
    const blend = clamp01((value - setting.threshold) / setting.width + 0.5);
    if (blend === 0) return setting.lowColor;
    if (blend === 1) return setting.highColor;
    return mixOklab(setting.lowColor, setting.highColor, blend);
  }
  if (setting.type === 'preset') {
    if (setting.preset === 'studio') return studioMetricColor(metric, value, false);
    if (setting.preset === 'colorblind') return studioMetricColor(metric, value, true);
    if (setting.preset === 'viridis') return colorFromStops(metric, value, VIRIDIS_STOPS);
    if (setting.preset === 'coolwarm') return colorFromStops(metric, value, COOL_WARM_STOPS);
    if (setting.preset === 'grayscale') return colorFromStops(metric, value, GRAYSCALE_STOPS);
  }
  const stops = customStops(setting, metric, customGradients);
  return stops ? colorFromStops(metric, value, stops) : studioMetricColor(metric, value, colorblindSafe);
}

export function neutralizedRigidColor(rigidColor: string): string {
  return isHexColor(rigidColor) ? mixOklab(rigidColor, tokens.neutral400, 0.4) : tokens.neutral400;
}

export function metricLabel(metric: MetricName, value: number): string {
  if (!Number.isFinite(value)) return '';
  if (metric === 'ollivier') {
    if (Math.abs(value) < 0.005) return '0';
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  }
  return value.toFixed(2);
}

export function labelColor(scaleColor: string): string {
  if (!scaleColor.startsWith('#')) return tokens.ink700;
  const lab = rgbToOklab(hexToRgb(scaleColor));
  const floor = rgbToOklab(hexToRgb(tokens.ink700));
  const darkened: Oklab = [Math.min(lab[0] * 0.75, floor[0]), lab[1], lab[2]];
  return rgbToHex(oklabToRgb(darkened));
}
