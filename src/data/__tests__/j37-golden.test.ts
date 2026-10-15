import { describe, expect, it } from 'vitest';
import { computeMetrics, type MathEdge, type MathVertex } from '../../math';
import { templates, type Template } from '../templates';

function bond(id: number, a: number, b: number): MathEdge {
  return { id, a, b, kind: 'bond' };
}

function graphFromTemplate(template: Template): { edges: MathEdge[]; vertices: MathVertex[] } {
  return {
    vertices: template.vertices3d.map((_, id) => ({ id })),
    edges: template.edges.map(([a, b], id) => bond(id, a, b))
  };
}

function templateById(id: string): Template {
  const template = templates.find((entry) => entry.id === id);
  expect(template, id).toBeDefined();
  return template!;
}

function fractionCounts(values: Array<[number, number]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [num, den] of values) {
    const key = `${num}/${den}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function expectClasses(
  label: string,
  actual: number[],
  expected: Array<{ count: number; value: number }>,
  tolerance = 1e-6
): void {
  const counts = Array.from({ length: expected.length }, () => 0);
  for (const value of actual) {
    const index = expected.findIndex((entry) => Math.abs(value - entry.value) <= tolerance);
    expect(index, `${label}: unexpected class value ${value}`).toBeGreaterThanOrEqual(0);
    counts[index] += 1;
  }
  expect(counts, label).toEqual(expected.map((entry) => entry.count));
}

describe('J37 and rhombicuboctahedron curvature fingerprints', () => {
  it('pins the pseudo-rhombicuboctahedron (J37) numerical regression spectrum', () => {
    const { vertices, edges } = graphFromTemplate(templateById('pseudo-rhombicuboctahedron-j37'));
    const result = computeMetrics(vertices, edges);
    expect(result.values).toHaveLength(48);

    const ollivier = fractionCounts(result.values.map((value) => value.ollivierFrac));
    expect([...ollivier.keys()].sort()).toEqual(['0/1', '1/8']);
    expect(ollivier.get('0/1')).toBe(24);
    expect(ollivier.get('1/8')).toBe(24);

    expectClasses('J37 V-infinity', result.values.map((value) => value.vInf), [
      { count: 16, value: 2.567201989 },
      { count: 8, value: 2.577514537 },
      { count: 8, value: 2.736405008 },
      { count: 8, value: 2.749664155 },
      { count: 8, value: 2.753347717 }
    ]);
    expectClasses('J37 effective curvature', result.values.map((value) => value.kEff), [
      { count: 16, value: 0.5299556 },
      { count: 8, value: 0.5266516 },
      { count: 8, value: 0.4812380 },
      { count: 8, value: 0.4778521 },
      { count: 8, value: 0.4769211 }
    ]);
  });

  it('pins the rhombicuboctahedron two-class V-infinity spectrum', () => {
    const { vertices, edges } = graphFromTemplate(templateById('rhombicuboctahedron'));
    const result = computeMetrics(vertices, edges);
    expect(result.values).toHaveLength(48);
    expectClasses('RCO V-infinity', result.values.map((value) => value.vInf), [
      { count: 24, value: 2.565424159 },
      { count: 24, value: 2.751692520 }
    ]);
  });
});
