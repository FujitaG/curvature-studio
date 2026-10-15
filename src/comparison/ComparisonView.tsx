import { requestEndComparison } from './endComparison';
import { CalculationSummary } from '../ui/CalculationSummary';
import { checkImportTarget } from '../import/files';
import { FileErrorNotice, fileFailure, type FileFailure } from '../ui/FileErrorNotice';
import { useShallow } from 'zustand/react/shallow';
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Canvas2D } from '../view2d/Canvas2D';
import { useComputation } from '../hooks/useComputation';
import { registerPane, rememberPaneSize, markPaneMeasured, storeInstanceKey } from './panes';
import { readGraphViewport, GRAPH_VIEWPORT_CHANGED } from '../state/viewport';
import { downloadText, readJsonFile } from '../state/persistence';
import { newMetadata, projectFilename, serializeProject } from '../project/format';
import { Dialog } from '../ui/Dialog';
import { activateDocument, captureDocument, enterComparison, fitBoth, fitDocument, replaceComparisonDocument, showSingle, useComparison, type ComparisonDocument } from './store';
const View3D = lazy(() => import('../view3d/View3D').then(m => ({ default: m.View3D })));
export function ComputationRunner({ document }: { document: ComparisonDocument }) { useComputation(document.studio); return null; }
function Name({ document }: { document: ComparisonDocument }) { const title = document.project(s => s.metadata.title); return <>{document.side} · {title}</>; }
function DocumentSwitch({ document: d, active }: { document: ComparisonDocument; active: boolean }) {
  const title = d.project(s => s.metadata.title);
  const label = `${active ? 'Viewing' : 'Show'} ${d.side} · ${title}${active ? '' : ' (hidden)'}`;
  return <button className="mini-button comparison-document-button" title={label} aria-pressed={active} onClick={() => showSingle(d.id)}>{label}</button>;
}
export function Summary({ document: d }: { document: ComparisonDocument }) {
  const doc = d.studio(s => s.doc);
  const vertices = [...doc.vertices.values()];
  const xs = vertices.map(v=>v.x), ys = vertices.map(v=>v.y);
  const minX = xs.length ? Math.min(...xs) : 0, minY = ys.length ? Math.min(...ys) : 0;
  const span = Math.max(1e-9, (xs.length ? Math.max(...xs) : 0)-minX, (ys.length ? Math.max(...ys) : 0)-minY);
  const point = (id: number) => { const v=doc.vertices.get(id)!; return { x:8+(v.x-minX)/span*64,y:8+(v.y-minY)/span*64 }; };
  return <><svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">{[...doc.edges.values()].map(e=><line key={e.id} x1={point(e.a).x} y1={point(e.a).y} x2={point(e.b).x} y2={point(e.b).y} stroke="currentColor"/>)}{vertices.map(v=><circle key={v.id} cx={point(v.id).x} cy={point(v.id).y} r="2" fill="currentColor"/>)}</svg><small>{doc.vertices.size} vertices · {doc.edges.size} edges</small></>;
}
export function CompareButton() {
  const c = useComparison(useShallow(s => ({mode:s.mode,documents:s.documents}))); const [choose, setChoose] = useState(false);
  return <>
    <button className="button compare-button" onClick={() => c.mode === 'compare' ? setChoose(true) : enterComparison()} aria-haspopup={c.mode === 'compare' ? 'dialog' : undefined}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1" y="2" width="16" height="14" rx="2" />{c.mode !== 'compare' ? <path d="M9 2v14" /> : null}</svg>
      {c.mode === 'compare' ? 'Single view' : 'Compare'}
      {c.mode === 'compare' ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4l3 4 3-4" fill="none" stroke="currentColor"/></svg> : null}
    </button>
    {choose ? <Dialog title="Single view options" onClose={() => setChoose(false)}>
      <section className="single-view-section" aria-labelledby="single-show-heading">
        <div className="single-section-heading"><h3 id="single-show-heading">Show one structure</h3><span>Keep both</span></div>
        <p>Only the view changes. A and B stay in this workspace.</p>
        <div className="single-choices">{c.documents.map(d => <button key={d.id} className="button" onClick={() => { setChoose(false); showSingle(d.id); }}><span className="single-choice-name">Show <Name document={d} /></span><Summary document={d}/></button>)}</div>
      </section>
      <section className="single-view-section" aria-labelledby="single-end-heading">
        <div className="single-section-heading"><h3 id="single-end-heading">End comparison</h3><span>Keep one</span></div>
        <p id="single-end-description">Choose A or B to keep. The other is removed from this workspace.</p>
        <button className="button single-end-button" aria-describedby="single-end-description" onClick={() => { setChoose(false); requestEndComparison(); }}>End comparison…</button>
      </section>
    </Dialog> : null}
  </>;
}
function Pane({ document: d, ratio }: { document: ComparisonDocument; ratio: number }) {
  const ref = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const c = useComparison(useShallow(s => ({mode:s.mode,activeId:s.activeId,documents:s.documents}))); const view = d.studio(s => s.view), doc = d.studio(s => s.doc);
  const [error, setError] = useState('');
  const [importError, setImportError] = useState<FileFailure | null>(null); const openRequest = useRef(0);
  useLayoutEffect(() => {
    const root = ref.current; if (!root) return;
    registerPane(d.studio, root);
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      rememberPaneSize(d.studio,root);
      const area = readGraphViewport(undefined, undefined, d.studio);
      d.studio.getState().resizeViewport2d(area); markPaneMeasured(d.studio); window.dispatchEvent(new Event(GRAPH_VIEWPORT_CHANGED));
    }); };
    const observer = new ResizeObserver(measure); observer.observe(root); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); registerPane(d.studio, null); };
  }, [d]);
  return <section className={`comparison-pane ${c.activeId === d.id ? 'editing' : ''}`} style={{ flex: c.mode === 'compare' ? (d.side === 'A' ? ratio : 100 - ratio) : 1 }} data-document-id={d.id} onPointerDownCapture={() => activateDocument(d.id)} onFocusCapture={() => activateDocument(d.id)} aria-label={`Structure ${d.side}`}>
    <header className="comparison-pane-header"><span className="pane-name" title={d.project.getState().metadata.title}><Name document={d} /></span><span className="editing-label">{c.activeId === d.id ? 'Editing' : ''}</span>
      <CalculationSummary project={d.project} compact scope={d.side} />
      <button className="mini-button" onClick={() => input.current?.click()}>Open {d.side}</button>
      <button className="mini-button" onClick={() => fitDocument(d)}>Fit {d.side}</button>
      <details className="pane-menu"><summary aria-label={`Options for ${d.side}`}>⋯</summary><div className="panel">
        <button className="menu-item" onClick={() => showSingle(d.id)}>Show only <Name document={d} /></button>
        <button className="menu-item" onClick={() => { try { const p = captureDocument(d); downloadText(projectFilename(p.metadata.title, '.curvature.json'), serializeProject(p), 'application/json'); } catch (error) { setError(error instanceof Error ? error.message : 'Could not export project'); } }}>Export {d.side} only</button>
        <button className="menu-item" onClick={() => { const other = c.documents.find(o => o !== d)!; const copy=captureDocument(d); copy.metadata={...newMetadata(`${copy.metadata.title} — copy`.slice(0,120)),notes:copy.metadata.notes}; replaceComparisonDocument(other, copy); }}>Duplicate to other side</button>
      </div></details>
    </header>
    <input hidden type="file" ref={input} aria-label={`Open project ${d.side}`} accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; const request=++openRequest.current; setImportError(null); try { const value = await readJsonFile(file); checkImportTarget(value, 'project'); if(request!==openRequest.current || !useComparison.getState().documents.includes(d))return; replaceComparisonDocument(d, value as never); setError(''); } catch (e) { if(request === openRequest.current) setImportError(fileFailure(file, e)); } finally { if (request === openRequest.current && input.current) input.current.value = ''; } }} />
    <div className="comparison-canvas" ref={ref}>{view === '2d' ? <Canvas2D store={d.studio} /> : <Suspense fallback={<p>Loading 3D…</p>}><View3D store={d.studio} /></Suspense>}
    {!doc.vertices.size ? <p className="pane-empty">Open a project or use Templates to start structure {d.side}.</p> : null}</div>
    {importError ? <FileErrorNotice failure={importError} onDismiss={() => setImportError(null)} className="pane-error" /> : null}
    {error ? <div role="alert" className="pane-error panel">{error}<button onClick={() => setError('')}>Dismiss</button></div> : null}
  </section>;
}
export function ComparisonView() {
  const c = useComparison(useShallow(s => ({mode:s.mode,activeId:s.activeId,documents:s.documents,ratio:s.ratio,linked:s.linked}))), surface = useRef<HTMLDivElement>(null);
  const setRatio = (ratio: number) => useComparison.setState({ ratio: Math.min(75, Math.max(25, ratio)) });
  const drag = useRef(false);
  const [draftRatio,setDraftRatio] = useState<number | null>(null);
  const [compact,setCompact] = useState(false), [stacked,setStacked] = useState(false);
  useLayoutEffect(() => {
    const root=surface.current; if(!root)return;
    const measure=()=>{setCompact(root.clientHeight<260 || root.clientWidth<760);setStacked(root.clientWidth<760);};
    const observer=new ResizeObserver(measure);observer.observe(root);measure();return()=>observer.disconnect();
  },[]);
  const ratio = draftRatio ?? c.ratio;
  const finishDrag = () => {drag.current=false;if(draftRatio!==null)setRatio(draftRatio);setDraftRatio(null);};
  return <>
    <div className="comparison-controls">
      {c.mode === 'compare' ? <><label><input type="checkbox" checked={c.linked} onChange={e => useComparison.setState({ linked: e.target.checked })} />Link rotation &amp; zoom</label><button className="mini-button" onClick={fitBoth}>Fit both</button><button className="mini-button" onClick={() => setRatio(50)}>Reset split</button></> : c.documents.map(d => <DocumentSwitch key={d.id} document={d} active={c.activeId === d.id} />)}
    </div>
    {compact && c.mode==='compare' ? <div className="comparison-tabs" role="group" aria-label="Compact comparison"><span>Compare:</span>{c.documents.map(d=><button className="button" key={d.id} aria-pressed={c.activeId===d.id} onClick={()=>activateDocument(d.id)}><Name document={d}/></button>)}</div>:null}
    <div ref={surface} className={`comparison-surface ${c.mode} ${compact ? 'compact-comparison' : ''}`}>
      {c.documents.filter(d => c.mode === 'compare' && !compact || d.id === c.activeId).map((d,i) => <div key={storeInstanceKey(d.studio)} className="pane-container" style={{ display: 'contents' }}>
        {i ? <div className="comparison-divider" role="separator" tabIndex={0} aria-label="Resize structure A" aria-orientation={stacked?'horizontal':'vertical'} aria-valuenow={Math.round(ratio)} aria-valuemin={25} aria-valuemax={75} onDoubleClick={() => setRatio(50)} onKeyDown={e => { if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Home','End'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setRatio(e.key === 'Home' ? 25 : e.key === 'End' ? 75 : c.ratio + (['ArrowLeft','ArrowUp'].includes(e.key) ? -2 : 2)); } }} onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (!drag.current || !surface.current) return; const r = surface.current.getBoundingClientRect(); const vertical = getComputedStyle(surface.current).flexDirection === 'column'; setDraftRatio(Math.min(75,Math.max(25,100 * (vertical ? (e.clientY-r.top)/r.height : (e.clientX-r.left)/r.width)))); }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} /> : null}
        <Pane document={d} ratio={ratio} />
      </div>)}
    </div>
  </>;
}
