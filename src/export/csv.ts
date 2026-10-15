import { effectiveEvidence } from '../results/evidence';
import type { MetricResult } from '../math';
import { edgeArray } from '../state/history';
import type { Doc } from '../state/types';
import { completeResult } from '../results/model';

export const VALUES_CSV_HEADER =
  'edge_id, vertex_a, vertex_b, kind, quotient_edge, ollivier_num, ollivier_den, ollivier, v_inf, k_eff, converged, iterations, ollivier_evidence, effective_evidence, termination, rounding, variance_bound_exact_arithmetic, curvature_bound_exact_arithmetic';

export function renderValuesCsv(doc: Doc, results: MetricResult): string {
  if (!completeResult(doc, results)) throw new Error('Wait for both curvature calculations to finish before exporting CSV.');
  const rows = edgeArray(doc).map((edge) => {
    if (edge.kind === 'brace') {
      return [edge.id, edge.a, edge.b, edge.kind, '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    }
    const mapped = results.bondMap.get(edge.id);
    if (mapped === 'intra') {
      return [edge.id, edge.a, edge.b, edge.kind, 'intra', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    }
    const value = typeof mapped === 'number' ? results.values[mapped] : undefined;
    if (!value || typeof mapped !== 'number') {
      return [edge.id, edge.a, edge.b, edge.kind, '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    }
    const evidence = effectiveEvidence(value);
    return [
      edge.id,
      edge.a,
      edge.b,
      edge.kind,
      mapped,
      value.ollivierFrac[0],
      value.ollivierFrac[1],
      String(value.ollivier),
      String(value.vInf),
      String(value.kEff),
      String(value.converged),
      value.iterations, 'exact-rational', evidence.kind,
      evidence.kind === 'pending' ? '' : evidence.termination,
      evidence.kind === 'pending' ? '' : evidence.rounding,
      evidence.kind === 'pending' ? '' : evidence.variance.boundInExactArithmetic,
      evidence.kind === 'pending' ? '' : evidence.curvature.boundInExactArithmetic
    ];
  });
  return [VALUES_CSV_HEADER, ...rows.map((row) => row.map(String).join(', '))].join('\n') + '\n';
}
