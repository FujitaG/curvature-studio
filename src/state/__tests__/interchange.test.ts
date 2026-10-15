import { describe, expect, it } from 'vitest';
import { mergeGradients, parseStyleJson, styleToJson } from '../interchange';
import { DEFAULT_ORNAMENTAL_STYLE, DEFAULT_SHARED_STYLE, DEFAULT_STUDIO_STYLE } from '../style';

describe('style interchange', () => {
  it('remaps colliding gradient ids and names in style references', () => {
    const parsed = parseStyleJson({ format: 'curvature-studio/style', version: 1, style: { ...DEFAULT_ORNAMENTAL_STYLE, metricGradients: { ...DEFAULT_SHARED_STYLE.metricGradients, keff: { type: 'custom', id: 'same' } } }, customGradients: [{ id: 'same', metric: 'keff', name: 'Mine', stops: [{ position: 0, color: '#000000' }, { position: 100, color: '#FFFFFF' }] }] });
    const merged = mergeGradients([{ id: 'same', metric: 'keff', name: 'Mine', stops: [{ position: 0, color: '#111111' }, { position: 100, color: '#EEEEEE' }] }], parsed.customGradients, parsed.style);
    expect(merged.customGradients).toHaveLength(2);
    expect(merged.customGradients[1].name).toBe('Mine (2)');
    expect(merged.style.shared.metricGradients.keff).toEqual({ type: 'custom', id: merged.customGradients[1].id });
    expect(merged.style.view2d).toEqual(merged.style.view3d);
  });

  it('writes v2 with independent view styles', () => {
    const value = styleToJson({ ...DEFAULT_STUDIO_STYLE, view2d: { ...DEFAULT_STUDIO_STYLE.view2d, bondWidth: 3.5 } }, []);
    expect(value.version).toBe(2);
    expect(value.style.view2d.bondWidth).toBe(3.5);
    expect(value.style.view3d.bondWidth).toBe(2);
  });
});
