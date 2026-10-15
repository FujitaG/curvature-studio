import { actualFigureLabelSizePt, DEFAULT_FIGURE, MM_TO_PX, parseFigure, type FigureSettings } from './figure';
import { labelColor, metricColor, neutralizedRigidColor, tokens } from '../design/tokens';
import type { MetricResult } from '../math';
import { edgeArray, vertexArray } from '../state/history';
import type { SavedGradient, ViewStyle } from '../state/style';
import type { Doc, MetricMode } from '../state/types';

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function line(x1: number, y1: number, x2: number, y2: number, attrs: string): string {
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ${attrs}/>`;
}

function compact(value: number): string {
  return String(Number(value.toFixed(2)));
}

function dashPattern(width: number): string {
  return `${compact(3 * width)} ${compact(1.5 * width)}`;
}

export function renderDocumentSvg(
  doc: Doc,
  results: MetricResult | null,
  metric: MetricMode,
  colorblindSafe: boolean,
  style?: ViewStyle,
  customGradients: SavedGradient[] = [],
  labelsVisible = true,
  figure: FigureSettings = DEFAULT_FIGURE
): string {
  const vertices = vertexArray(doc);
  const edges = edgeArray(doc);
  const setup = parseFigure(figure);
  const width = setup.widthMm * MM_TO_PX, height = setup.heightMm * MM_TO_PX;
  const labelSize = actualFigureLabelSizePt(setup.labelSizePt, style?.labelScale ?? 1) * 96 / 72;
  const formatValue = (value: NonNullable<MetricResult>['values'][number]): string => {
    if (metric === 'ollivier' && setup.labels === 'fraction') return `${value.ollivierFrac[0]}/${value.ollivierFrac[1]}`;
    const n = metric === 'keff' ? value.kEff : value.ollivier;
    if (!Number.isFinite(n)) return '';
    const rounded = Number(n.toFixed(setup.decimals));
    return `${metric === 'ollivier' && rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : n).toFixed(setup.decimals)}`;
  };
  const showLabels = labelsVisible && setup.labels !== 'hidden';
  const labelLength = showLabels ? Math.max(0, ...(results?.values ?? []).map(v => formatValue(v).length)) : 0;
  // Reserve space for glyphs and strokes after projection; these never scale with world units.
  const ink = Math.max((style?.vertexSize ?? 4.5) + (style?.vertexOutlineWidth ?? 1.5),
    (style?.bondWidth ?? 2) * 2 + (style?.bondCasingWidth ?? 1.5), labelLength ? labelSize * (labelLength * 0.65 + 1) : 0);
  const margin = setup.paddingMm * MM_TO_PX + ink;
  if (margin * 2 >= Math.min(width, height)) throw new Error('The figure is too small for these margins and labels. Increase its size or reduce margins / label size.');
  const minX = vertices.length ? Math.min(...vertices.map(v => v.x)) : 0;
  const maxX = vertices.length ? Math.max(...vertices.map(v => v.x)) : 0;
  const minY = vertices.length ? Math.min(...vertices.map(v => v.y)) : 0;
  const maxY = vertices.length ? Math.max(...vertices.map(v => v.y)) : 0;
  const frame = setup.range === 'current' ? setup.frame! : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const usableWidth = width - margin * 2, usableHeight = height - margin * 2;
  const scale = Math.min(frame.width > 0 ? usableWidth / frame.width : Infinity, frame.height > 0 ? usableHeight / frame.height : Infinity);
  const actualScale = Number.isFinite(scale) ? scale : 1;
  const sx = (x: number) => width / 2 + (x - frame.x - frame.width / 2) * actualScale;
  const sy = (y: number) => height / 2 + (y - frame.y - frame.height / 2) * actualScale;
  const vertexById = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const body: string[] = [];
  const vertexFill = style?.vertexFill ?? { enabled: true, color: tokens.ink800 };
  const vertexOutline = style?.vertexOutline ?? { enabled: true, color: tokens.white };
  const verticesHidden = style?.verticesHidden ?? false;
  const vertexSize = style?.vertexSize ?? 4.5;
  const vertexOutlineWidth = style?.vertexOutlineWidth ?? 1.5;
  const bondStyle = style?.bondStyle ?? 'single';
  const braceColor = style?.braceColor ?? tokens.ink800;
  const braceStyle = style?.braceStyle ?? 'double';
  const bondCasing = style?.bondCasing ?? { enabled: false, color: tokens.white };
  const bondCasingWidth = style?.bondCasingWidth ?? 1.5;
  const intraColor = braceColor === tokens.ink800 ? tokens.neutral400 : neutralizedRigidColor(braceColor);
  const bondWidth = style?.bondWidth ?? 2;

  if (setup.background === 'white') body.push(`<rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" fill="white"/>`);
  // Current range intentionally crops content outside the captured world rectangle.
  if (setup.range === 'current') body.push(`<defs><clipPath id="figure-range"><rect x="${sx(frame.x)}" y="${sy(frame.y)}" width="${frame.width * actualScale}" height="${frame.height * actualScale}"/></clipPath></defs><g clip-path="url(#figure-range)">`);

  for (const edge of edges) {
    const a = vertexById.get(edge.a);
    const b = vertexById.get(edge.b);
    if (!a || !b) continue;
    const x1 = sx(a.x);
    const y1 = sy(a.y);
    const x2 = sx(b.x);
    const y2 = sy(b.y);
    const mapped = results?.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    const metricValue = value ? (metric === 'keff' ? value.kEff : value.ollivier) : Number.NaN;
    const color = edge.kind === 'bond' && mapped !== 'intra' ? metricColor(metric, metricValue, colorblindSafe, style, customGradients) : intraColor;
    if (edge.kind === 'brace') {
      if (braceStyle === 'single' || braceStyle === 'dashed') {
        body.push(line(x1, y1, x2, y2, `stroke="${braceColor}" stroke-width="${compact(bondWidth)}" stroke-linecap="round"${braceStyle === 'dashed' ? ` stroke-dasharray="${dashPattern(bondWidth)}"` : ''}`));
      } else {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const gap = (bondWidth / 2) * 1.6;
        const nx = (-dy / len) * gap;
        const ny = (dx / len) * gap;
        body.push(line(x1 + nx, y1 + ny, x2 + nx, y2 + ny, `stroke="${braceColor}" stroke-width="${compact(bondWidth * 0.75)}" stroke-linecap="round"`));
        body.push(line(x1 - nx, y1 - ny, x2 - nx, y2 - ny, `stroke="${braceColor}" stroke-width="${compact(bondWidth * 0.75)}" stroke-linecap="round"`));
      }
    } else {
      const dash = mapped === 'intra' || bondStyle === 'dashed' ? ` stroke-dasharray="${dashPattern(bondWidth)}"` : '';
      if (bondStyle === 'double' && mapped !== 'intra') {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const gap = (bondWidth / 2) * 1.6;
        const nx = (-dy / len) * gap;
        const ny = (dx / len) * gap;
        const lineWidth = bondWidth * 0.75;
        if (bondCasing.enabled) {
          const casingWidth = compact(lineWidth + bondCasingWidth * 2);
          body.push(line(x1 + nx, y1 + ny, x2 + nx, y2 + ny, `stroke="${bondCasing.color}" stroke-width="${casingWidth}" stroke-linecap="round"`));
          body.push(line(x1 - nx, y1 - ny, x2 - nx, y2 - ny, `stroke="${bondCasing.color}" stroke-width="${casingWidth}" stroke-linecap="round"`));
        }
        body.push(line(x1 + nx, y1 + ny, x2 + nx, y2 + ny, `stroke="${color}" stroke-width="${compact(lineWidth)}" stroke-linecap="round"`));
        body.push(line(x1 - nx, y1 - ny, x2 - nx, y2 - ny, `stroke="${color}" stroke-width="${compact(lineWidth)}" stroke-linecap="round"`));
      } else {
        if (bondCasing.enabled && mapped !== 'intra') {
          body.push(line(x1, y1, x2, y2, `stroke="${bondCasing.color}" stroke-width="${compact(bondWidth + bondCasingWidth * 2)}" stroke-linecap="round"${dash}`));
        }
        body.push(line(x1, y1, x2, y2, `stroke="${color}" stroke-width="${compact(bondWidth)}" stroke-linecap="round"${dash}`));
      }
    }
  }

  for (const edge of edges) {
    const a = vertexById.get(edge.a);
    const b = vertexById.get(edge.b);
    const mapped = results?.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    if (!showLabels || !a || !b || edge.kind !== 'bond' || !value) continue;
    const x1 = sx(a.x);
    const y1 = sy(a.y);
    const x2 = sx(b.x);
    const y2 = sy(b.y);
    const metricValue = metric === 'keff' ? value.kEff : value.ollivier;
    const color = labelColor(metricColor(metric, metricValue, colorblindSafe, style, customGradients));
    let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    if (angle > 90 || angle <= -90) angle += 180;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const x = (x1 + x2) / 2 + nx * labelSize * 0.8;
    const y = (y1 + y2) / 2 + ny * labelSize * 0.8;
    body.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${angle.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})" fill="${color}" stroke="white" stroke-width="2.5" paint-order="stroke" font-family="${setup.font}" font-size="${compact(labelSize)}" font-variant-numeric="tabular-nums">${escapeXml(formatValue(value))}</text>`);
  }

  if (!verticesHidden) {
    for (const vertex of vertices) {
      const fill = vertexFill.enabled ? vertexFill.color : 'none';
      const outlineVisible = vertexOutline.enabled && vertexOutlineWidth > 0;
      const stroke = outlineVisible ? (vertexOutline.color === tokens.white ? 'white' : vertexOutline.color) : 'none';
      const strokeWidth = outlineVisible ? compact(vertexOutlineWidth) : '0';
      body.push(`<circle cx="${sx(vertex.x).toFixed(2)}" cy="${sy(vertex.y).toFixed(2)}" r="${compact(vertexSize)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
    }
  }

  if (setup.range === 'current') body.push('</g>');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${setup.widthMm}mm" height="${setup.heightMm}mm" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">${body.join('')}</svg>`;
}
