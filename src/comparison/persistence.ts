import { clearDiscarded } from './endState';
import { createStudioStore } from '../state/store';
import { createProjectStore } from '../project/store';
import { applyProject, captureProject } from '../project/workspace';
import { parseProjectJson, serializeProject } from '../project/format';
import { downloadText, readJsonFile } from '../state/persistence';
import { WORKSPACE_CHANGED } from '../state/viewMemory';
import { captureDocument, documentRecord, restoreComparisonState, useComparison } from './store';
import { parseWorkspace, MAX_WORKSPACE_BYTES, type WorkspaceJson } from './format';
import { comparisonSession } from './flag';
export function captureComparison(): WorkspaceJson {
    const c = useComparison.getState();
    return { format: 'curvature-studio/workspace', version: 1, documents: c.documents.map(d => ({ id: d.id, side: d.side, project: captureDocument(d), viewport2d: { ...d.studio.getState().viewport2d }, camera2dMode: d.studio.getState().camera2dMode })), mode: c.mode, activeId: c.activeId, ratio: c.ratio, linked: c.linked, distribution: c.distribution, metric: c.metric, view: c.view, projection: c.projection, colors: structuredClone(c.colors), custom: structuredClone(c.custom), extensions: structuredClone(c.extensions) };
}
export function serialize(value: WorkspaceJson): Promise<string> {
    return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' });
        }
        catch (error) {
            reject(error);
            return;
        }
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Preparing the comparison took too long. Export each structure separately.')); }, 30000);
        worker.onmessage = e => { clearTimeout(timeout); worker.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.raw); };
        worker.onerror = e => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message || 'Could not prepare comparison')); };
        try {
            worker.postMessage(value);
        }
        catch (error) {
            clearTimeout(timeout);
            worker.terminate();
            reject(error);
        }
    });
}
export function openComparison(input: unknown, rememberPrevious = true) {
    const value = parseWorkspace(input);
    const previousImport = rememberPrevious ? (useComparison.getState().documents.length ? captureComparison() : captureProject()) : null;
    // Build and validate both controllers before publishing either to the UI.
    const documents = value.documents.map(item => {
        const target = { studio: createStudioStore(), project: createProjectStore() };
        applyProject(parseProjectJson(item.project), false, target);
        target.studio.setState({ camera2d: { ...item.project.session.camera2d }, viewport2d: { ...item.viewport2d }, camera2dMode: item.camera2dMode });
        return { ...documentRecord(target, item.side), id: item.id };
    });
    clearDiscarded();
    comparisonSession.applying = true;
    try {
        restoreComparisonState({ ...value, documents });
        useComparison.setState({previousImport});
    }
    finally {
        comparisonSession.applying = false;
    }
    window.dispatchEvent(new Event(WORKSPACE_CHANGED));
}
export async function downloadComparison() {
    try {
        const raw = await serialize(captureComparison());
        downloadText('comparison.curvature-workspace.json', raw, 'application/json');
    }
    catch (error) {
        useComparison.setState({ saveStatus: 'error', message: error instanceof Error ? error.message : 'Could not download comparison' });
    }
}
export const readComparisonFile = (file: File) => readJsonFile(file, MAX_WORKSPACE_BYTES);

export async function downloadPreviousWork() {
  const previous=useComparison.getState().previousImport; if(!previous)return;
  try { const raw=previous.format==='curvature-studio/workspace'?await serialize(previous):serializeProject(previous);downloadText(previous.format==='curvature-studio/workspace'?'previous-work.curvature-workspace.json':'previous-work.curvature.json',raw,'application/json'); }
  catch(error) { useComparison.setState({saveStatus:'error',message:error instanceof Error?error.message:'Could not download previous work'}); }
}
