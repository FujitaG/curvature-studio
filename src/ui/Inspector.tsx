import { t } from '../i18n';
import { metricLabel } from '../design/tokens';
import { useStudioStore } from '../state/store';
import { displayNumber } from '../results/model';
import { useCompactViewport } from '../hooks/useCompactViewport';
import { focusGraphCanvas } from './navigation';

export function Inspector(): JSX.Element | null {
  const selection = useStudioStore((state) => state.selection);
  const doc = useStudioStore((state) => state.doc);
  const results = useStudioStore((state) => state.results);
  const metric = useStudioStore((state) => state.metric);
  const setSelection = useStudioStore((state) => state.setSelection);
  const convertEdge = useStudioStore((state) => state.convertEdge);
  const deleteEntity = useStudioStore((state) => state.deleteEntity);
  const visible = useStudioStore(state => state.panels.inspector);
  const expanded = useStudioStore(state => state.inspectorExpanded);
  const compact = useCompactViewport();
  if (!visible || selection.length !== 1) return null;
  const item = selection[0];
  if (compact && !expanded) return <button className="inspector-toggle button panel" aria-expanded={false} aria-controls="selection-inspector"
    onClick={() => useStudioStore.getState().setInspectorExpanded(true)}>Selection details</button>;
  const close = () => {
    if (compact) useStudioStore.getState().setInspectorExpanded(false);
    else useStudioStore.getState().setPanelVisible('inspector', false);
    focusGraphCanvas();
  };
  const header = (title: string) => <div className="inspector-title"><h2>{title}</h2><button className="mini-button icon-only" aria-label="Close inspector" onClick={close}>×</button></div>;

  if (item.kind === 'vertex') {
    const vertex = doc.vertices.get(item.id);
    if (!vertex) return null;
    const incident = [...doc.edges.values()].filter((edge) => edge.a === vertex.id || edge.b === vertex.id);
    return (
      <div id="selection-inspector" key={`vertex:${vertex.id}`} className="inspector panel">
        {header(`Vertex v${vertex.id}`)}
        <div className="row">
          <div className="row-label">{t("Degree")}</div>
          <div className="row-value">{incident.length}</div>
        </div>
        <div className="row">
          <div className="row-label">{t("Position")}</div>
          <div className="row-value">
            {vertex.x.toFixed(1)}, {vertex.y.toFixed(1)}
          </div>
        </div>
        <div className="row">
          <div className="row-label">{t("Incident")}</div>
          <div className="row-value">
            {incident.length === 0
              ? 'none'
              : incident.map((edge) => {
                  const map = results?.bondMap.get(edge.id);
                  const value = typeof map === 'number' ? results?.values[map] : undefined;
                  return (
                    <button key={edge.id} className="incident-edge" onClick={() => setSelection([{ kind: 'edge', id: edge.id }])}>
                      e{edge.id} {value ? metricLabel(metric, metric === 'keff' ? value.kEff : value.ollivier) : t(edge.kind)}
                    </button>
                  );
                })}
          </div>
        </div>
        <button className="button" onClick={() => deleteEntity(item)}>{t("Delete")}{' '}</button>
      </div>
    );
  }

  const edge = doc.edges.get(item.id);
  if (!edge) return null;
  const mapped = results?.bondMap.get(edge.id);
  const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
  const unitA = results?.unitOf.get(edge.a);
  const unitB = results?.unitOf.get(edge.b);
  const shared = typeof mapped === 'number' ? [...doc.edges.values()].filter((other) => results?.bondMap.get(other.id) === mapped).length - 1 : 0;
  const hasBraces = [...doc.edges.values()].some((item) => item.kind === 'brace');
  const degreeA = [...doc.edges.values()].filter((item) => item.a === edge.a || item.b === edge.a).length;
  const degreeB = [...doc.edges.values()].filter((item) => item.a === edge.b || item.b === edge.b).length;
  const unitSize =
    edge.kind === 'brace' && results
      ? [...results.unitOf.values()].filter((unit) => unit === results.unitOf.get(edge.a)).length
      : undefined;
  return (
    <div id="selection-inspector" key={`edge:${edge.id}`} className="inspector panel">
      {header(`${edge.kind === 'brace' ? 'Brace' : 'Bond'} e${edge.id}`)}
      <div className="row">
        <div className="row-label">{t("Endpoints")}</div>
        <div className="row-value">
          v{edge.a} - v{edge.b}
          {' · '}{t("deg")}{' '}{degreeA} / {degreeB}
        </div>
      </div>
      <div className="row">
        <div className="row-label">Structural role</div>
        <div className="row-value">{t(edge.kind)}</div>
      </div>
      {edge.kind === 'brace' ? (
        <>
          <div className="row">
            <div className="row-label">{t("Reading")}</div>
            <div className="row-value">{t("rigid tie - merges endpoints into one unit")}</div>
          </div>
          <div className="row">
            <div className="row-label">{t("Unit size")}</div>
            <div className="row-value">{unitSize ?? 'pending'}</div>
          </div>
        </>
      ) : mapped === 'intra' ? (
        <div className="row">
          <div className="row-label">{t("Reading")}</div>
          <div className="row-value">{t("inert - both ends lie in one rigid unit")}</div>
        </div>
      ) : value ? (
        <>
          <div className="row">
            <div className="row-label">{t("Unit pair")}</div>
            <div className="row-value">
              {unitA} - {unitB}
              {hasBraces && shared > 0 ? ` · shares its unit bond with ${shared} other contacts` : ''}
            </div>
          </div>
          <div className="row">
            <div className="row-label">{t("Ollivier–Ricci curvature")}</div>
            <div className="row-value">
              {value.ollivierFrac[0]}/{value.ollivierFrac[1]} = {value.ollivier.toFixed(6)}
            </div>
          </div>
          <div className="row">
            <div className="row-label">
              W<sub>1</sub>
            </div>
            <div className="row-value">
              {value.w1Frac[0]}/{value.w1Frac[1]}
            </div>
          </div>
          <div className="row">
            <div className="row-label">
              V<sub>∞</sub>
            </div>
            <div className="row-value">
              {Number.isFinite(value.vInf) ? value.vInf.toPrecision(6) : 'pending'}
              {Number.isFinite(value.vInf) && !value.converged ? ' · not fully converged' : ''}
            </div>
          </div>
          <div className="row">
            <div className="row-label">{t("Effective curvature κ")}<sub>eff</sub>
            </div>
            <div className="row-value">{displayNumber(value.kEff, 6)}</div>
          </div>
        </>
      ) : (
        <div className="row">
          <div className="row-label">{t("Reading")}</div>
          <div className="row-value">{t("waiting for computation")}</div>
        </div>
      )}
      <p className="inspector-help">Changing Bond / Brace changes rigid units and recalculates curvature. Line appearance is separate in Display settings.</p>
      <div className="inspector-actions">
        <button className="button" onClick={() => convertEdge(edge.id, edge.kind === 'bond' ? 'brace' : 'bond')}>{edge.kind === 'bond' ? t("Convert to Brace") : t("Convert to Bond")}
        </button>
        <button className="button" onClick={() => deleteEntity(item)}>{t("Delete")}{' '}</button>
      </div>
    </div>
  );
}
