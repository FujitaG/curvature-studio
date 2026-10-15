import { adoptEndedWorkspace, commitEndedProject, suspendAutosave } from '../project/autosave';
import { captureProject } from '../project/workspace';
import { serializeProject, type ProjectJson } from '../project/format';
import { selectProjectStore } from '../project/store';
import { getActiveStudioStore, selectStudioStore } from '../state/store';
import { mergeGradients } from '../state/interchange';
import { resizeCamera2d, usableGraphViewport } from '../state/camera2d';
import { readGraphViewport } from '../state/viewport';
import { WORKSPACE_CHANGED } from '../state/viewMemory';
import { comparisonSession } from './flag';
import { useComparison, type ComparisonDocument } from './store';
export type EndAppearance = 'current' | 'own';
import { useEndComparison } from './endState';
export { useEndComparison, requestEndComparison } from './endState';
export function prepareKeptProject(d: ComparisonDocument, appearance: EndAppearance): ProjectJson {
  const c = useComparison.getState(), p = captureProject(d);
  if (c.mode === 'compare' && appearance === 'current') {
    const merged = mergeGradients(d.native.custom, c.custom, { ...p.session.style, shared: c.colors });
    if (merged.customGradients.length > 1000) throw new Error('The combined gradient library is too large. Use the structure’s own display or download the comparison.');
    p.session.style = merged.style; p.session.customGradients = merged.customGradients; p.session.metric = c.metric;
  }
  // Use the reader-normalized candidate for both storage and the live appearance.
  return JSON.parse(serializeProject(p)) as ProjectJson;
}
/** The lazy 3D scene can mount after the layout frame; wait for its actual canvas. */
function focusWhenReady(kept: ComparisonDocument) {
  let observer: MutationObserver | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { observer?.disconnect(); clearTimeout(timeout); window.removeEventListener('pointerdown', cancel, true); window.removeEventListener('keydown', cancel, true); };
  const focus = () => {
    if (getActiveStudioStore() !== kept.studio || useComparison.getState().documents.length) { cancel(); return; }
    if (document.querySelector('dialog[open]')) return;
    const canvas = document.querySelector<HTMLElement>('.canvas-layer.active [data-graph-canvas]');
    if (canvas) { canvas.focus(); cancel(); }
  };
  observer = new MutationObserver(focus); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open'] });
  window.addEventListener('pointerdown', cancel, true); window.addEventListener('keydown', cancel, true);
  timeout = setTimeout(cancel, 5000); focus();
}
let busy = false;
export async function endComparison(keepId: string, appearance: EndAppearance): Promise<void> {
  if (busy) throw new Error('Comparison is already being ended.');
  busy = true;
  let release: (() => void) | undefined;
  try {
    release = await suspendAutosave();
    const c = useComparison.getState(), kept = c.documents.find(d => d.id === keepId), discarded = c.documents.find(d => d.id !== keepId);
    if (c.documents.length !== 2 || !kept || !discarded) throw new Error('The comparison changed. Choose the structure again.');
    if (kept.studio.getState().relax3dRunning) throw new Error('Finish or stop the layout in the structure you want to keep, then try again.');
    const project = prepareKeptProject(kept, appearance), discardedProject = captureProject(discarded);
    const raw = serializeProject(project);
    // Any asynchronous import/layout/edit invalidates the confirmation snapshot.
    const beforeKept = kept.studio.getState(), beforeDiscarded = discarded.studio.getState();
    const keptProject = kept.project.getState(), discardedState = discarded.project.getState();
    const valid = () => {
      const now = useComparison.getState();
      return now.documents === c.documents && now.mode === c.mode && now.colors === c.colors && now.custom === c.custom && now.metric === c.metric &&
        kept.studio.getState().doc === beforeKept.doc && discarded.studio.getState().doc === beforeDiscarded.doc &&
        kept.studio.getState().style === beforeKept.style && kept.studio.getState().customGradients === beforeKept.customGradients &&
        kept.project.getState().precision === keptProject.precision && discarded.project.getState().extensions === discardedState.extensions &&
        discarded.project.getState().figure === discardedState.figure && kept.project.getState().metadata === keptProject.metadata && discarded.project.getState().metadata === discardedState.metadata &&
        kept.project.getState().figure === keptProject.figure && kept.project.getState().extensions === keptProject.extensions &&
        kept.studio.getState().camera2d === beforeKept.camera2d && kept.studio.getState().view === beforeKept.view;
    };
    await commitEndedProject(raw, valid);
    // No awaits after the commit: publish one coherent UI transition.
    comparisonSession.applying = true;
    try {
      c.documents.forEach(d => d.stop?.());
      kept.studio.setState({ style: project.session.style, customGradients: project.session.customGradients, metric: project.session.metric });
      selectStudioStore(kept.studio); selectProjectStore(kept.project);
      comparisonSession.present = false;
      useComparison.setState({ documents: [], mode: 'single', activeId: '', previousImport: null, extensions: {}, saveStatus: 'saved', message: '' });
      kept.project.setState({ saveStatus: 'saved', saveMessage: 'Comparison ended. This structure is saved in browser.' });
      discarded.studio.getState().stopRelax3dLayout();
      useEndComparison.setState({ open: false, discarded: { side: discarded.side, project: discardedProject } });
    } finally { comparisonSession.applying = false; }
    adoptEndedWorkspace();
    window.dispatchEvent(new Event(WORKSPACE_CHANGED));
    focusWhenReady(kept);
    // Wait for the ordinary canvas to replace the pane before measuring.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (getActiveStudioStore() !== kept.studio || useComparison.getState().documents.length || kept.studio.getState().doc !== beforeKept.doc) return;
      const after = readGraphViewport(undefined, undefined, kept.studio);
      if (kept.studio.getState().view === '2d' && kept.studio.getState().camera2d === beforeKept.camera2d) {
        if (usableGraphViewport(after)) {
          kept.studio.setState({ viewport2d: after });
          if (beforeKept.camera2dMode === 'fit') kept.studio.getState().fit2d();
          else kept.studio.setState({ camera2d: resizeCamera2d(beforeKept.camera2d, beforeKept.viewport2d, after) });
        } else kept.studio.getState().pushToast('Not enough space. Hide or move a panel, then use Fit.');
      }
    }));
    kept.studio.getState().pushToast(`Comparison ended. Kept ${kept.side}; discarded ${discarded.side}.`);
  } finally { release?.(); busy = false; }
}
