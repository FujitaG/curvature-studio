import { ComparisonDistribution } from '../comparison/ComparisonDistribution';
import { useComparison } from '../comparison/store';
import { ThresholdControls } from './ThresholdControls';
import { useFloatingPanel } from './useFloatingPanel';
import { getPanelLayout, setPanelLayout, subscribePanelLayout } from '../state/viewMemory';
import { navigateToEdge, focusGraphCanvas } from './navigation';
import { t } from '../i18n';
import { getHistogramPosition, setHistogramPosition } from '../state/viewMemory';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { tokens } from '../design/tokens';
import { buildHistogramFigure } from '../export/histogram';
import { strings } from '../strings';
import { edgeArray } from '../state/history';
import { useStudioStore } from '../state/store';
import { Icon } from './icons';
import { Tooltip } from './Tooltip';

export { HISTOGRAM_POS_KEY } from '../state/viewMemory';
function EffectiveMetricName(): JSX.Element {
  const [prefix] = t(strings.effectiveLong).split('κ_eff');
  return (
    <>
      {prefix}κ<sub>eff</sub>
    </>
  );
}

export function Histogram(): JSX.Element {
  const comparing = useComparison(s => s.mode === 'compare');
  const floating = useFloatingPanel(getHistogramPosition(), setHistogramPosition, 'curvature-studio:restore-histogram');
  const layout = useSyncExternalStore(subscribePanelLayout, getPanelLayout);
  const metric = useStudioStore((state) => state.metric);
  const results = useStudioStore((state) => state.results);
  const savedCollapsed = useStudioStore((state) => state.histogramCollapsed);
  const [compact,setCompact] = useState(() => window.innerWidth < 760 || window.innerHeight < 560);
  const [expandedCompact,setExpandedCompact] = useState(false);
  useEffect(() => { const resize=()=>setCompact(window.innerWidth<760 || window.innerHeight<560); window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize); },[]);
  const empty = useStudioStore(state => state.doc.vertices.size === 0);
  // No distribution to read yet: leave space for the first-visit guidance.
  // This is temporary presentation, not a change to the saved preference.
  const autoCollapsed = (comparing ? compact : empty) && !expandedCompact;
  const collapsed = savedCollapsed || autoCollapsed;
  const toggleCollapsed = useStudioStore((state) => state.toggleHistogram);
  const colorblindSafe = useStudioStore((state) => state.colorblindSafe);
  const style = useStudioStore((state) => state.style.shared);
  const customGradients = useStudioStore((state) => state.customGradients);
  const doc = useStudioStore((state) => state.doc);
  const computing = useStudioStore((state) => state.computing);
  const progress = useStudioStore((state) => state.progress);
  const setHistogramHoverBin = useStudioStore((state) => state.setHistogramHoverBin);
  const histogramHoverBin = useStudioStore((state) => state.histogramHoverBin);

  const values = useMemo(() => results?.values ?? [], [results]);
  const numeric = useMemo(() => values.map((value) => (metric === 'keff' ? value.kEff : value.ollivier)).filter(Number.isFinite), [values, metric]);
  const hasBraces = useMemo(() => [...doc.edges.values()].some((edge) => edge.kind === 'brace'), [doc.edges]);
  const figure = useMemo(() => buildHistogramFigure(numeric, metric, colorblindSafe, style, customGradients, { includeTitle: false }), [numeric, metric, colorblindSafe, style, customGradients]);
  const min = figure.min;
  const max = figure.max;
  const spread = figure.spread;
  const anyUnconverged = useMemo(() => values.some((value) => Number.isFinite(value.kEff) && value.converged === false), [values]);
  const gradient = style.metricGradients[metric];
  const threshold = gradient.type === 'threshold' ? gradient : null;
  const thresholdX = (value: number) => figure.plotX + Math.max(0, Math.min(1, (value - figure.domainMin) / (figure.domainMax - figure.domainMin))) * figure.plotWidth;

  const locateMin = () => {
    if (!results || numeric.length === 0) return;
    const entries = results.values.map((value, index) => ({ index, value: metric === 'keff' ? value.kEff : value.ollivier }));
    entries.sort((a, b) => a.value - b.value || a.index - b.index);
    const minValue = entries[0].value;
    const targets = new Set(entries.filter((entry) => Math.abs(entry.value - minValue) <= 1e-9).map((entry) => entry.index));
    const selection = edgeArray(doc)
      .filter((edge) => {
        const mapped = results.bondMap.get(edge.id);
        return typeof mapped === 'number' && targets.has(mapped);
      })
      .sort((a, b) => a.id - b.id)
      .map((edge) => ({ kind: 'edge' as const, id: edge.id }));
    if (selection.length) navigateToEdge(selection[0].id, selection);
  };

  return (
    <div ref={floating.ref} className={`histogram panel ${collapsed ? 'collapsed' : ''} ${floating.dragging ? 'panel-dragging' : ''}`} style={floating.style} role="region" aria-label="Histogram">
      <div className="hist-title" aria-label="Move histogram" {...floating.titleProps}>
        <span>Histogram</span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button className="icon-button" aria-label="Hide histogram" title="Hide histogram — restore from Panels" onClick={() => { useStudioStore.getState().setPanelVisible('histogram', false); focusGraphCanvas(); }}>×</button>
          <Tooltip content={t(metric === 'keff' ? 'Locate weakest link' : 'Locate most-negative edge')}>
            <button className="icon-button" aria-label={t("Locate minimum")} onClick={locateMin}>
              <Icon name="crosshair" />
            </button>
          </Tooltip>
          <Tooltip content={t(collapsed ? 'Expand histogram' : 'Collapse histogram')}>
            <button className="icon-button" aria-label={t(collapsed ? 'Expand histogram' : 'Collapse histogram')} onClick={() => { setHistogramHoverBin(null); if(autoCollapsed && !savedCollapsed) setExpandedCompact(true); else { setExpandedCompact(true); toggleCollapsed(); } }}>
              <Icon name="collapse" />
            </button>
          </Tooltip>
        </span>
      </div>
      {!collapsed ? <div className="hist-body">
      <div className="hist-distribution">
      {comparing ? <ComparisonDistribution /> : <>
        <div className="hist-metric">
          {metric === 'keff' ? <EffectiveMetricName /> : t(strings.ollivierShort)}{' '}
          <span className="hist-subtitle">
            n = {values.length}{' '}{t("bonds")}{hasBraces ? ` · ${t(strings.unitReading)}` : ''}
          </span>
          {Number.isFinite(spread) ? <span className="hist-subtitle">{' '}{t("· spread")}{' '}{spread.toFixed(3)}</span> : null}
          {anyUnconverged ? (
            <Tooltip content={t("slow-mixing graph - κ_eff tail may exceed tolerance")}>
              <span aria-label={t("slow-mixing graph")} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 6, background: tokens.warning, marginLeft: 6 }} />
            </Tooltip>
          ) : null}
        </div>

      {computing ? <div style={{ height: 2, marginTop: 6, background: `linear-gradient(90deg, ${tokens.accent} ${Math.round(progress * 100)}%, ${tokens.border} 0)` }} /> : null}
      {numeric.length === 0 ? (
        <div className="hist-readout" style={{ marginTop: 56 }}>
          {t(doc.edges.size === 0 ? strings.noEdges : computing ? 'Calculating…' : !results ? 'Results unavailable — open Results to retry' : values.length ? 'Effective curvature pending' : strings.noValuedBonds)}
        </div>
      ) : (
        <>
          <svg className="hist-figure" width={figure.width} height={figure.height} viewBox={`0 0 ${figure.width} ${figure.height}`} aria-label={`${figure.title} histogram`}>
            {figure.bars.map((bar, index) => {
              const active = Boolean(histogramHoverBin && Math.abs(histogramHoverBin.min - bar.min) < 1e-9 && Math.abs(histogramHoverBin.max - bar.max) < 1e-9);
              return (
                <g
                  key={index}
                  onMouseEnter={() => setHistogramHoverBin({ min: bar.min, max: bar.max })}
                  onMouseLeave={() => setHistogramHoverBin(null)}
                >
                  <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={bar.color} opacity={computing ? 0.4 : 1} />
                  {active ? <rect x={bar.x + 0.75} y={Math.max(figure.plotY, bar.y + 0.75)} width={Math.max(0, bar.width - 1.5)} height={Math.max(0, bar.height - 1.5)} fill="none" stroke={tokens.ink900} strokeWidth="1.5" pointerEvents="none" /> : null}
                </g>
              );
            })}
            {threshold ? <g className="hist-threshold-marker" pointerEvents="none">
              <rect x={thresholdX(threshold.threshold - threshold.width / 2)} y={figure.plotY} width={thresholdX(threshold.threshold + threshold.width / 2) - thresholdX(threshold.threshold - threshold.width / 2)} height={figure.plotHeight} fill={tokens.ink900} opacity="0.09" />
              <line x1={thresholdX(threshold.threshold)} x2={thresholdX(threshold.threshold)} y1={figure.plotY} y2={figure.axisY} stroke="white" strokeWidth="3" />
              <line x1={thresholdX(threshold.threshold)} x2={thresholdX(threshold.threshold)} y1={figure.plotY} y2={figure.axisY} stroke={tokens.ink900} strokeWidth="1.5" strokeDasharray="4 2" />
              <title>Color threshold {threshold.threshold}; transition width {threshold.width}</title>
            </g> : null}
            <line x1={figure.plotX} y1={figure.axisY} x2={figure.plotX + figure.plotWidth} y2={figure.axisY} stroke={tokens.border} strokeWidth="1" />
            {figure.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={tick.x} y1={figure.axisY} x2={tick.x} y2={figure.axisY + (tick.strong ? 8 : 5)} stroke={tick.strong ? tokens.ink700 : tokens.border} strokeWidth={tick.strong ? 1.25 : 1} />
                <text x={tick.x} y={figure.axisY + 24} textAnchor="middle" fill={tokens.ink500} fontSize="10" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {tick.label}
                </text>
              </g>
            ))}
            {figure.markers.map((marker) => (
              <polygon key={marker.label} points={marker.points} fill={tokens.ink500}>
                <title>{marker.label}</title>
              </polygon>
            ))}
            <text x={figure.plotX + figure.plotWidth - 4} y={figure.plotY + 10} textAnchor="end" fill={tokens.ink500} fontSize="9" style={{ fontVariantNumeric: 'tabular-nums' }}>{t("max bin =")}{' '}{figure.maxBin}
            </text>
          </svg>
          <div className="hist-readout">
            <span>{t("min")}{' '}{min.toFixed(3)}</span>
            <span>{t("spread =")}{' '}{spread.toFixed(3)}</span>
            <span>{t("max")}{' '}{max.toFixed(3)}</span>
          </div>
        </>
      )}
      </>}
      </div>
      <details className="hist-color-controls" open={layout.thresholdExpanded} onToggle={event => {
        const open = event.currentTarget.open;
        if (open !== getPanelLayout().thresholdExpanded) setPanelLayout({ ...getPanelLayout(), thresholdExpanded: open });
      }}>
        <summary>Color threshold <span>{threshold ? 'On' : 'Off'}</span></summary>
        {threshold ? <>
          <ThresholdControls key={metric} metric={metric} setting={threshold} compact onChange={next => useStudioStore.getState().setMetricGradient(metric, next)} />
          <button className="mini-button" onClick={() => useStudioStore.getState().setMetricGradient(metric, { type: 'preset', preset: 'studio' })}>Use default colors</button>
        </> : <>
          <p className="muted">Choose where colors switch while keeping the graph and its calculated values unchanged.</p>
          <button className="button" onClick={() => useStudioStore.getState().setMetricGradient(metric, { type: 'threshold', threshold: metric === 'keff' ? 0.5 : 0, width: metric === 'keff' ? 0.2 : 0.4, lowColor: '#3B4CC0', highColor: '#B40426' })}>Use threshold colors</button>
        </>}
      </details>
      </div> : null}
    </div>
  );
}
