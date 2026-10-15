import { expect, it } from 'vitest';
import { repulsionOctree } from '../octree';
import { createRelaxation } from '../relax3d';

function exact(positions: Float64Array): Float64Array {
  const result = new Float64Array(positions.length);
  for (let a = 0; a < positions.length; a += 3) for (let b = a + 3; b < positions.length; b += 3) {
    const delta = [0, 1, 2].map(d => positions[a + d] - positions[b + d]);
    const distance = Math.max(1e-4, Math.hypot(...delta));
    delta.forEach((value, d) => { const force = value / distance / distance; result[a + d] += force; result[b + d] -= force; });
  }
  return result;
}

it('opens every cell at theta zero and controls force error at the production setting', () => {
  let seed = 77;
  const positions = Float64Array.from({ length: 600 * 3 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 * 20 - 10; });
  const reference = exact(positions), opened = new Float64Array(positions.length), approximate = new Float64Array(positions.length);
  repulsionOctree(positions, opened, 0); repulsionOctree(positions, approximate);
  let error = 0, magnitude = 0;
  for (let i = 0; i < positions.length; i += 1) {
    expect(Math.abs(opened[i] - reference[i])).toBeLessThan(1e-10);
    error += (approximate[i] - reference[i]) ** 2; magnitude += reference[i] ** 2;
  }
  expect(Math.sqrt(error / magnitude)).toBeLessThan(0.01);
});

it('handles coincident points and keeps fixed vertices unchanged in large layouts', () => {
  const positions = new Float64Array(400 * 3).fill(0.1), forces = new Float64Array(positions.length);
  repulsionOctree(positions, forces);
  expect(forces.every(value => value === 0)).toBe(true);
  const vertices = Array.from({ length: 400 }, (_, id) => ({ id, x: id % 20, y: Math.floor(id / 20), p3: [id % 20, Math.floor(id / 20), 0] as [number, number, number], baked3d: id === 0 }));
  const job = createRelaxation({ vertices, edges: [], relaxAll: false });
  job.stepUntil(Infinity);
  expect(job.result()[0].p3).toEqual([0, 0, 0]);
  expect(job.result().every(value => value.p3.every(Number.isFinite))).toBe(true);
});
