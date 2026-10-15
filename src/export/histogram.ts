import { metricColor, tokens } from '../design/tokens';
import { strings } from '../strings';
import type { SavedGradient, SharedStyle } from '../state/style';
import type { MetricMode } from '../state/types';

export const HISTOGRAM_BIN_COUNT = 25;
export const HISTOGRAM_SCREEN_SIZE = { width: 232, height: 126 } as const;
export const HISTOGRAM_EXPORT_SIZE = { width: 560, height: 320 } as const;

export interface HistogramBar {
  count: number;
  color: string;
  center: number;
  min: number;
  max: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HistogramTick {
  label: string;
  strong: boolean;
  value: number;
  x: number;
}

export interface HistogramMarker {
  label: string;
  points: string;
  value: number;
  x: number;
}

export interface HistogramFigure {
  axisY: number;
  bars: HistogramBar[];
  domainMax: number;
  domainMin: number;
  height: number;
  max: number;
  maxBin: number;
  min: number;
  n: number;
  plotHeight: number;
  plotWidth: number;
  plotX: number;
  plotY: number;
  spread: number;
  subtitle: string;
  ticks: HistogramTick[];
  markers: HistogramMarker[];
  title: string;
  width: number;
}

interface HistogramOptions {
  height?: number;
  includeTitle?: boolean;
  title?: string;
  width?: number;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function svgTitleMarkup(title: string, metric: MetricMode): string {
  if (metric !== 'keff') return escapeXml(title);
  const marker = 'κ_eff';
  const index = title.indexOf(marker);
  if (index < 0) return escapeXml(title);
  return `${escapeXml(title.slice(0, index))}κ<tspan baseline-shift="sub" font-size="70%">eff</tspan>${escapeXml(title.slice(index + marker.length))}`;
}

function metricTitle(metric: MetricMode): string {
  return metric === 'keff' ? strings.effectiveLong : strings.ollivierLong;
}

function domain(metric: MetricMode): { min: number; max: number } {
  return metric === 'keff' ? { min: 0, max: 1 } : { min: -1, max: 1 };
}

function tickValues(metric: MetricMode): number[] {
  return metric === 'keff' ? [0, 0.25, 0.5, 0.75, 1] : [-1, -0.5, 0, 0.5, 1];
}

function formatTick(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0$/, '');
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function xForValue(value: number, domainMin: number, domainMax: number, plotX: number, plotWidth: number): number {
  const t = (value - domainMin) / (domainMax - domainMin);
  return plotX + Math.max(0, Math.min(1, t)) * plotWidth;
}

function markerPoints(x: number, y: number): string {
  return `${x.toFixed(2)},${(y + 6).toFixed(2)} ${(x - 4).toFixed(2)},${(y + 13).toFixed(2)} ${(x + 4).toFixed(2)},${(y + 13).toFixed(2)}`;
}

export function buildHistogramFigure(
  rawValues: number[],
  metric: MetricMode,
  colorblindSafe: boolean,
  style?: SharedStyle,
  customGradients: SavedGradient[] = [],
  options: HistogramOptions = {}
): HistogramFigure {
  const includeTitle = options.includeTitle ?? Boolean(options.title);
  const width = options.width ?? (includeTitle ? HISTOGRAM_EXPORT_SIZE.width : HISTOGRAM_SCREEN_SIZE.width);
  const height = options.height ?? (includeTitle ? HISTOGRAM_EXPORT_SIZE.height : HISTOGRAM_SCREEN_SIZE.height);
  const values = rawValues.filter(Number.isFinite);
  const { min: domainMin, max: domainMax } = domain(metric);
  const counts = Array.from({ length: HISTOGRAM_BIN_COUNT }, () => 0);
  for (const value of values) {
    const t = Math.max(0, Math.min(0.999999, (value - domainMin) / (domainMax - domainMin)));
    counts[Math.floor(t * HISTOGRAM_BIN_COUNT)] += 1;
  }

  const n = values.length;
  const min = n ? Math.min(...values) : Number.NaN;
  const max = n ? Math.max(...values) : Number.NaN;
  const spread = n ? max - min : Number.NaN;
  const maxBin = Math.max(1, ...counts);
  const plotX = includeTitle ? 24 : 0;
  const plotY = includeTitle ? 88 : 8;
  const axisY = includeTitle ? height - 56 : height - 30;
  const plotWidth = width - plotX * 2;
  const plotHeight = Math.max(1, axisY - plotY);
  const gap = 1;
  const barWidth = (plotWidth - (HISTOGRAM_BIN_COUNT - 1) * gap) / HISTOGRAM_BIN_COUNT;

  const bars = counts.map((count, index): HistogramBar => {
    const binMin = domainMin + (index / HISTOGRAM_BIN_COUNT) * (domainMax - domainMin);
    const binMax = domainMin + ((index + 1) / HISTOGRAM_BIN_COUNT) * (domainMax - domainMin);
    const center = domainMin + ((index + 0.5) / HISTOGRAM_BIN_COUNT) * (domainMax - domainMin);
    const barHeight = count === 0 ? 0 : Math.max(1, (count / maxBin) * plotHeight);
    return {
      count,
      color: metricColor(metric, center, colorblindSafe, style, customGradients),
      center,
      min: binMin,
      max: binMax,
      x: plotX + index * (barWidth + gap),
      y: axisY - barHeight,
      width: barWidth,
      height: barHeight
    };
  });

  const ticks = tickValues(metric).map((value): HistogramTick => ({
    label: formatTick(value),
    strong: Math.abs(value) < 1e-9,
    value,
    x: xForValue(value, domainMin, domainMax, plotX, plotWidth)
  }));

  const markers: HistogramMarker[] = [];
  if (Number.isFinite(min)) {
    const x = xForValue(min, domainMin, domainMax, plotX, plotWidth);
    markers.push({ label: `min ${formatValue(min)}`, points: markerPoints(x, axisY), value: min, x });
  }
  if (Number.isFinite(max)) {
    const x = xForValue(max, domainMin, domainMax, plotX, plotWidth);
    markers.push({ label: `max ${formatValue(max)}`, points: markerPoints(x, axisY), value: max, x });
  }

  return {
    axisY,
    bars,
    domainMax,
    domainMin,
    height,
    max,
    maxBin,
    min,
    n,
    plotHeight,
    plotWidth,
    plotX,
    plotY,
    spread,
    subtitle: n ? `n = ${n} bonds · min ${formatValue(min)} · max ${formatValue(max)} · spread ${formatValue(spread)}` : 'n = 0 bonds',
    ticks,
    markers,
    title: options.title ?? metricTitle(metric),
    width
  };
}

export function renderHistogramSvg(
  values: number[],
  metric: MetricMode,
  colorblindSafe: boolean,
  style?: SharedStyle,
  customGradients: SavedGradient[] = [],
  options: HistogramOptions = {}
): string {
  const figure = buildHistogramFigure(values, metric, colorblindSafe, style, customGradients, { ...options, includeTitle: options.includeTitle ?? true });
  const body: string[] = [
    `<rect width="${figure.width}" height="${figure.height}" fill="${tokens.white}"/>`
  ];

  if (options.includeTitle ?? true) {
    body.push(`<text x="24" y="30" fill="${tokens.ink900}" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="13" font-weight="650">${svgTitleMarkup(figure.title, metric)}</text>`);
    body.push(`<text x="24" y="48" fill="${tokens.ink500}" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="10" font-variant-numeric="tabular-nums">${escapeXml(figure.subtitle)}</text>`);
  }

  for (const bar of figure.bars) {
    body.push(`<rect x="${bar.x.toFixed(2)}" y="${bar.y.toFixed(2)}" width="${bar.width.toFixed(2)}" height="${bar.height.toFixed(2)}" fill="${bar.color}"/>`);
  }
  body.push(`<line x1="${figure.plotX.toFixed(2)}" y1="${figure.axisY.toFixed(2)}" x2="${(figure.plotX + figure.plotWidth).toFixed(2)}" y2="${figure.axisY.toFixed(2)}" stroke="${tokens.border}" stroke-width="1"/>`);
  for (const tick of figure.ticks) {
    body.push(`<line x1="${tick.x.toFixed(2)}" y1="${figure.axisY.toFixed(2)}" x2="${tick.x.toFixed(2)}" y2="${(figure.axisY + (tick.strong ? 8 : 5)).toFixed(2)}" stroke="${tick.strong ? tokens.ink700 : tokens.border}" stroke-width="${tick.strong ? 1.25 : 1}"/>`);
    body.push(`<text x="${tick.x.toFixed(2)}" y="${(figure.axisY + 24).toFixed(2)}" text-anchor="middle" fill="${tokens.ink500}" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="10" font-variant-numeric="tabular-nums">${escapeXml(tick.label)}</text>`);
  }
  for (const marker of figure.markers) {
    body.push(`<polygon points="${marker.points}" fill="${tokens.ink500}"><title>${escapeXml(marker.label)}</title></polygon>`);
  }
  body.push(`<text x="${(figure.plotX + figure.plotWidth - 4).toFixed(2)}" y="${(figure.plotY + 10).toFixed(2)}" text-anchor="end" fill="${tokens.ink500}" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="9" font-variant-numeric="tabular-nums">max bin = ${figure.maxBin}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${figure.width}" height="${figure.height}" viewBox="0 0 ${figure.width} ${figure.height}">${body.join('')}</svg>`;
}
