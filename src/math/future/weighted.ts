import type { StructuralEdge, UnitEdge } from '../../graph/edge';
import type { MathVertex } from '../types';

/**
 * RESERVED / NOT IMPLEMENTED — TODO(weighted-graphs)
 *
 * This file is intentionally absent from the math barrel and production UI.
 * It records planned contracts, not supported project versions or capabilities.
 * Never route a future weighted request to the existing unit solver as fallback.
 *
 * Plan: docs/20260910-weighted-extension-plan.md
 * Proofs (relative to curvature-studio/):
 * ../ClusterStabilityNext/WeightedEffectiveCurvature.lean
 * ../ClusterStabilityNext/WeightedTwinCurvature.lean
 *
 * Conductance w_xy is positive and symmetric on existing Bonds; it is not length,
 * line width, threshold, absolute stiffness, or a noise variance. Zero denotes a
 * missing edge in the theory; an editable zero Bond needs an explicit policy.
 * Brace is a hard merge and keeps unit weight, including in the planned type.
 */
export type PlannedWeightedEdge =
  | (StructuralEdge<number> & { kind: 'bond' })
  | (UnitEdge & { kind: 'brace' });

/** Not assignable to today's UnitEdgeInput/ProjectJson; no active reader accepts it. */
export interface PlannedWeightedGraph {
  vertices: readonly MathVertex[];
  edges: readonly PlannedWeightedEdge[];
}

/** Candidate mathematical choices are explicit; aggregation remains a release gate.
 * Format and engine versions will be assigned when the implementation is complete.
 * This descriptor must NOT be serialized as a supported calculation definition.
 */
export interface PlannedWeightedDefinition {
  status: 'reserved-not-implemented';
  transition: 'half-lazy-normalized-conductance';
  transportDistance: 'hop';
  noise: 'iid-equal-variance';
  quotientPolicy: { id: string; version: number };
}

/** Preserve source edge references before aggregation; strength is NOT degree. */
export interface PlannedWeightedQuotient {
  vertexCount: number;
  bonds: ReadonlyArray<{
    a: number;
    b: number;
    conductance: number;
    sourceBondIds: readonly number[];
  }>;
  strengths: Float64Array;
}

function reserved(stage: string): never {
  throw new Error(`Weighted ${stage} is reserved but not implemented. Only unit-weight calculation is supported.`);
}

/** TODO(weighted-graphs): choose and version duplicate/intra-unit Bond handling.
 * A naive sum of parallel Bonds changes the current all-unit simple quotient.
 * Retain IDs and test input permutations, Brace merges and all-unit regression.
 */
export function buildWeightedQuotient(
  _graph: PlannedWeightedGraph, _definition: PlannedWeightedDefinition
): never {
  return reserved('quotient construction');
}

/** TODO(weighted-graphs): P_xy = delta_xy/2 + w_xy/(2*s_x).
 * Implement a sparse ROW-dipole operator, validate symmetry, finite positive
 * strengths, isolated components, overflow/underflow and global-scale invariance.
 */
export function createWeightedTransition(_graph: PlannedWeightedQuotient): never {
  return reserved('transition construction');
}

/** TODO(weighted-graphs): V=sum_j ||(e_u-e_v) P^j||_2^2; k=1-sqrt(1-2/V).
 * Keep the Euclidean/noise convention and introduce certified tail/error status.
 * Preserve weighted Ollivier transport meaning; arbitrary real conductances must
 * not be labeled as exact rational answers. Include method/policy/weights in all
 * Worker identities, component caches, exports, and result provenance.
 */
export function computeWeightedCurvatures(
  _graph: PlannedWeightedQuotient, _definition: PlannedWeightedDefinition
): never {
  return reserved('curvature calculation');
}

/** TODO(weighted-graphs): optional exact-twin acceleration, AFTER the baseline.
 * Equal outside conductances imply k=1/2+a/(2*s). Check every twin hypothesis;
 * approximate equality needs a separate perturbation/error theorem. The proved
 * 18-term bound <1e-10 is on V, NOT directly on k. No global convergence claim.
 */
export function tryWeightedTwinCurvature(
  _graph: PlannedWeightedQuotient, _u: number, _v: number
): never {
  return reserved('twin shortcut');
}
