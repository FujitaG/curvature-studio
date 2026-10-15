import { describe, expect, it } from 'vitest';
import { metricColor, tokens } from '../tokens';
import { DEFAULT_STUDIO_STYLE, normalizeStudioStyle, styleForView, type ThresholdGradient } from '../../state/style';
import { parseProjectJson, projectToJson } from '../../project/format';
import { computeMetrics } from '../../math';
import { renderDocumentSvg } from '../../export/svg';
import example from '../../../examples/cube-study.curvature.json';
const threshold: ThresholdGradient = { type: 'threshold', threshold: 0.5, width: 0.2, lowColor: '#0000FF', highColor: '#FF0000' };
const style = (setting = threshold) => ({ metricGradients: { keff: setting, ollivier: setting } });
describe('curvature color thresholds', () => {
  it('defines a hard cutoff precisely and preserves pending / nonfinite colors', () => {
    const setting = { ...threshold, width: 0 };
    expect(metricColor('keff', 0.5 - 1e-10, false, style(setting))).toBe('#0000FF');
    expect(metricColor('keff', 0.5, false, style(setting))).toBe('#FF0000');
    expect(metricColor('keff', 0.5 + 1e-10, false, style(setting))).toBe('#FF0000');
    for (const value of [NaN, Infinity, -Infinity]) expect(metricColor('keff', value, false, style(setting))).toBe(tokens.neutral400);
    const signed = { ...setting, threshold: -0.25 };
    expect(metricColor('ollivier', -0.3, false, style(signed))).toBe('#0000FF');
    expect(metricColor('ollivier', -0.25, false, style(signed))).toBe('#FF0000');
  });
  it('centers a continuous transition on a curvature value, with constant tails', () => {
    expect(metricColor('keff', 0.39, false, style())).toBe('#0000FF');
    expect(metricColor('keff', 0.61, false, style())).toBe('#FF0000');
    const center = metricColor('keff', 0.5, false, style());
    expect(center).not.toBe('#0000FF'); expect(center).not.toBe('#FF0000');
    expect(metricColor('keff', 0.45, false, style())).not.toBe(center);
    expect(metricColor('keff', 0.45, false, style({ ...threshold, width: .01 }))).toBe('#0000FF');
  });
  it('retains thresholds in projects and both view styles without changing computed values', () => {
    const parsed = parseProjectJson(example);
    const doc = parsed.session.doc;
    const before = computeMetrics([...doc.vertices.values()], [...doc.edges.values()]);
    parsed.session.style.shared.metricGradients.keff = { ...threshold, width: 0, threshold: 0.6 };
    const restored = parseProjectJson(projectToJson(parsed));
    expect(restored.session.style.shared.metricGradients.keff).toEqual(parsed.session.style.shared.metricGradients.keff);
    expect(styleForView(restored.session.style, '2d').metricGradients).toEqual(styleForView(restored.session.style, '3d').metricGradients);
    expect(renderDocumentSvg(doc, before, 'keff', false, styleForView(restored.session.style, '2d'))).toContain('stroke="#0000FF"');
    expect(computeMetrics([...doc.vertices.values()], [...doc.edges.values()])) .toEqual(before);
  });
  it('rejects invalid saved threshold settings before a project is applied', () => {
    for (const patch of [{ threshold: NaN }, { threshold: -0.1 }, { threshold: 1.1 }, { width: -1 }, { width: 2 }, { lowColor: 'oops' }]) {
      expect(() => normalizeStudioStyle({ ...DEFAULT_STUDIO_STYLE, shared: { metricGradients: { keff: { ...threshold, ...patch } } } })).toThrow(/threshold/);
    }
  });
});
