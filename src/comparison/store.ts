import { clearDiscarded } from './endState';
import { requestPaneFit } from './panes';
import { create } from 'zustand';
import { createStudioStore, getActiveStudioStore, selectStudioStore } from '../state/store';
import { createProjectStore, getActiveProjectStore, selectProjectStore } from '../project/store';
import { activeDocument, applyProject, applyingProject, captureProject, type DocumentTarget } from '../project/workspace';
import { newMetadata, parseProjectJson, type ProjectJson } from '../project/format';
import { getHistogramPosition, WORKSPACE_CHANGED } from '../state/viewMemory';
import { readGraphViewport } from '../state/viewport';
import { comparisonSession } from './flag';
import type { MetricMode, ViewMode, ProjectionMode } from '../state/types';
import type { SharedStyle, SavedGradient } from '../state/style';
import type { Camera2d } from '../state/types';
import { usableGraphViewport } from '../state/camera2d';
export interface ComparisonDocument extends DocumentTarget {
    id: string;
    side: 'A' | 'B';
    native: {
        shared: SharedStyle;
        custom: SavedGradient[];
        labels: boolean;
        metric: MetricMode;
    };
    stop?: () => void;
}
interface ComparisonState {
    previousImport: import('./format').WorkspaceJson | ProjectJson | null;
    documents: ComparisonDocument[];
    mode: 'single' | 'compare';
    activeId: string;
    ratio: number;
    linked: boolean;
    distribution: 'share' | 'count';
    metric: MetricMode;
    view: ViewMode;
    projection: ProjectionMode;
    colors: SharedStyle;
    custom: SavedGradient[];
    extensions: Record<string, import('../project/format').JsonValue>;
    saveStatus: 'saved' | 'pending' | 'error' | 'conflict' | 'recovery';
    message: string;
}
const initial = getActiveStudioStore().getState();
export const useComparison = create<ComparisonState>(() => ({ previousImport: null, documents: [], mode: 'single', activeId: '', ratio: 50, linked: true, distribution: 'share', metric: initial.metric, view: initial.view, projection: initial.projection, colors: initial.style.shared, custom: initial.customGradients, extensions: {}, saveStatus: 'pending', message: '' }));
let synchronizing = false;
/** Locate is local navigation, not a linked zoom gesture. Keep the peer's view. */
export function setLocalCamera2d(camera: Camera2d): void {
    const previous = synchronizing;
    synchronizing = true;
    try { getActiveStudioStore().getState().setCamera2d(camera); }
    finally { synchronizing = previous; }
}
export function documentRecord(target: DocumentTarget, side: 'A' | 'B'): ComparisonDocument {
    const s = target.studio.getState();
    return { ...target, id: crypto.randomUUID(), side, native: { shared: s.style.shared, custom: s.customGradients, labels: s.labelsVisible, metric: s.metric } };
}
export function captureDocument(doc: ComparisonDocument): ProjectJson {
    const value = captureProject(doc);
    value.metadata.updatedAt = new Date(Math.max(Date.now(), Date.parse(value.metadata.createdAt))).toISOString();
    return value;
}
function applyShared() {
    const c = useComparison.getState();
    synchronizing = true;
    try {
        for (const d of c.documents) {
            const s = d.studio.getState();
            d.studio.setState({ metric: c.metric, view: c.view, projection: c.projection, customGradients: c.custom, style: { ...s.style, shared: c.colors } });
        }
    }
    finally {
        synchronizing = false;
    }
}
export function watchDocument(d: ComparisonDocument) {
    d.stop?.();
    d.stop = d.studio.subscribe((s, before) => {
        if (synchronizing || comparisonSession.applying || applyingProject)
            return;
        const c = useComparison.getState();
        // Label visibility is per document, not a shared comparison overlay.
        if (s.labelsVisible !== before.labelsVisible) d.native.labels = s.labelsVisible;
        if (c.mode === 'compare' && (s.metric !== before.metric || s.view !== before.view || s.projection !== before.projection || s.style.shared !== before.style.shared || s.customGradients !== before.customGradients)) {
            useComparison.setState({ metric: s.metric, view: s.view, projection: s.projection, colors: s.style.shared, custom: s.customGradients });
            applyShared();
        }
        else if (c.mode === 'single')
            d.native = { shared: s.style.shared, custom: s.customGradients, labels: s.labelsVisible, metric: s.metric };
        // Linked zoom uses a multiplicative change, with each peer's own centre.
        if (c.mode === 'compare' && c.linked && s.camera2d.scale !== before.camera2d.scale && s.camera2dMode === 'manual') {
            const ratio = s.camera2d.scale / before.camera2d.scale;
            synchronizing = true;
            for (const other of c.documents)
                if (other !== d) {
                    const o = other.studio.getState(), v = o.viewport2d;
                    const cx = v.x + v.width / 2, cy = v.y + v.height / 2;
                    const scale = Math.max(.05, Math.min(40, o.camera2d.scale * ratio)), r = scale / o.camera2d.scale;
                    other.studio.setState({ camera2dMode: 'manual', camera2d: { scale, tx: cx - (cx - o.camera2d.tx) * r, ty: cy - (cy - o.camera2d.ty) * r } });
                }
            synchronizing = false;
        }
    });
}
export function activateDocument(id: string) {
    const d = useComparison.getState().documents.find(d => d.id === id);
    if (!d || getActiveStudioStore() === d.studio && useComparison.getState().activeId === id)
        return;
    getActiveProjectStore().getState().setCalculationDetailsOpen(false);
    d.project.getState().setCalculationDetailsOpen(false);
    selectStudioStore(d.studio);
    selectProjectStore(d.project);
    useComparison.setState({ activeId: id });
    window.dispatchEvent(new Event('curvature-studio:panel-layout'));
    window.dispatchEvent(new CustomEvent('curvature-studio:restore-histogram', { detail: getHistogramPosition(d.studio) }));
}
export function enterComparison() {
    let c = useComparison.getState();
    const first = !c.documents.length;
    if (first) {
        clearDiscarded();
        const a = documentRecord(activeDocument(), 'A');
        const b = documentRecord({ studio: createStudioStore(), project: createProjectStore() }, 'B');
        const copy = captureProject(a);
        copy.metadata = { ...newMetadata(`${copy.metadata.title} — variant`.slice(0, 120)), notes: copy.metadata.notes };
        applyProject(parseProjectJson(copy), false, b);
        const original = a.studio.getState();
        if (original.results && !original.computing)
            b.studio.setState({ results: original.results, computing: false });
        b.native = { shared: b.studio.getState().style.shared, custom: b.studio.getState().customGradients, labels: b.studio.getState().labelsVisible, metric: b.studio.getState().metric };
        comparisonSession.present = true;
        useComparison.setState({ documents: [a, b], activeId: b.id, colors: original.style.shared, custom: original.customGradients, metric: original.metric, view: original.view, projection: original.projection });
        watchDocument(a);
        watchDocument(b);
        c = useComparison.getState();
    }
    useComparison.setState({ mode: 'compare' });
    applyShared();
    activateDocument(c.activeId);
    if (first)
        requestAnimationFrame(() => fitBoth());
}
export function showSingle(id: string) {
    const c = useComparison.getState();
    if (!c.documents.some(d => d.id === id))
        return;
    synchronizing = true;
    for (const d of c.documents) {
        const s = d.studio.getState();
        d.studio.setState({ style: { ...s.style, shared: d.native.shared }, customGradients: d.native.custom, labelsVisible: d.native.labels, metric: d.native.metric });
    }
    synchronizing = false;
    useComparison.setState({ mode: 'single' });
    activateDocument(id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-document-id="${id}"] [data-graph-canvas]`)?.focus());
}
export function fitDocument(d: ComparisonDocument) {
    const s = d.studio.getState();
    const viewport2d = readGraphViewport(undefined, undefined, d.studio);
    if (!usableGraphViewport(viewport2d)) {
        getActiveStudioStore().getState().pushToast(`Not enough space in structure ${d.side}. Hide or move a panel, then try Fit again.`);
        return;
    }
    d.studio.setState({ viewport2d });
    if (s.view === '3d') {
        requestPaneFit(d.studio);
        window.dispatchEvent(new CustomEvent('curvature-studio:fit-3d', { detail: { store: d.studio } }));
    }
    else
        s.fit2d();
}
export function fitBoth() { for (const d of useComparison.getState().documents)
    fitDocument(d); }
export function replaceComparisonDocument(d: ComparisonDocument, project: ProjectJson) {
    const parsed = parseProjectJson(project); // validate before touching either document
    comparisonSession.applying = true;
    try {
        applyProject(parsed, true, d);
        const s = d.studio.getState();
        d.native = { shared: s.style.shared, custom: s.customGradients, labels: s.labelsVisible, metric: s.metric };
    }
    finally {
        comparisonSession.applying = false;
    }
    if (useComparison.getState().mode === 'compare')
        applyShared();
    window.dispatchEvent(new Event(WORKSPACE_CHANGED));
}
export function restoreComparisonState(state: Pick<ComparisonState, 'documents' | 'mode' | 'activeId' | 'ratio' | 'linked' | 'distribution' | 'metric' | 'view' | 'projection' | 'colors' | 'custom' | 'extensions'>) {
    for (const d of useComparison.getState().documents)
        d.stop?.();
    comparisonSession.present = true;
    useComparison.setState(state);
    state.documents.forEach(watchDocument);
    if (state.mode === 'compare')
        applyShared();
    activateDocument(state.activeId);
}
comparisonSession.onApplied = store => {
    if (comparisonSession.applying)
        return;
    const d = useComparison.getState().documents.find(d => d.studio === store);
    if (!d)
        return;
    const s = store.getState();
    d.native = { shared: s.style.shared, custom: s.customGradients, labels: s.labelsVisible, metric: s.metric };
    if (useComparison.getState().mode === 'compare')
        applyShared();
};
comparisonSession.onCapture = (store, value) => {
    if (useComparison.getState().mode !== 'compare')
        return;
    const d = useComparison.getState().documents.find(d => d.studio === store);
    if (!d)
        return;
    value.session.style.shared = structuredClone(d.native.shared);
    value.session.customGradients = structuredClone(d.native.custom);
    value.session.labelsVisible = d.native.labels;
    value.session.metric = d.native.metric;
};
