import { DEFAULT_PANELS } from '../state/panels';
import { useProjectStore } from '../project/store';
import { useStudioStore } from '../state/store';
import { getPanelLayout, setPanelLayout, setHistogramPosition } from '../state/viewMemory';
import { parsePanelLayout } from '../state/panelLayout';

export function PanelOptions({ onOpenDetails }: { onOpenDetails?: () => void } = {}): JSX.Element {
  const panels = useStudioStore(state => state.panels);
  const setPanelVisible = useStudioStore(state => state.setPanelVisible);
  const labels = useStudioStore(state => state.labelsVisible);
  const results = useProjectStore(state => state.resultsOpen);
  return <>
    <div className="view-options" role="group" aria-label="View and panels">
      <label><input type="checkbox" checked={panels.histogram} onChange={event => setPanelVisible('histogram', event.target.checked)} />Histogram</label>
      <label><input type="checkbox" checked={panels.inspector} onChange={event => setPanelVisible('inspector', event.target.checked)} />Inspector</label>
      <label><input type="checkbox" checked={results} onChange={event => useProjectStore.getState().setResultsOpen(event.target.checked)} />Results table</label>
      <label><input type="checkbox" checked={labels} onChange={event => useStudioStore.getState().setLabelsVisible(event.target.checked)} />Edge labels</label>
      <label><input type="checkbox" checked={panels.hints} onChange={event => setPanelVisible('hints', event.target.checked)} />Interaction guide</label>
      <label><input type="checkbox" disabled={!panels.hints} checked={panels.legend} onChange={event => setPanelVisible('legend', event.target.checked)} />Keyboard shortcuts in guide</label>
    </div>
    <button className="menu-item" onClick={() => onOpenDetails ? onOpenDetails() : useProjectStore.getState().setCalculationDetailsOpen(true)}>Calculation details</button>
    <button className="menu-item" onClick={() => {
      setPanelLayout({ ...getPanelLayout(), guide: { ...getPanelLayout().guide, position: undefined } });
      setHistogramPosition(null);
      window.dispatchEvent(new CustomEvent('curvature-studio:restore-histogram', { detail: null }));
    }}>Reset panel positions</button>
    <button className="menu-item" onClick={() => {
      setPanelLayout(parsePanelLayout(undefined));
      useStudioStore.setState({ panels: { ...DEFAULT_PANELS }, labelsVisible: true, histogramCollapsed: false, inspectorExpanded: false, histogramHoverBin: null });
      useProjectStore.getState().setResultsOpen(false);
      useProjectStore.getState().setCalculationDetailsOpen(false);
      setHistogramPosition(null);
      window.dispatchEvent(new CustomEvent('curvature-studio:restore-histogram', { detail: null }));
    }}>Restore default panels</button>
    <p className="panels-help">Checks remember your display preferences. Results may temporarily cover floating panels on small screens. Drag Histogram or Interaction guide by its title to move it. Inspector needs a single selection. Results table and Calculation details are open only for this session.</p>
  </>;
}

export function ViewMenu(): JSX.Element {
  return <details className="view-menu compatibility-menu"><summary>View & panels</summary><PanelOptions /></details>;
}
