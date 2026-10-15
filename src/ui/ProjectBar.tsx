import { DiscardedDownload } from '../comparison/EndComparisonDialog';
import { checkImportTarget } from '../import/files';
import { FileErrorNotice, fileFailure, type FileFailure } from './FileErrorNotice';
import { useComparison, replaceComparisonDocument } from '../comparison/store';
import { downloadPreviousWork, downloadComparison, readComparisonFile, openComparison } from '../comparison/persistence';
import { activeDocument } from '../project/workspace';
import { t } from '../i18n';
import { shortcut } from '../shortcuts';
import { useEffect, useRef, useState } from 'react';
import { downloadText } from '../state/persistence';
import { useStudioStore } from '../state/store';
import { getRecoveryText, useRecoverySources, deleteRecoverySource, openRecoverySource, replaceUnreadableAutosave } from '../project/autosave';
import { parseProjectJson, projectFilename, serializeProject } from '../project/format';
import { applyProject, captureProject, restorePreviousProject, undoWorkspace } from '../project/workspace';
import { useProjectStore } from '../project/store';
import { Dialog } from './Dialog';

export function downloadProject(): void {
  if (useComparison.getState().documents.length) { void downloadComparison(); return; }
  try {
    const project = captureProject();
    project.metadata.updatedAt = new Date(Math.max(Date.now(), Date.parse(project.metadata.createdAt))).toISOString();
    downloadText(projectFilename(project.metadata.title, '.curvature.json'), serializeProject(project), 'application/json');
    useStudioStore.getState().pushToast('Project downloaded — includes graph, notes, and display settings');
  } catch (error) { useStudioStore.getState().pushToast(`Project was not downloaded: ${error instanceof Error ? error.message : 'Could not prepare the file. Try again.'}`); }
}

