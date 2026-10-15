/** RESERVED, applicable to finite, weighted, periodic and aperiodic models.
 * Certificates must account for numerical rounding as well as analytic tails.
 */
export interface PlannedTailRequest {
  inputIdentity: string;
  definitionIdentity: string;
  partialVariance: number;
  steps: number;
  noise: 'ordinary-counting-l2-on-quotient';
}
export interface PlannedTailCertificate {
  kind: 'certified-variance-interval';
  inputIdentity: string;
  definitionIdentity: string;
  varianceInterval: readonly [number, number];
  rounding: 'outward-verified';
  witness: { methodId: string; methodVersion: number; assumptions: readonly string[] };
  // Derive k in [f(Vupper), f(Vlower)] with outward rounding, f(V)=1-sqrt(1-2/V).
  // Do not store an independently editable curvature interval. V>=2 and the
  // V=2 endpoint need explicit treatment; a V tolerance is not a k tolerance.
}
export function certifyVarianceTail(_request: PlannedTailRequest): never {
  // TODO(certification): rigorously bound a tail using verified hypotheses
  // (spectral enclosure or admissible Thomson flow for an upper bound; a
  // Dirichlet potential supplies a LOWER bound). A global strength bound
  // cannot be inferred from an observed patch maximum. Fit-based extrapolation
  // is a separate heuristic and loses the partial sum's one-sided property.
  throw new Error('Variance tail certification is reserved but not implemented');
}
