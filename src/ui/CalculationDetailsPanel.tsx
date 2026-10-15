import { CURRENT_CALCULATION } from '../math/calculation';
import { CURRENT_SAMPLE_UNIT } from '../math/model';
import { useProjectStore } from '../project/store';
import { EFFECTIVE_EVIDENCE_DESCRIPTION } from '../results/evidence';
import { Dialog } from './Dialog';

/** Read-only, session-only view. Future controls belong behind a supported
 * adapter, never disabled selectors that imply a solver already exists. */
export function CalculationDetailsPanel() {
  const title = useProjectStore(s => s.metadata.title);
  const setOpen = useProjectStore(s => s.setCalculationDetailsOpen);
  return <Dialog title="Calculation details" onClose={() => setOpen(false)} className="calculation-details">
    <p className="calculation-project">{title}</p>
    <dl>
      <dt>Model</dt><dd>Finite, undirected graph; every edge weight is 1.</dd>
      <dt>Rigid units</dt><dd>Braces merge vertices. Internal bonds have no curvature; repeated bonds between two units share one quotient bond.</dd>
      <dt>Walk</dt><dd>Laziness {CURRENT_CALCULATION.laziness}; neighbors have equal transition probabilities.</dd>
      <dt>Transport / noise</dt><dd>Hop distance for Ollivier–Ricci; ordinary Euclidean squared norm on quotient vertices for accumulated variance.</dd>
      <dt>Engine</dt><dd>{CURRENT_CALCULATION.engine}</dd>
      <dt>Ollivier–Ricci evidence</dt><dd>Exact rational fractions are retained. Displayed decimals are rounded.</dd>
      <dt>Effective curvature evidence</dt><dd>{EFFECTIVE_EVIDENCE_DESCRIPTION}</dd>
      <dt>Stopping</dt><dd>Estimated variance tail below {CURRENT_CALCULATION.tailTolerance}; at most {CURRENT_CALCULATION.maxIterations.toLocaleString('en-US')} steps. “Converged” means this numerical stopping rule was met, not a proof certificate.</dd>
      <dt>Histogram sample</dt><dd>{CURRENT_SAMPLE_UNIT}: each unique quotient bond is counted once. Color thresholds change appearance only.</dd>
    </dl>
    <p>Weighted, periodic and quasiperiodic calculations are planned but unavailable in this release. A finite patch is calculated as a finite graph, not as an infinite material.</p>
  </Dialog>;
}
