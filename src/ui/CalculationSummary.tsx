import type { ProjectStore } from '../project/store';
import { getActiveProjectStore } from '../project/store';

/** Reused by results and per-pane chrome; the caller owns which document opens. */
export function CalculationSummary({ project, compact = false, scope }: { project?: ProjectStore; compact?: boolean; scope?: string }) {
  const label = compact ? 'Unit · κeff≈' : 'Finite · unit weights · κeff estimate';
  return <button className={`calculation-summary ${compact ? 'compact' : ''}`}
    aria-label={`${label} — Calculation details${scope ? ` for ${scope}` : ''}`} title="Finite, unit-weight model. Effective curvature is a numerical estimate."
    onClick={() => (project ?? getActiveProjectStore()).getState().setCalculationDetailsOpen(true)}>
    {label}
  </button>;
}
