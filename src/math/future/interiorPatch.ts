/** Shared reservation for periodic AND quasiperiodic interior computations.
 * A finite patch is a different graph unless support and full ambient degrees
 * are verified for every propagated row through the requested step count.
 */
export interface PlannedInteriorPatch {
  status: 'reserved-not-implemented';
  ambient: { kind: 'periodic' | 'aperiodic'; definitionId: string; definitionVersion: number; inputIdentity: string };
  coreEdgeIds: readonly string[];
  supportVertexIds: readonly string[];
  requestedSteps: number;
  /** For one-step Ollivier with hop distance: complete ambient adjacency for
   * every vertex within distance 2 of either endpoint suffices to recover all
   * transport distances (at most 3) between their one-step supports. This is a
   * requested witness, not proof of completeness; other metrics need new rules. */
  transport?: { kind: 'one-step-ollivier-hop'; completeAdjacencyEndpointRadius: 2 };
  boundary: { kind: 'declared-only'; radius?: number; notes?: string };
}
declare const verifiedSupport: unique symbol;
export interface VerifiedInteriorPatch {
  readonly [verifiedSupport]: true;
  readonly input: PlannedInteriorPatch;
  readonly fullAmbientDegrees: ReadonlyMap<string, number>;
}
export function verifyInteriorSupport(_patch: PlannedInteriorPatch): never {
  // TODO(infinite-graphs): generator/ambient adjacency witness, not a user-set
  // 'complete' flag, patch radius or observed maximum degree. Verify diffusion
  // neighborhoods AND any requested transport-distance witness; fail first.
  throw new Error('Interior support verification is reserved but not implemented');
}
export interface PlannedAperiodicGenerator {
  status: 'reserved-not-implemented';
  generatorId: string;
  generatorVersion: number;
  parameters: Readonly<Record<string, unknown>>;
  // This defines the ambient infinite graph and belongs in its input identity.
  // Import filename/author metadata is descriptive provenance and does not.
  addressing: 'exact-algebraic' | 'symbolic';
  hullSampling: 'rooted-edge' | 'edge-frequency';
}
export function generateAperiodicPatch(_generator: PlannedAperiodicGenerator): never {
  // TODO(aperiodic): reproducible Penrose inflation/cut-and-project parameters,
  // stable exact addresses (no float-coordinate deduplication), core vs support,
  // full ambient degrees, sample frequencies and boundary bias. Patch fitting
  // and extrapolation must not be presented as a theorem on the whole hull.
  throw new Error('Aperiodic patch generation is reserved but not implemented');
}
