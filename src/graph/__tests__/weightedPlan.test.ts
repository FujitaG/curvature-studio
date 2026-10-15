import { afterEach, expect, it, vi } from 'vitest';
import { normalizeUnitEdge, type UnitEdgeInput } from '../edge';
import { docFromArrays, docToJson, parseDocJson } from '../../state/persistence';
import { createStudioStore } from '../../state/store';
import { createDocPatch } from '../../state/history';
import { computationKey, buildQuotient, computeMetrics } from '../../math';
import { CURRENT_CALCULATION, CALCULATION_CACHE_KEY, assertCurrentCalculation } from '../../math/calculation';
import { createComputeMessage } from '../../math/protocol';
import { graphComponents } from '../../math/components';
import { buildSimpleGraph } from '../../math/graph';
import { parseProjectJson, projectToJson } from '../../project/format';
import { buildWeightedQuotient, createWeightedTransition, computeWeightedCurvatures, tryWeightedTwinCurvature,
  type PlannedWeightedGraph, type PlannedWeightedDefinition, type PlannedWeightedQuotient } from '../../math/future/weighted';
import cube from '../../../examples/cube-study.curvature.json';

const vertices = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 0 }];
const edges: UnitEdgeInput[] = [{ id: 1, a: 1, b: 2, kind: 'bond' }];
afterEach(() => vi.unstubAllGlobals());

it('materializes legacy defaults in live state and retains weights through edits and Undo', () => {
  const doc = parseDocJson(docToJson(docFromArrays(vertices, edges)));
  expect(doc.edges.get(1)).toEqual({ ...edges[0], weight: 1 });
  const store = createStudioStore();
  store.getState().replaceDoc(doc);
  store.getState().convertEdge(1, 'brace');
  expect(store.getState().doc.edges.get(1)).toEqual({ ...edges[0], kind: 'brace', weight: 1 });
  store.getState().undo();
  expect(store.getState().doc.edges.get(1)).toEqual({ ...edges[0], weight: 1 });
  store.getState().createEdgeBetweenNewVertices(2, 0, 3, 0, 'bond');
  expect([...store.getState().doc.edges.values()].every(e => e.weight === 1)).toBe(true);
});

it('includes weight changes in history invalidation, while layout keeps calculation identity', () => {
  const before = docFromArrays(vertices, edges);
  const after = structuredClone(before);
  // Deliberately malformed future-like state: it must never look like an unchanged edge.
  Object.assign(after.edges.get(1)!, { weight: 2 });
  const patch = createDocPatch(before, after);
  expect(patch.edges).toHaveLength(1);
  expect(patch.topologyChanged).toBe(true);
  expect(() => docToJson(after)).toThrow(/edge weight/i);
  expect(computationKey(vertices, edges)).toBe(computationKey(vertices.map(v => ({ ...v, x: 200 })), edges));
});

it.each(['bond', 'brace'] as const)('rejects non-unit %s weights at direct math and Worker construction boundaries', kind => {
  const invalid = [{ ...edges[0], kind, weight: 2 }] as unknown as UnitEdgeInput[];
  for (const call of [
    () => normalizeUnitEdge(invalid[0]), () => computationKey(vertices, invalid),
    () => buildQuotient(vertices, invalid), () => computeMetrics(vertices, invalid),
    () => createComputeMessage(1, vertices, invalid), () => docFromArrays(vertices, invalid)
  ]) expect(call).toThrow(/edge weight/i);
});

it('shares model identity across save files, Worker requests and both cache levels', () => {
  const request = createComputeMessage(3, vertices, edges);
  expect(request.calculation).toEqual(CURRENT_CALCULATION);
  expect(request.edges).toEqual([{ ...edges[0], weight: 1 }]);
  const key = computationKey(vertices, edges);
  expect(JSON.parse(key)[0]).toBe(CALCULATION_CACHE_KEY);
  expect(computationKey(vertices, edges.map(normalizeUnitEdge))).toBe(key);
  expect(JSON.parse(graphComponents(buildSimpleGraph(2, [[0, 1]]))[0].key)[0]).toBe(CALCULATION_CACHE_KEY);
  expect(projectToJson(parseProjectJson(cube)).calculation).toEqual(request.calculation);
});

it('rejects reserved models and unrecognized calculation parameters without replacing them', () => {
  for (const model of [
    { ...CURRENT_CALCULATION, graphModel: 'weighted-conductance' },
    { ...CURRENT_CALCULATION, weightMode: 'conductance' },
    { ...CURRENT_CALCULATION, laziness: 0.25 }
  ]) {
    expect(() => assertCurrentCalculation(model)).toThrow(/unsupported calculation/i);
    expect(() => parseProjectJson({ ...cube, calculation: model })).toThrow(/unsupported calculation/i);
    const parsed = parseProjectJson(cube);Object.assign(parsed, { calculation: model });
    expect(() => projectToJson(parsed)).toThrow(/unsupported calculation/i);
  }
});

it('Worker rejects unknown models and non-unit edges before producing any cached or computed values', async () => {
  const posted = vi.fn();const workerScope = { postMessage: posted, onmessage: null as null | ((e: MessageEvent) => void) };
  vi.stubGlobal('self', workerScope);
  await import('../../math/worker');
  const message = createComputeMessage(1, vertices, edges);
  workerScope.onmessage!(new MessageEvent('message', { data: { ...message, calculation: { ...message.calculation, graphModel: 'weighted-conductance' } } }));
  expect(posted).toHaveBeenCalledTimes(1);
  expect(posted.mock.calls[0][0]).toMatchObject({ type: 'error', jobId: 1 });
  posted.mockClear();
  workerScope.onmessage!(new MessageEvent('message', { data: { ...message, edges: [{ ...message.edges[0], weight: 2 }] } }));
  expect(posted).toHaveBeenCalledTimes(1);
  expect(posted.mock.calls[0][0]).toMatchObject({ type: 'error', message: expect.stringMatching(/edge weight/i) });
});

it('keeps all reserved weighted stages disabled rather than returning unit-weight answers', () => {
  const graph: PlannedWeightedGraph = { vertices, edges: [{ ...edges[0], kind: 'bond', weight: 2 }] };
  const definition: PlannedWeightedDefinition = { status: 'reserved-not-implemented', transition: 'half-lazy-normalized-conductance', transportDistance: 'hop', noise: 'iid-equal-variance', quotientPolicy: { id: 'not-selected', version: 0 } };
  const quotient: PlannedWeightedQuotient = { vertexCount: 2, bonds: [{ a: 0, b: 1, conductance: 2, sourceBondIds: [1] }], strengths: new Float64Array([2, 2]) };
  for (const call of [() => buildWeightedQuotient(graph, definition), () => createWeightedTransition(quotient),
    () => computeWeightedCurvatures(quotient, definition), () => tryWeightedTwinCurvature(quotient, 0, 1)]) {
    expect(call).toThrow(/reserved but not implemented/i);
  }
});
