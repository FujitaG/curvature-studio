/** One definition shared by project files, Workers and runtime cache identities.
 * TODO(weighted-graphs): add a separately versioned supported model only after
 * implementing the explicit contracts in future/weighted.ts. Never reinterpret
 * a unit-model file or silently fall back from an unknown weighted model.
 */
export const TAIL_TOLERANCE = 1e-10;
export const HARD_CAP = 200_000;
export const CURRENT_CALCULATION = Object.freeze({
  engine: 'curvature-studio/math@1',
  graphModel: 'undirected-unweighted-rigid-quotient',
  laziness: 0.5,
  tailTolerance: TAIL_TOLERANCE,
  maxIterations: HARD_CAP
} as const);
export type CalculationDefinition = typeof CURRENT_CALCULATION;
export const CALCULATION_CACHE_KEY = JSON.stringify(CURRENT_CALCULATION);

export function assertCurrentCalculation(value: unknown): asserts value is CalculationDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== Object.keys(CURRENT_CALCULATION).length ||
      Object.entries(CURRENT_CALCULATION).some(([key, expected]) => (value as Record<string, unknown>)[key] !== expected)) {
    throw new Error('This project uses an unsupported calculation method or parameters. Open it with a compatible version of Curvature Studio.');
  }
}
