import { describe, expect, it } from 'vitest';
import { computationKey, computeMetrics, type MetricResult } from '../../math';
import { docFromArrays } from '../../state/persistence';
import { completeResult, displayNumber, filterRows, resultRows } from '../model';
import { renderValuesCsv } from '../../export/csv';
import { resultsToJson } from '../../export/results';
import { newMetadata } from '../../project/format';
import { useStudioStore } from '../../state/store';
import { renderDocumentSvg } from '../../export/svg';

const doc = docFromArrays([{ id: 1, x: 0, y: 0 }, { id: 2, x: 64, y: 0 }, { id: 3, x: 32, y: 64 }], [{ id: 1, a: 1, b: 2, kind: 'bond' }, { id: 2, a: 2, b: 3, kind: 'bond' }]);
const compute = () => computeMetrics([...doc.vertices.values()], [...doc.edges.values()]);

describe('calculation identity and exports', () => {
  it('includes edge IDs and isolated vertices but excludes layout and input ordering', () => {
    const key = computationKey(doc.vertices.values(), doc.edges.values());
    expect(computationKey([...doc.vertices.values()].reverse().map((v) => ({ ...v, x: v.x + 40 })), [...doc.edges.values()].reverse())).toBe(key);
    expect(computationKey(doc.vertices.values(), [...doc.edges.values()].map((e) => ({ ...e, id: e.id + 10 })))).not.toBe(key);
    expect(computationKey([...doc.vertices.values(), { id: 9 }], doc.edges.values())).not.toBe(key);
  });
  it('rejects partial and stale results at the CSV and JSON boundaries', () => {
    const result = compute();
    const partial = { ...result, values: result.values.map((v) => ({ ...v, vInf: NaN, kEff: NaN, iterations: 0 })) };
    for (const invalid of [partial, { ...result, key: 'old' }]) {
      expect(completeResult(doc, invalid)).toBe(false);
      expect(() => renderValuesCsv(doc, invalid)).toThrow(/finish/);
      expect(() => resultsToJson(doc, invalid, newMetadata())).toThrow(/finish/);
    }
    expect(renderValuesCsv(doc, result)).not.toMatch(/NaN|Infinity/);
  });
  it('retains numerical precision and nonconvergence in results exports', () => {
    const result = compute(); result.values[0].converged = false;
    const report = resultsToJson(doc, result, newMetadata('Example'));
    expect(report.quotientBonds[0].kEff).toBe(result.values[0].kEff);
    expect(report.summary.notConverged).toBe(1);
    expect(report.edges[0].status).toBe('not-converged');
    expect(report.calculation.laziness).toBe(0.5);
    expect(JSON.parse(JSON.stringify(report)).quotientBonds[0].ollivierFrac).toEqual([1, 2]);
  });
  it('removes stale maps immediately after importing different edge IDs and rejects late worker replies', () => {
    useStudioStore.getState().replaceDoc(doc, false, true);
    const result = compute(); useStudioStore.getState().setResults(result);
    const next = { ...doc, edges: new Map([...doc.edges.values()].map((e) => [e.id + 10, { ...e, id: e.id + 10 }])) };
    useStudioStore.getState().replaceDoc(next, false, true);
    expect(useStudioStore.getState().results).toBeNull();
    useStudioStore.getState().setResults(result);
    expect(useStudioStore.getState().results).toBeNull();
  });
  it('does not invalidate completed metrics when moving a vertex', () => {
    useStudioStore.getState().replaceDoc(doc, false, true);
    const result = compute(); useStudioStore.getState().setResults(result);
    useStudioStore.getState().moveVertices([1], 10, 20);
    expect(useStudioStore.getState().results).toBe(result);
    expect(useStudioStore.getState().computing).toBe(false);
  });
});

describe('result presentation', () => {
  it('respects hidden labels in figure exports', () => {
    expect(renderDocumentSvg(doc, compute(), 'keff', false)).toContain('<text');
    expect(renderDocumentSvg(doc, compute(), 'keff', false, undefined, [], false)).not.toContain('<text');
  });
  it('distinguishes braces, intra-unit bonds, pending and converged values', () => {
    const graph = docFromArrays([...doc.vertices.values()], [{ id: 1, a: 1, b: 2, kind: 'brace' }, { id: 2, a: 2, b: 3, kind: 'brace' }, { id: 3, a: 1, b: 3, kind: 'bond' }]);
    const result = computeMetrics([...graph.vertices.values()], [...graph.edges.values()]);
    expect(resultRows(graph, result).map((r) => r.status)).toEqual(['brace', 'brace', 'intra']);
    expect(resultRows(doc, null).every((r) => r.status === 'pending')).toBe(true);
    expect(resultRows(doc, compute()).every((r) => r.status === 'complete')).toBe(true);
  });
  it('filters by endpoints, sorts numbers correctly, and keeps pending values last in both directions', () => {
    const result: MetricResult = compute(); result.values[1].kEff = NaN;
    const rows = resultRows(doc, result);
    expect(filterRows(rows, 'v3', 'all', 'edge', false).map((r) => r.edge.id)).toEqual([2]);
    expect(filterRows(rows, '', 'attention', 'edge', false).map((r) => r.edge.id)).toEqual([2]);
    for (const direction of [true, false]) expect(filterRows(rows, '', 'all', 'keff', direction).at(-1)?.edge.id).toBe(2);
  });
  it('never prints NaN or negative zero as a display value', () => {
    expect(displayNumber(NaN, 6)).toBe('—');
    expect(displayNumber(-0.000001, 2)).toBe('0.00');
    expect(displayNumber(2 / 3, 6)).toBe('0.666667');
  });
});
