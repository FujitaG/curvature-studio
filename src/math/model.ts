import { assertCurrentCalculation, CURRENT_CALCULATION, type CalculationDefinition } from './calculation';

/** The only executable variant. Future combinations need their own adapter,
 * validation and cache identity; changing a label must never enable a solver. */
export interface FiniteUnitModel { kind: 'finite-unit'; calculation: CalculationDefinition }
export const CURRENT_MODEL: FiniteUnitModel = Object.freeze({ kind: 'finite-unit', calculation: CURRENT_CALCULATION });
export const CURRENT_SAMPLE_UNIT = 'quotient-bond' as const;
export function assertSupportedModel(value: unknown): asserts value is FiniteUnitModel {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || (value as FiniteUnitModel).kind !== 'finite-unit') {
    throw new Error('Unsupported graph model. This release calculates finite, unit-weight graphs only.');
  }
  assertCurrentCalculation((value as FiniteUnitModel).calculation);
}
