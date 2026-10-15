/** Structural graph data only: no coordinates, line styles, or color thresholds. */
export type EdgeKind = 'bond' | 'brace';
export const UNIT_EDGE_WEIGHT = 1 as const;
export type UnitEdgeWeight = typeof UNIT_EDGE_WEIGHT;

/** Shared shape for editor, persistence, and calculation boundaries.
 * TODO(weighted-graphs): non-unit Bond weights are dimensionless conductances.
 * Brace remains a hard rigid tie, not a finite stiffness. See math/future/weighted.ts.
 */
export interface StructuralEdge<Weight extends number = UnitEdgeWeight> {
  id: number;
  a: number;
  b: number;
  kind: EdgeKind;
  weight: Weight;
}
export type UnitEdge = StructuralEdge<UnitEdgeWeight>;
/** Only import/construction boundaries allow the legacy omitted unit value. */
export type UnitEdgeInput = Omit<UnitEdge, 'weight'> & { weight?: UnitEdgeWeight };
export type EdgeJsonInput = Omit<UnitEdge, 'weight'> & { weight?: number };

export function unitEdgeWeight(edge: { weight?: unknown }): UnitEdgeWeight {
  if (edge.weight !== undefined && edge.weight !== UNIT_EDGE_WEIGHT) {
    throw new Error('Unsupported edge weight. This version accepts only numeric weight 1.0. Weighted curvature is not supported; the weight was not replaced or ignored.');
  }
  return UNIT_EDGE_WEIGHT;
}

/** Materialize the default once at entry; never drop weight from an edge copy. */
export function normalizeUnitEdge(edge: Omit<UnitEdge, 'weight'> & { weight?: unknown }): UnitEdge {
  return { id: edge.id, a: edge.a, b: edge.b, kind: edge.kind, weight: unitEdgeWeight(edge) };
}
