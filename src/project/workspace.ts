import { clearDiscarded } from '../comparison/endState';
import { paneElement, paneSize } from '../comparison/panes';
import { comparisonSession } from '../comparison/flag';
import { parsePanelLayout } from '../state/panelLayout';
import { parseFigure } from '../export/figure';
import { computationKey } from '../math/graph';
import { nextIdCursor } from '../state/ids';
import { cancelActiveDrag } from '../state/dragController';
import { appendHistory, createDocPatch, cloneDoc, emptyDoc } from '../state/history';
import { fitCamera2d } from '../state/camera2d';
import { parsePanels } from '../state/panels';
import { sessionToJson } from '../state/interchange';
import { getActiveStudioStore, type StudioStore, useStudioStore } from '../state/store';
import { getPanelLayout, setPanelLayout, getHistogramPosition, getSavedCamera3d, setHistogramPosition, setSavedCamera3d, WORKSPACE_CHANGED } from '../state/viewMemory';
import { CALCULATION, newMetadata, parseProjectJson, type ParsedProject, type ProjectJson } from './format';
import { getActiveProjectStore, type ProjectStore, useProjectStore } from './store';

export let applyingProject = false;

export interface DocumentTarget { studio: StudioStore; project: ProjectStore }
export const activeDocument = (): DocumentTarget => ({ studio: getActiveStudioStore(), project: getActiveProjectStore() });
export function captureProject(target: DocumentTarget = activeDocument()): ProjectJson {
  const useStudioStore = target.studio, useProjectStore = target.project;
  const studio = useStudioStore.getState();
  const project = useProjectStore.getState();
  const camera3d = getSavedCamera3d(target.studio);
  const histogramPos = getHistogramPosition(target.studio);
  const pane = paneElement(target.studio);
  const value: ProjectJson = {
    format: 'curvature-studio/project', version: 1,
    metadata: { ...project.metadata, title: project.metadata.title.trim() || 'Untitled project' },
    calculation: { ...CALCULATION },
    session: sessionToJson({
      doc: studio.doc, view: studio.view, metric: studio.metric, labelsVisible: studio.labelsVisible,
      camera2d: studio.camera2d, projection: studio.projection, viewport: { width: pane?.clientWidth || paneSize(target.studio)?.width || window.innerWidth, height: pane?.clientHeight || paneSize(target.studio)?.height || window.innerHeight },
      ...(camera3d ? { camera3d: { ...camera3d, projection: studio.projection } } : {}),
      ...(histogramPos ? { histogramPos } : {}), histogramCollapsed: studio.histogramCollapsed, panels: studio.panels, panelLayout: getPanelLayout(target.studio),
      style: studio.style, customGradients: studio.customGradients
    }),
    figure: parseFigure(project.figure), resultsDisplay: { precision: project.precision }, extensions: structuredClone(project.extensions)
  };
  comparisonSession.onCapture?.(target.studio, value);
  return value;
}

export function applyProject(project: ParsedProject, rememberPrevious = true, target: DocumentTarget = activeDocument()): void {
  const useStudioStore = target.studio, useProjectStore = target.project;
  const previousProject = rememberPrevious ? captureProject(target) : null;
  const session = project.session;
  if (rememberPrevious) clearDiscarded();
  applyingProject = true;
  try {
    if (target.studio === getActiveStudioStore()) cancelActiveDrag();
    const before = useStudioStore.getState();
    const doc = cloneDoc(session.doc);
    useStudioStore.setState({
      doc, nextVertexIdCounter: nextIdCursor(doc.vertices.keys()),
      nextEdgeIdCounter: nextIdCursor(doc.edges.keys()),
      historyPast: rememberPrevious ? appendHistory(before.historyPast, createDocPatch(before.doc, doc)) : [], historyFuture: [],
      selection: [], tool: 'select', view: session.view, metric: session.metric,
      camera2dMode: 'manual', viewport2d: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      labelsVisible: session.labelsVisible, camera2d: { ...session.camera2d,
        tx: session.camera2d.tx + (session.viewport ? (window.innerWidth - session.viewport.width) / 2 : 0),
        ty: session.camera2d.ty + (session.viewport ? (window.innerHeight - session.viewport.height) / 2 : 0) },
      projection: session.projection ?? session.camera3d?.projection ?? 'perspective', histogramCollapsed: session.histogramCollapsed,
      panels: parsePanels(session.panels), inspectorExpanded: false,
      style: session.style, customGradients: session.customGradients, colorblindSafe: false,
      results: null, latestTopologyKey: computationKey(doc.vertices.values(), doc.edges.values()),
      computing: true, computationError: null, computationPaused: false, computationRequest: before.computationRequest + 1,
      histogramHoverBin: null, templateDrawerOpen: false, overflowOpen: false, relax3dAllNext: false,
      relax3dError: null, relax3dProgress: 0
    });
    useProjectStore.setState({ figure: parseFigure(project.figure), metadata: { ...project.metadata }, extensions: structuredClone(project.extensions), precision: project.resultsDisplay.precision, previousProject, previousAction: rememberPrevious ? 'open' : null });
    setPanelLayout(parsePanelLayout(session.panelLayout), target.studio);
    setSavedCamera3d(session.camera3d ?? null, target.studio);
    setHistogramPosition(session.histogramPos ?? null, target.studio);
    if (target.studio === getActiveStudioStore()) window.dispatchEvent(new CustomEvent('curvature-studio:restore-histogram', { detail: session.histogramPos ?? null }));
    window.dispatchEvent(new CustomEvent('curvature-studio:restore-camera', { detail: { store: target.studio } }));
  } finally { applyingProject = false; }
  comparisonSession.onApplied?.(target.studio);
  window.dispatchEvent(new Event(WORKSPACE_CHANGED));
  window.dispatchEvent(new CustomEvent('curvature-studio:workspace-replaced', { detail: target.studio }));
  for (const warning of session.cameraWarnings ?? []) useStudioStore.getState().pushToast(warning);
}

/** Start a new identity. Keep user display preferences; retain a complete undo snapshot. */
export function createNewProject(): void {
  const studio = useStudioStore.getState();
  applyProject({ format: 'curvature-studio/project', version: 1, metadata: newMetadata(), calculation: CALCULATION,
    session: { format: 'curvature-studio/session', version: 2, doc: emptyDoc(), view: studio.view, metric: studio.metric, labelsVisible: studio.labelsVisible,
      camera2d: fitCamera2d(emptyDoc(), studio.viewport2d), projection: studio.projection,
      histogramCollapsed: studio.histogramCollapsed, panels: studio.panels, panelLayout: getPanelLayout(), style: studio.style, customGradients: studio.customGradients },
    resultsDisplay: { precision: 6 }, extensions: {} });
  // Document Undo belongs to the new project. Undo new project restores metadata as well.
  useStudioStore.setState({ historyPast: [], historyFuture: [], camera2dMode: 'fit', tool: 'bond' });
  useProjectStore.setState({ previousAction: 'new', resultsOpen: false });
  useStudioStore.getState().pushToast('New project created — Undo new project restores your previous workspace');
}

export function restorePreviousProject(): void {
  const previous = useProjectStore.getState().previousProject;
  if (previous) {
    applyProject(parseProjectJson(previous), false);
    useStudioStore.getState().pushToast('Previous project restored, including its display settings');
  }
}

export function undoWorkspace(): void {
  if (useProjectStore.getState().previousAction === 'new' && useStudioStore.getState().historyPast.length === 0) restorePreviousProject();
  else useStudioStore.getState().undo();
}
