import { computationKeyForDoc, type MetricResult, type QuotientValue } from '../math';
import { edgeArray } from '../state/history';
import type { Doc, Edge } from '../state/types';

export type EdgeStatus = 'complete' | 'not-converged' | 'pending' | 'brace' | 'intra';
export interface ResultRow {
  edge: Edge;
  quotient: number | 'intra' | null;
  value: QuotientValue | null;
  status: EdgeStatus;
}
export const statusLabel: Record<EdgeStatus, string> = {
  complete: 'Converged', 'not-converged': 'Not converged', pending: 'Pending', brace: 'Rigid tie', intra: 'Within rigid unit'
};

export function currentResult(doc: Doc, result: MetricResult | null): MetricResult | null {
  return result?.key === computationKeyForDoc(doc) ? result : null;
}
export function completeResult(doc: Doc, result: MetricResult | null): result is MetricResult {
  const current = currentResult(doc, result);
  return !!current && current.values.length === current.quotientEdges.length && current.values.every((value) =>
    Number.isFinite(value.ollivier) && Number.isFinite(value.vInf) && Number.isFinite(value.kEff) && value.iterations > 0);
}
export function resultRows(doc: Doc, result: MetricResult | null): ResultRow[] {
  const current = currentResult(doc, result);
  return edgeArray(doc).map((edge) => {
    const mapped = current?.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? current?.values[mapped] ?? null : null;
    const status: EdgeStatus = edge.kind === 'brace' ? 'brace' : mapped === 'intra' ? 'intra' :
      !value || value.iterations <= 0 || !Number.isFinite(value.kEff) ? 'pending' : value.converged ? 'complete' : 'not-converged';
    return { edge, quotient: mapped ?? null, value: value && value.iterations <= 0 ? { ...value, vInf: Number.NaN, kEff: Number.NaN } : value, status };
  });
}
export function displayNumber(value: number | undefined, precision: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const text = value.toFixed(precision);
  return Number(text) === 0 ? (0).toFixed(precision) : text;
}

export type ResultSort = 'edge' | 'ollivier' | 'keff';
export function filterRows(rows: ResultRow[], query: string, filter: 'all' | 'valued' | 'attention', sort: ResultSort, descending: boolean): ResultRow[] {
  const needle = query.trim().toLowerCase();
  const selected = rows.filter(({ edge, status }) => {
    if (filter === 'valued' && !['complete', 'not-converged'].includes(status)) return false;
    if (filter === 'attention' && !['pending', 'not-converged'].includes(status)) return false;
    return !needle || `e${edge.id} v${edge.a} v${edge.b} ${edge.kind} ${statusLabel[status]}`.toLowerCase().includes(needle);
  });
  return selected.sort((a, b) => {
    const av = sort === 'edge' ? a.edge.id : sort === 'keff' ? a.value?.kEff : a.value?.ollivier;
    const bv = sort === 'edge' ? b.edge.id : sort === 'keff' ? b.value?.kEff : b.value?.ollivier;
    const aFinite = av !== undefined && Number.isFinite(av), bFinite = bv !== undefined && Number.isFinite(bv);
    if (aFinite !== bFinite) return aFinite ? -1 : 1;
    return (aFinite && bFinite ? (av! - bv!) * (descending ? -1 : 1) : 0) || a.edge.id - b.edge.id;
  });
}
