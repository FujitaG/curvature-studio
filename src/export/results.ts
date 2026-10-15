import { version } from '../../package.json';
import { valueEvidence } from '../results/evidence';
import { CURRENT_SAMPLE_UNIT } from '../math/model';
import type { MetricResult } from '../math';
import type { Doc } from '../state/types';
import { docToJson } from '../state/persistence';
import { CALCULATION, type ProjectMetadata } from '../project/format';
import { completeResult, resultRows } from '../results/model';

export function resultsToJson(doc: Doc, result: MetricResult, metadata: ProjectMetadata) {
  if (!completeResult(doc, result)) throw new Error('Wait for both curvature calculations to finish before exporting results.');
  return {
    format: 'curvature-studio/results', version: 1,
    applicationVersion: version, sampleUnit: CURRENT_SAMPLE_UNIT,
    exportedAt: new Date().toISOString(), project: { ...metadata }, calculation: { ...CALCULATION },
    doc: docToJson(doc), inputKey: result.key,
    summary: { quotientBonds: result.values.length, notConverged: result.values.filter((value) => !value.converged).length },
    units: [...result.unitOf].sort((a, b) => a[0] - b[0]).map(([vertexId, unitId]) => ({ vertexId, unitId })),
    quotientBonds: result.quotientEdges.map(([a, b], index) => ({ index, a, b, ...result.values[index], evidence: valueEvidence(result.values[index]) })),
    edges: resultRows(doc, result).map(({ edge, quotient, status }) => ({ ...edge, quotient, status }))
  };
}
