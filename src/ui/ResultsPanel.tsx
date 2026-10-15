import { CalculationSummary } from './CalculationSummary';
import { EFFECTIVE_EVIDENCE_DESCRIPTION } from '../results/evidence';
import { navigateToEdge } from './navigation';
import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { completeResult, currentResult, displayNumber, filterRows, resultRows, statusLabel, type ResultSort } from '../results/model';
import { useStudioStore } from '../state/store';
import { useProjectStore } from '../project/store';
import { projectFilename } from '../project/format';
import { downloadText } from '../state/persistence';
import { renderValuesCsv } from '../export/csv';
import { resultsToJson } from '../export/results';

export function ResultsPanel(): JSX.Element | null {
  const doc = useStudioStore((state) => state.doc);
  const results = useStudioStore((state) => state.results);
  const computing = useStudioStore((state) => state.computing);
  const paused = useStudioStore((state) => state.computationPaused);
  const error = useStudioStore((state) => state.computationError);
  const selected = useStudioStore((state) => state.selection);
  const open = useProjectStore((state) => state.resultsOpen);
  const setOpen = useProjectStore((state) => state.setResultsOpen);
  const precision = useProjectStore((state) => state.precision);
  const setPrecision = useProjectStore((state) => state.setPrecision);
  const metadata = useProjectStore((state) => state.metadata);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'valued' | 'attention'>('all');
  const [sort, setSort] = useState<ResultSort>('keff');
  const [descending, setDescending] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const selectedEdges = useMemo(() => new Set(selected.filter((item) => item.kind === 'edge').map((item) => item.id)), [selected]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = useMemo(() => open ? resultRows(doc, results) : [], [open, doc, results]);
  const filtered = useMemo(() => filterRows(rows, query, filter, sort, descending), [rows, query, filter, sort, descending]);
  const current = currentResult(doc, results);
  const ready = open && completeResult(doc, results);
  const unconverged = rows.filter((row) => row.status === 'not-converged').length;
  // A new query/order starts at the first match; incoming results and selection keep the scroll position.
  useEffect(() => { if (tableRef.current) tableRef.current.scrollTop = 0; }, [query, filter, sort, descending, doc]);
  useEffect(() => { if (open) headingRef.current?.focus(); }, [open]);
  if (!open) return null;
  const close = () => { setOpen(false); document.querySelector<HTMLButtonElement>('[aria-controls="results-panel"]')?.focus(); };
  const selectEdge = navigateToEdge;
  const exportResults = (type: 'csv' | 'json') => {
    if (!ready || !results) return;
    try {
      const body = type === 'csv' ? renderValuesCsv(doc, results) : JSON.stringify(resultsToJson(doc, results, metadata), null, 2);
      downloadText(projectFilename(metadata.title, `.results.${type}`), body, type === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
    } catch (error) { useStudioStore.getState().pushToast(error instanceof Error ? error.message : 'Export failed'); }
  };
  const orderBy = (next: ResultSort) => { if (sort === next) setDescending(!descending); else { setSort(next); setDescending(false); } };
  const ariaSort = (key: ResultSort) => sort === key ? descending ? 'descending' as const : 'ascending' as const : 'none' as const;
  return <section id="results-panel" className="results-panel panel" aria-label={t("Graph results")} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <div className="dialog-title"><h2 ref={headingRef} tabIndex={-1}>{t("Results")}</h2><button className="button" onClick={close}>{t("Close results")}</button></div>
    <p className="result-summary">{doc.vertices.size}{' '}{t("vertices ·")}{' '}{doc.edges.size}{' '}{t("drawn edges ·")}{' '}{current?.quotientEdges.length ?? '—'}{' '}{t("quotient bonds")}</p>
    <div className={`result-state ${error || paused || unconverged ? 'attention' : ''}`} role="status">
      {error ? t(error) : t(paused ? 'Calculation stopped. Partial values are shown; restart to export all results.' : computing ? 'Calculating. Ollivier values appear first; effective curvature follows.' : ready ? unconverged ? '{count} drawn bonds did not meet the stopping rule; their remaining variance tail is unknown. All effective values are estimates.' : 'Calculation complete.' : 'Waiting for results.', { count: unconverged })}
      {error || paused ? <button className="button" onClick={() => useStudioStore.getState().retryComputation()}>{t("Retry calculation")}</button> : computing ? <button className="button" onClick={() => useStudioStore.getState().stopComputation()}>{t("Stop calculation")}</button> : null}
    </div>
    <CalculationSummary />
    <details className="result-explanation"><summary>{t("How to read these results")}</summary>
      <p>{t("Ollivier–Ricci curvature compares one-step probability distributions. Effective curvature measures accumulated variance over repeated steps. Both use a ½-lazy walk on the unweighted graph.")}</p>
      <p>{t("Braces merge vertices into rigid units. Bonds within a unit have no curvature value. Multiple drawn bonds can share one quotient bond; the histogram counts each quotient bond once.")}</p>
      <p>{EFFECTIVE_EVIDENCE_DESCRIPTION}</p>
      <p>{t("“Converged” means the numerical tail stopping criterion was met (tolerance 10⁻¹⁰, at most 200,000 iterations). It is not a proof certificate. Display rounding does not change exports.")}</p>
    </details>
    <div className="results-filters">
      <label>{t("Find an edge")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("e12, v3, brace…")} /></label>
      <label>{t("Show")}<select aria-label={t("Show edges")} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">{t("All edges")}</option><option value="valued">{t("Valued bonds")}</option><option value="attention">{t("Pending / not converged")}</option></select></label>
      <label>{t("Decimals")}<select aria-label={t("Decimals")} value={precision} onChange={(event) => setPrecision(Number(event.target.value))}>{Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    <p className="results-count" role="status">{filtered.length === rows.length ? `${rows.length} edges` : `${filtered.length} of ${rows.length} edges`}</p>
    <div ref={tableRef} className="results-table-wrap" tabIndex={0} aria-label={t("Scrollable edge results")}>
      <table className="results-table"><caption className="sr-only">{t("One row per drawn edge. Select an edge to locate it on the graph. Sort by clicking a column heading.")}</caption>
        <thead><tr>
          <th scope="col" aria-sort={ariaSort('edge')}><button onClick={() => orderBy('edge')}>{t("Edge")}{' '}{sort === 'edge' ? descending ? '↓' : '↑' : ''}</button></th>
          <th scope="col" aria-sort={ariaSort('ollivier')}><button onClick={() => orderBy('ollivier')}>{t("Ollivier")}{' '}{sort === 'ollivier' ? descending ? '↓' : '↑' : ''}</button></th>
          <th scope="col" aria-sort={ariaSort('keff')}><button onClick={() => orderBy('keff')}>κ<sub>eff</sub> {sort === 'keff' ? descending ? '↓' : '↑' : ''}</button></th>
          <th scope="col">{t("Status / steps")}</th>
        </tr></thead>
        <tbody>{filtered.map(({ edge, value, status }) => <tr key={edge.id} className={selectedEdges.has(edge.id) ? 'selected' : ''}>
          <th scope="row"><button className="edge-link" onClick={() => selectEdge(edge.id)} aria-label={t('Locate edge e{id}', { id: edge.id })}>e{edge.id}<small>v{edge.a}–v{edge.b}</small></button></th>
          <td title={value ? `${value.ollivierFrac[0]}/${value.ollivierFrac[1]}` : undefined}>{displayNumber(value?.ollivier, precision)}{value ? <small>{value.ollivierFrac[0]}/{value.ollivierFrac[1]}</small> : null}</td>
          <td>{displayNumber(value?.kEff, precision)}</td>
          <td className={status === 'not-converged' ? 'attention' : ''}>{t(statusLabel[status])}{value && Number.isFinite(value.kEff) ? <small>{value.iterations.toLocaleString()}{' '}{t("steps")}</small> : null}</td>
        </tr>)}</tbody>
      </table>
      {!filtered.length ? <p className="results-empty">{t(doc.edges.size === 0 ? 'Choose a template or draw a bond to calculate curvature.' : 'No edges match these filters.')}</p> : null}
    </div>
    <div className="results-downloads"><button className="button" disabled={!ready || !doc.edges.size} onClick={() => exportResults('csv')}>{t("Download CSV")}</button><button className="button" disabled={!ready || !doc.edges.size} onClick={() => exportResults('json')}>{t("Download results JSON")}</button></div>
    <p className="muted export-caption">{t("Exports include all drawn edges at full precision. Results JSON also includes graph inputs, exact Ollivier fractions, calculation settings, and convergence details.")}</p>
  </section>;
}
