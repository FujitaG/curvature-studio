import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { downloadText } from '../state/persistence';
import { projectFilename, serializeProject } from '../project/format';
import { downloadComparison } from './persistence';
import { useComparison } from './store';
import { Summary } from './ComparisonView';
import { endComparison, useEndComparison, type EndAppearance } from './endComparison';
export function EndComparisonDialog() {
  const open = useEndComparison(s => s.open), documents = useComparison(s => s.documents);
  return open && documents.length === 2 ? <Confirmation /> : null;
}
function Confirmation() {
  const c = useComparison();
  const [keep, setKeep] = useState(c.activeId), [appearance, setAppearance] = useState<EndAppearance>('current');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  const chosen = c.documents.find(d => d.id === keep), removed = c.documents.find(d => d.id !== keep);
  const close = () => { if (!busy) useEndComparison.setState({ open: false }); };
  return <Dialog title="End comparison" onClose={close} className="end-comparison-dialog">
    <p>Choose the structure to keep as your project.</p>
    <fieldset disabled={busy}><legend>Keep structure</legend><div className="end-comparison-choices">{c.documents.map(d => <label key={d.id}>
      <input type="radio" name="keep-structure" value={d.id} checked={keep === d.id} onChange={() => setKeep(d.id)} />
      <strong>{d.side} · {d.project.getState().metadata.title}</strong><span>{keep === d.id ? 'Keep' : 'Discard'}</span><Summary document={d} />
    </label>)}</div></fieldset>
    {c.mode === 'compare' ? <label className="field-label">Display settings<select disabled={busy} value={appearance} onChange={e => setAppearance(e.target.value as EndAppearance)}>
      <option value="current">Current comparison display</option><option value="own">Selected structure’s own display</option>
    </select></label> : <p>The selected structure keeps its own display settings.</p>}
    <p>{removed?.side} will be removed from this workspace and browser autosave. Previously downloaded files are not affected. Download the comparison to keep both structures and comparison settings.</p>
    <p className="muted">Graph editing history and the kept structure’s view are preserved. This action has no Undo.</p>
    {error ? <p role="alert">{error} Nothing was discarded.</p> : null}
    <div className="end-comparison-actions">
      <button className="button" disabled={busy} onClick={() => void downloadComparison()}>Download comparison (A + B)</button>
      <button className="button" ref={cancel} disabled={busy} onClick={close}>Cancel</button>
      <button className="button primary-button" disabled={busy || !chosen || !removed} onClick={async () => {
        setBusy(true); setError(''); try { await endComparison(keep, appearance); } catch (e) { setError(e instanceof Error ? e.message : 'Could not end comparison.'); } finally { setBusy(false); }
      }}>{busy ? 'Saving kept structure…' : `Keep ${chosen?.side} and discard ${removed?.side}`}</button>
    </div>
  </Dialog>;
}
export function DiscardedDownload() {
  const discarded = useEndComparison(s => s.discarded);
  return discarded ? <button className="button" title="Temporary recovery download; available until another project is opened, a new comparison starts, or this page reloads." onClick={() => {
    try { downloadText(projectFilename(discarded.project.metadata.title, '.curvature.json'), serializeProject(discarded.project), 'application/json'); }
    catch (e) { alert(e instanceof Error ? e.message : 'Could not download discarded structure'); }
  }}>Download discarded {discarded.side}</button> : null;
}
