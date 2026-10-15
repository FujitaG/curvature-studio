import { describe, expect, it, vi } from 'vitest';
import fixtures from './fixtures/pre-optimization.json';
import { ComponentCache } from '../cache';
import { buildSimpleGraph } from '../graph';
import { computeEffectiveCurvatures, createEffectiveRunner, EFFECTIVE_BATCH_SIZE } from '../effective';
import { computeOllivierCurvatures } from '../ollivier';
import type { EffectiveValue } from '../types';

describe('bounded curvature computation', () => {
  it.each(fixtures)('preserves every pre-optimization value and iteration: $name', (fixture) => {
    const graph = buildSimpleGraph(fixture.vertexCount, fixture.edges as Array<[number, number]>);
    const ollivier = computeOllivierCurvatures(graph);
    const effective = computeEffectiveCurvatures(graph, fixture.hardCap);
    expect(ollivier.map((value, index) => ({ ...value, ...effective[index] }))).toEqual(fixture.values);
  });

  it('bounds active dipoles at the 1,000 vertex / 3,000 edge limit', () => {
    const edges: Array<[number, number]> = [];
    for (let a = 0; a < 1000; a += 1) for (let d = 1; d <= 3; d += 1) edges.push([a, (a + d) % 1000]);
    const runner = createEffectiveRunner(buildSimpleGraph(1000, edges));
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(2);
    try { runner.stepUntil(1); } finally { clock.mockRestore(); }
    expect(runner.done).toBe(false);
    expect(runner.workingBytes).toBe((EFFECTIVE_BATCH_SIZE + 1) * 1000 * 8);
  });

  it('reuses a component across added graphs, but distinguishes edges and stopping limits', () => {
    const cache = new ComponentCache<EffectiveValue>();
    const original = createEffectiveRunner(buildSimpleGraph(3, [[0, 1], [1, 2]]), 7, cache);
    original.stepUntil(Infinity);
    const expanded = createEffectiveRunner(buildSimpleGraph(7, [[1, 3], [3, 5], [0, 2], [2, 4]]), 7, cache);
    expanded.stepUntil(Infinity);
    expect(expanded.results()).toEqual([...original.results(), ...original.results()]);
    expect(expanded.workingBytes).toBe(0);
    expect(cache.snapshot()).toHaveLength(1);
    const changed = createEffectiveRunner(buildSimpleGraph(3, [[0, 1], [1, 2], [0, 2]]), 1, cache);
    changed.stepUntil(Infinity);
    expect(changed.results().every(value => value.iterations === 1 && !value.converged)).toBe(true);
    expect(cache.snapshot()).toHaveLength(2);
  });

  it('evicts by retained values and by entry count, with least recent entries first', () => {
    const cache = new ComponentCache<number>([], 4, 2);
    cache.set('a', [1, 2]); cache.set('b', [3]); cache.get('a'); cache.set('c', [4, 5]);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.snapshot()).toEqual([['a', [1, 2]], ['c', [4, 5]]]);
    cache.set('oversized', [1, 2, 3, 4, 5]);
    expect(cache.get('oversized')).toBeUndefined();
    expect(new ComponentCache(cache.snapshot()).get('c')).toEqual([4, 5]);
  });
});
