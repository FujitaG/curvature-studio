import { computationKey } from './graph';
import { computeEffectiveCurvatures } from './effective';
import { computeOllivierCurvatures } from './ollivier';
import { buildQuotient } from './quotient';
import type { MathEdge, MathVertex, MetricResult } from './types';

export function computeMetrics(vertices: MathVertex[], edges: MathEdge[]): MetricResult {
  const key = computationKey(vertices, edges);
  const quotient = buildQuotient(vertices, edges);
  const ollivier = computeOllivierCurvatures(quotient.graph);
  const effective = computeEffectiveCurvatures(quotient.graph);
  return {
    key,
    unitOf: quotient.unitOf,
    quotientEdges: quotient.quotientEdges,
    bondMap: quotient.bondMap,
    values: quotient.quotientEdges.map((_, index) => ({
      ...ollivier[index],
      ...effective[index]
    }))
  };
}

export * from './effective';
export * from './graph';
export * from './ollivier';
export * from './quotient';
export * from './types';
