import { useShallow } from 'zustand/react/shallow';
import { useComparison } from './store';
import { comparisonDistribution } from './distribution';
import { metricColor } from '../design/tokens';
export function ComparisonDistribution() {
  const c = useComparison(useShallow(s => ({documents:s.documents,metric:s.metric,distribution:s.distribution,colors:s.colors,custom:s.custom}))), [a,b] = c.documents;
  const ra = a.studio(s => s.results), rb = b.studio(s => s.results);
  const ca = a.studio(s => s.computing), cb = b.studio(s => s.computing);
  const pa = a.studio(s => s.computationPaused), pb = b.studio(s => s.computationPaused);
  const ea = a.studio(s => s.computationError), eb = b.studio(s => s.computationError);
  const na = a.project(s => s.metadata.title), nb = b.project(s => s.metadata.title);
  const metric = c.metric;
  const data = comparisonDistribution([ra,rb].map(r => r?.values.map(v => metric === 'keff' ? v.kEff : v.ollivier) ?? []), metric, c.distribution);
  const threshold = c.colors.metricGradients[metric];
  const x = (value: number) => 24 + (value-data.min)/(data.max-data.min)*204;
  return <div className="comparison-distribution">
    <label>Distribution <select aria-label="Distribution scale" value={c.distribution} onChange={e => useComparison.setState({ distribution: e.target.value as 'share'|'count' })}><option value="share">Share (%)</option><option value="count">Count</option></select></label>
    <p className="muted">{metric === 'keff' ? 'Effective curvature' : 'Ollivier–Ricci'} · shared axes</p>
    {data.series.map((series,i) => <div key={i} data-distribution-side={i ? 'B' : 'A'}>
      <p className="distribution-name">{i ? 'B' : 'A'} · {i ? nb : na}</p>
      <div className="muted">{series.n} valid / {(i ? rb : ra)?.quotientEdges.length ?? '—'} quotient bonds{(i ? cb : ca) ? ' · Partial / calculating' : ''}{(i ? eb : ea) ? ' · Calculation failed' : ''}{(i ? pb : pa) ? ' · Paused / partial' : ''}{metric==='keff' && (i?rb:ra)?.values.some(v=>v.converged===false) ? ' · Not converged' : ''}</div>
      {series.n ? <svg width="232" height="106" viewBox="0 0 232 106" aria-label={`Distribution ${i ? 'B' : 'A'}`}>
        {[0,.5,1].map(t => <g key={t}><line x1="24" x2="228" y1={76-t*62} y2={76-t*62} stroke="#dedbd5"/><text x="21" y={79-t*62} textAnchor="end" fontSize="8">{Number((data.upper*t).toFixed(1))}{c.distribution==='share'?'%':''}</text></g>)}
        {series.heights.map((height,j) => <rect key={j} x={24+j*204/data.size} y={76-height/data.upper*62} width={204/data.size-1} height={height/data.upper*62} fill={metricColor(metric, data.min+(j+.5)*(data.max-data.min)/data.size, false,c.colors,c.custom)}>
          <title>{data.min+j*(data.max-data.min)/data.size} to {data.min+(j+1)*(data.max-data.min)/data.size}: A {data.series[0].counts[j]} ({(data.series[0].n ? data.series[0].counts[j]/data.series[0].n*100:0).toFixed(1)}%), B {data.series[1].counts[j]} ({(data.series[1].n ? data.series[1].counts[j]/data.series[1].n*100:0).toFixed(1)}%)</title>
        </rect>)}
        {threshold.type === 'threshold' ? <g pointerEvents="none"><rect x={x(Math.max(data.min,threshold.threshold-threshold.width/2))} y="14" width={x(Math.min(data.max,threshold.threshold+threshold.width/2))-x(Math.max(data.min,threshold.threshold-threshold.width/2))} height="62" opacity=".08"/><line x1={x(threshold.threshold)} x2={x(threshold.threshold)} y1="14" y2="76" stroke="#222" strokeDasharray="3 2"/></g> : null}
        {[0,.25,.5,.75,1].map(t => <text key={t} x={24+t*204} y="94" textAnchor="middle" fontSize="9">{data.min+t*(data.max-data.min)}</text>)}
      </svg> : <p>No valued quotient bonds.</p>}
    </div>)}
  </div>;
}