export function ProjectBar(): JSX.Element {
  const comparison = useComparison();
  const recoverySources = useRecoverySources(s => s.sources);
  const recoveryFull = useRecoverySources(s => s.capacityWarning);
  const paired = comparison.documents.length > 0;
  const metadata = useProjectStore((state) => state.metadata);
  const setTitle = useProjectStore((state) => state.setTitle);
  const setNotes = useProjectStore((state) => state.setNotes);
  const singleSaveStatus = useProjectStore((state) => state.saveStatus);
  const saveStatus = paired || comparison.saveStatus === 'recovery' ? comparison.saveStatus : singleSaveStatus;
  const singleSaveMessage = useProjectStore((state) => state.saveMessage);
  const saveMessage = paired || comparison.saveStatus === 'recovery' ? comparison.message : singleSaveMessage;
  const resultsOpen = useProjectStore((state) => state.resultsOpen);
  const setResultsOpen = useProjectStore((state) => state.setResultsOpen);
  const previousAction = useProjectStore((state) => state.previousAction);
  const previous = useProjectStore((state) => state.previousProject);
  const canUndo = useStudioStore((state) => state.historyPast.length > 0);
  const canRedo = useStudioStore((state) => state.historyFuture.length > 0);
  const [details, setDetails] = useState(false);
  const [fileError, setFileError] = useState<FileFailure | null>(null);
  const [opening, setOpening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const openRequest = useRef(0);
  const storageProblem = !['saved', 'pending'].includes(saveStatus);

  useEffect(() => { document.title = `${metadata.title.trim() || 'Untitled project'} · Curvature Studio`; }, [metadata.title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); downloadProject(); }
      if (event.key.toLowerCase() === 'o' && !document.querySelector('dialog[open]')) { event.preventDefault(); fileRef.current?.click(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openProject = async (file: File | undefined) => {
    if (!file) return;
    const target = activeDocument();
    const request = ++openRequest.current;
    setOpening(true); setFileError(null);
    try {
      const input = await readComparisonFile(file);
      checkImportTarget(input, 'workspace');
      if ((input as { format?: string }).format === 'curvature-studio/workspace') { if (request === openRequest.current) openComparison(input); return; }
      if (file.size > 8 * 1024 * 1024) throw new Error('This project exceeds 8 MiB. Use a smaller project file.');
      if (request !== openRequest.current) return;
      const parsed = parseProjectJson(input, file.name.replace(/(?:\.curvature)?\.json$/i, ''));
      const document = useComparison.getState().documents.find(d => d.studio === target.studio);
      if (document) replaceComparisonDocument(document, input as never); else applyProject(parsed, true, target);
      if ((input as { format?: string }).format === 'curvature-studio/doc') useStudioStore.getState().fit2d();
      useStudioStore.getState().pushToast(t('Opened {name}. “Undo open” restores the previous project.', { name: parsed.metadata.title }));
    } catch (error) { if (request === openRequest.current) setFileError(fileFailure(file, error)); }
    finally { if (request === openRequest.current) { setOpening(false); if (fileRef.current) fileRef.current.value = ''; } }
  };

  return <>
    <div className="project-bar" aria-label={t("Project controls")}>
      <div className="project-identity">
        <input className="project-name" aria-label={t("Project name")} maxLength={120} value={metadata.title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (!metadata.title.trim()) setTitle('Untitled project'); }} />
        <span className={`save-status ${storageProblem ? 'attention' : ''}`} role="status" title={t(saveMessage)}>{t(saveStatus === 'saved' ? (paired ? 'Both structures saved in browser' : 'Saved in browser') : saveStatus === 'pending' ? 'Saving…' : 'Autosave needs attention')}</span>
      </div>
      <div className="project-actions">
        <DiscardedDownload />
        {comparison.previousImport ? <button className="button" onClick={()=>void downloadPreviousWork()} title="The work present before Open comparison; retained until the next comparison is opened or this page reloads">Download previous work</button> : null}
        {paired && previous ? <button className="button" onClick={restorePreviousProject}>{previousAction === 'new' ? 'Undo new project' : 'Undo open'}</button> : null}
        <button className="button" aria-label={t("Undo")} title={`${t('Undo')} · ${shortcut('z')}`} disabled={!canUndo && previousAction !== 'new'} onClick={undoWorkspace}>↶</button>
        <button className="button" aria-label={t("Redo")} title={`${t('Redo')} · ${shortcut('shift+z')}`} disabled={!canRedo} onClick={() => useStudioStore.getState().redo()}>↷</button>
        <button className="button" onClick={() => setDetails(true)}>{t("Notes")}</button>
        <button className="button" onClick={() => fileRef.current?.click()} disabled={opening}>{t(opening ? 'Opening…' : 'Open project')}</button>
        <button className="button primary-button" onClick={downloadProject}>{paired ? "Save comparison (A + B)" : t("Save project")}</button>
        <button className={`button ${resultsOpen ? 'active' : ''}`} aria-pressed={resultsOpen} aria-controls="results-panel" onClick={() => setResultsOpen(!resultsOpen)}>{t("Results")}</button>
        <button className="button" onClick={() => useStudioStore.getState().setShortcutSheetOpen(true)}>{t("Guide")}</button>
      </div>
      <input ref={fileRef} data-testid="project-file-input" type="file" accept="application/json,.json" hidden onChange={(event) => void openProject(event.target.files?.[0])} />
    </div>
    <div className="project-notices">
    {recoveryFull ? <div className="project-notice panel" role="alert">Emergency recovery copies are full (up to 4 copies / 2 MiB). Download or delete old recovery copies below. Normal browser autosave is separate.</div> : null}
    {recoverySources.map((source, index) => <div className="project-notice panel" key={source.journalKey ?? index} role="status"><span>{source.message}</span>
      <button className="button" onClick={() => downloadText(source.name, source.raw, 'application/json')}>Download recovery data</button>
      <button className="button" onClick={() => { if (!confirm('Open this recovery as a project? Undo open will restore the current project.')) return; try { openRecoverySource(source); } catch(e) { useStudioStore.getState().pushToast(e instanceof Error ? e.message : 'Could not open recovery'); } }}>Open recovery…</button>
      {source.journalKey ? <button className="button" onClick={async () => { if (!confirm('Delete this emergency recovery copy? Download it first if you need it. The current workspace is kept.')) return; try { await deleteRecoverySource(source); } catch(e) { useStudioStore.getState().pushToast(e instanceof Error ? e.message : 'Could not delete recovery'); } }}>Delete recovery copy…</button> : null}
      <button className="button" title="Hides this notice for now. Recovery data is kept." onClick={() => useRecoverySources.setState({sources: recoverySources.filter(s => s !== source)})}>Hide notice</button></div>)}
    {fileError ? <FileErrorNotice failure={fileError} onDismiss={() => setFileError(null)} className="project-notice" /> : null}
    {!fileError && storageProblem ? <div className="project-notice panel" role="alert">
      <span>{t(saveMessage)}</span>
      <>
        {getRecoveryText() ? <button className="button" onClick={() => downloadText('curvature-recovery.txt', getRecoveryText()!, 'text/plain')}>{t("Download recovery file")}</button> : null}
        <button className="button" onClick={downloadProject}>{paired ? "Download both structures" : t("Download project")}</button>
        {getRecoveryText() ? <button className="button" onClick={async () => { if (!confirm('Replace the unreadable autosave with the current workspace? The original bytes will be kept as recovery data.')) return; try { await replaceUnreadableAutosave(); } catch(e) { useStudioStore.getState().pushToast(e instanceof Error ? e.message : 'Could not replace autosave'); } }}>Replace unreadable autosave…</button> : <button className="button" onClick={() => window.dispatchEvent(new Event(paired ? 'curvature-studio:resume-comparison' : 'curvature-studio:resume-autosave'))}>{saveStatus === 'error' ? 'Retry autosave' : paired ? 'Resume with both structures' : 'Resume with this project'}</button>}
      </>
    </div> : null}
    </div>
    {previous && !paired ? <button className="button undo-open" onClick={restorePreviousProject} title={t('Restore the previous graph, name, notes, and display settings')}>{t(previousAction === 'new' ? 'Undo new project' : 'Undo open')}</button> : null}
    {details ? <Dialog title={t("Project notes")} onClose={() => setDetails(false)}>
      <p className="muted">{t("Record the purpose, source, or interpretation of this graph. Notes travel with your project file.")}</p>
      <label className="field-label" htmlFor="project-notes">{t("Notes")}</label>
      <textarea id="project-notes" rows={9} maxLength={10000} value={metadata.notes} onChange={(event) => setNotes(event.target.value)} placeholder={t("Example: Cube with a rigid diagonal. Compare the two curvature measures after adding braces.")} />
      <p className="muted">{metadata.notes.length.toLocaleString()}{' '}{t("/ 10,000 characters · Created")}{' '}{new Date(metadata.createdAt).toLocaleDateString()}</p>
      <p className="muted">{t("Browser autosave is local to this browser and address. Use Save project for a file you can move, archive, or share.")}</p>
    </Dialog> : null}
  </>;
}
