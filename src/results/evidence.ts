import { CURRENT_CALCULATION } from '../math/calculation';
import type { EffectiveValue, QuotientValue } from '../math/types';

/** Derived metadata, not a second numeric result or Worker wire format.
 * a_0=2; the kernel exports V_T without adding its estimated geometric tail.
 * One-sided statements hold in exact arithmetic; rounding is NOT certified.
 */
export function effectiveEvidence(value: EffectiveValue) {
  if (value.iterations <= 0 || !Number.isFinite(value.vInf) || !Number.isFinite(value.kEff)) return { kind: 'pending' as const };
  return {
    kind: 'truncated-sum' as const,
    variance: { quantity: 'V', boundInExactArithmetic: 'lower' as const },
    curvature: { quantity: 'k_eff', boundInExactArithmetic: 'upper' as const },
    rounding: 'unverified-floating-point' as const, certified: false as const,
    termination: value.converged ? 'estimated-tail-tolerance' as const : 'iteration-limit' as const,
    stoppingTolerance: { quantity: 'estimated-variance-tail', value: CURRENT_CALCULATION.tailTolerance },
    iterations: value.iterations
  };
}
export function valueEvidence(value: QuotientValue) {
  return {
    ollivier: { kind: 'exact-rational' as const, fields: ['ollivierFrac', 'w1Frac'], decimal: 'rounded' as const },
    effective: effectiveEvidence(value)
  };
}
export const EFFECTIVE_EVIDENCE_DESCRIPTION = 'Effective curvature uses a truncated variance sum. It is an upper-side estimate in exact arithmetic, not a certified interval; floating-point rounding is unverified. The stopping tolerance applies to the estimated variance tail, not directly to curvature error.';
