import { describe, expect, it } from 'vitest';
import { createRelaxation, type LayoutInput } from '../relax3d';

const fixture: LayoutInput = {
  vertices: [{ id: 8, x: -100, y: 50, p3: [-1, 0, 0], baked3d: true }, { id: 2, x: 100, y: -20 },
    { id: 17, x: 80, y: 110 }, { id: 9, x: -30, y: 90, p3: [0, 1, 2] }],
  edges: [{ a: 8, b: 2 }, { a: 2, b: 17 }, { a: 17, b: 9 }, { a: 9, b: 8 }], relaxAll: false
};

describe('3D layout', () => {
  it('preserves the pre-optimization layout, pinned vertices and input data', () => {
    const before = structuredClone(fixture);
    const runner = createRelaxation(fixture);
    runner.stepUntil(Infinity);
    // Recorded from the original algorithm before this optimization.
    const reference = [[0.006217611691487578, -0.2663583329856546, -0.47721620514183527], [-1, 0, 0],
      [-0.5113190381188695, -0.02338224467630698, 1.0352778072613362], [0.49458375825176726, -0.28967956029628117, 0.5579440781981821]];
    expect(runner.result().map((v) => v.id)).toEqual([2, 8, 9, 17]);
    runner.result().forEach((v, i) => v.p3.forEach((x, axis) => expect(x).toBeCloseTo(reference[i][axis], 12)));
    expect(fixture).toEqual(before);
    expect(runner.done).toBe(true);
  });
  it('skips all iterations when every vertex is pinned', () => {
    const vertices = fixture.vertices.map((v) => ({ ...v, baked3d: true }));
    const runner = createRelaxation({ ...fixture, vertices });
    expect(runner.done).toBe(true);
    expect(runner.progress).toBe(1);
    expect(runner.result().find((v) => v.id === 8)!.p3).toEqual([-1, 0, 0]);
    const all = createRelaxation({ ...fixture, vertices, relaxAll: true });
    expect(all.done).toBe(false);
    all.stepUntil(Infinity);
    expect(all.result().find((v) => v.id === 8)!.p3).not.toEqual([-1, 0, 0]);
  });
  it('handles empty, isolated and coincident vertices with finite results', () => {
    for (const n of [0, 1, 6]) {
      const runner = createRelaxation({ vertices: Array.from({ length: n }, (_, id) => ({ id, x: 0, y: 0, p3: [0, 0, 0] })), edges: [], relaxAll: true });
      runner.stepUntil(Infinity);
      expect(runner.result()).toHaveLength(n);
      expect(runner.result().every((v) => v.p3.every(Number.isFinite))).toBe(true);
    }
  });
});
