import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../../math';
import { docFromArrays } from '../../state/persistence';
import { DEFAULT_STUDIO_STYLE, styleForView } from '../../state/style';
import { parseProjectJson, projectToJson, serializeProject } from '../../project/format';
import { captureProject, applyProject } from '../../project/workspace';
import { useProjectStore } from '../../project/store';
import { DEFAULT_FIGURE, actualFigureLabelSizePt, captureFigureFrame, figurePixels, parseFigure } from '../figure';
import { renderDocumentSvg } from '../svg';
import example from '../../../examples/cube-study.curvature.json';

const graph = (size: number) => docFromArrays([{ id: 1, x: 0, y: 0 }, { id: 2, x: size, y: 0 }], [{ id: 1, a: 1, b: 2, kind: 'bond' }]);
const render = (size: number, settings = DEFAULT_FIGURE) => {
  const doc = graph(size);
  const before = structuredClone(doc);
  const svg = renderDocumentSvg(doc, computeMetrics([...doc.vertices.values()], [...doc.edges.values()]), 'ollivier', false, { ...styleForView(DEFAULT_STUDIO_STYLE, '2d'), labelScale: 2 }, [], true, settings);
  expect(doc).toEqual(before);
  return svg;
};
const xml = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');
describe('paper figure export', () => {
  it('reports the same final point size used for SVG labels', () => {
    expect(actualFigureLabelSizePt(7.875, 2)).toBe(15.75);
    expect(Number(xml(render(5)).querySelector('text')!.getAttribute('font-size')) * 72 / 96).toBe(15.75);
  });
  it('projects similar graphs to identical paper geometry, independently of coordinate units', () => {
    const reference = render(1);
    for (const scale of [0.1, 5, 100, 1000]) expect(render(scale)).toBe(reference);
    const output = xml(reference), circles = [...output.querySelectorAll('circle')];
    const distance = Number(circles[1].getAttribute('cx')) - Number(circles[0].getAttribute('cx'));
    expect(distance).toBeGreaterThan(150);
    expect(circles.map(c => Number(c.getAttribute('r')))).toEqual([4.5, 4.5]);
    expect(output.querySelector('text')?.getAttribute('font-size')).toBe('21');
    expect(output.documentElement.getAttribute('width')).toBe('120mm');
  });
  it('keeps all fitted vertex outlines and rotated labels inside the frame for a vertical and diagonal edge', () => {
    for (const [x, y] of [[0, 0.1], [0.1, 0.1], [0, 0]]) {
      const doc = graph(0.1); doc.vertices.set(2, { id: 2, x, y });
      const result = computeMetrics([...doc.vertices.values()], [...doc.edges.values()]);
      const svg = xml(renderDocumentSvg(doc, result, 'ollivier', false));
      const [, , w, h] = svg.documentElement.getAttribute('viewBox')!.split(' ').map(Number);
      for (const circle of svg.querySelectorAll('circle')) {
        expect(Number(circle.getAttribute('cx'))).toBeGreaterThan(5);
        expect(Number(circle.getAttribute('cx'))).toBeLessThan(w - 5);
        expect(Number(circle.getAttribute('cy'))).toBeGreaterThan(5);
        expect(Number(circle.getAttribute('cy'))).toBeLessThan(h - 5);
      }
      expect(svg.querySelector('text')?.textContent).toBe('+1.00');
    }
  });
  it('supports physical PNG sizing, transparency, exact fractions, hidden labels and escaped safe fonts', () => {
    expect(figurePixels(DEFAULT_FIGURE)).toEqual({ width: 1417, height: 1063 });
    const transparent = xml(render(1, { ...DEFAULT_FIGURE, background: 'transparent', labels: 'fraction', font: 'serif' }));
    expect(transparent.querySelector('rect')).toBeNull();
    expect(transparent.querySelector('text')?.textContent).toBe('1/1');
    expect(transparent.querySelector('text')?.getAttribute('font-family')).toBe('serif');
    expect(xml(render(1, { ...DEFAULT_FIGURE, labels: 'hidden' })).querySelector('text')).toBeNull();
    expect(xml(render(1, { ...DEFAULT_FIGURE, decimals: 4 })).querySelector('text')?.textContent).toBe('+1.0000');
  });
  it('records a world range and explicitly clips current-range exports', () => {
    const frame = captureFigureFrame({ tx: 100, ty: 50, scale: 10 }, { x: 120, y: 90, width: 200, height: 100 });
    expect(frame).toEqual({ x: 2, y: 4, width: 20, height: 10 });
    const svg = xml(render(5, { ...DEFAULT_FIGURE, range: 'current', frame }));
    expect(svg.querySelector('g')?.getAttribute('clip-path')).toBe('url(#figure-range)');
    expect(svg.querySelector('clipPath rect')).not.toBeNull();
  });
  it('rejects unsafe raster sizes and malformed saved settings without silent shrinking', () => {
    for (const patch of [{ widthMm: 500, heightMm: 500, dpi: 600 }, { dpi: 0 }, { dpi: 72.5 }, { decimals: 1.5 }, { paddingMm: 60 }, { range: 'current' }, { widthMm: NaN }, { font: '<script>' }, { frame: { x: 0, y: 0, width: 0, height: 20 } }]) {
      expect(() => parseFigure({ ...DEFAULT_FIGURE, ...patch })).toThrow();
    }
    expect(() => render(1, { ...DEFAULT_FIGURE, widthMm: 20, heightMm: 20 })).toThrow(/too small/);
  });
  it('round-trips figure settings including a captured range while keeping older files unchanged', () => {
    expect(projectToJson(parseProjectJson(example))).toEqual(example);
    applyProject(parseProjectJson(example), false);
    expect(useProjectStore.getState().figure).toEqual(DEFAULT_FIGURE);
    const figure = { ...DEFAULT_FIGURE, range: 'current' as const, frame: { x: -2, y: -3, width: 8, height: 6 }, background: 'transparent' as const, labelSizePt: 9, decimals: 4 };
    useProjectStore.getState().setFigure(figure);
    const saved = JSON.parse(serializeProject(captureProject()));
    expect(saved.figure).toEqual(figure);
    applyProject(parseProjectJson(example), false);
    applyProject(parseProjectJson(saved), false);
    expect(useProjectStore.getState().figure).toEqual(figure);
    expect(() => parseProjectJson({ ...saved, figure: { ...figure, dpi: 100000 } })).toThrow();
  });
});
