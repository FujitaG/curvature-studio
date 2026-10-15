import { EndComparisonDialog } from './comparison/EndComparisonDialog';
import { ComparisonView, ComputationRunner } from './comparison/ComparisonView';
import { useComparison } from './comparison/store';
import { lazy, Suspense, useEffect, useState } from 'react';
import { quickTemplates } from './data/quickTemplates';
import { ComputingChip } from './ui/ComputingChip';
import { Histogram } from './ui/Histogram';
import { Inspector } from './ui/Inspector';
import { IsolatedVertexChip } from './ui/IsolatedVertexChip';
import { ShortcutSheet } from './ui/ShortcutSheet';
import { Toasts } from './ui/Toasts';
import { ToolRail } from './ui/ToolRail';
import { InteractionGuide } from './ui/InteractionGuide';
import { TopBar } from './ui/TopBar';
import { Canvas2D } from './view2d/Canvas2D';
import { ProjectBar } from './ui/ProjectBar';
import { ResultsPanel } from './ui/ResultsPanel';
import { useComputation } from './hooks/useComputation';
import { undoWorkspace } from './project/workspace';
import { startAutosave } from './project/autosave';
import { useProjectStore } from './project/store';
import { edgeArray, vertexArray } from './state/history';
import { cancelActiveDrag } from './state/dragController';
import { useStudioStore } from './state/store';
import { strings } from './strings';
import { stampTemplate } from './data/templateActions';
import { t } from './i18n';
import { shortcut } from './shortcuts';
import { useGraphViewport } from './hooks/useGraphViewport';
import { fitGraphView } from './ui/navigation';
import './styles.css';

const CalculationDetailsPanel = lazy(() => import('./ui/CalculationDetailsPanel').then(m => ({ default: m.CalculationDetailsPanel })));
const TemplateDrawer = lazy(() => import('./ui/TemplateDrawer').then(module => ({ default: module.TemplateDrawer })));
const View3D = lazy(() => import('./view3d/View3D').then((module) => ({ default: module.View3D })));

function EmptyState(): JSX.Element | null {
  const doc = useStudioStore((state) => state.doc);
  const area = useStudioStore((state) => state.viewport2d);
  if (doc.vertices.size > 0) return null;
  const stamp = (id: string) => { const template = quickTemplates.find((entry) => entry.id === id); if (template) stampTemplate(template); };
  return (
    <div className={`empty-state ${area.width < 360 || area.height < 240 ? 'compact-empty' : ''}`} style={{ left: area.x + area.width / 2, top: area.y + area.height / 2, width: Math.min(580, area.width) }}>
      <h1>{t("Explore curvature.")}</h1>
      <p>{t("Start with a graph. Edit its bonds. Compare the results.")}</p>
      <div className="empty-instruction">{t("Draw with")}{' '}<span className="keycap">B</span>{t(", or open Templates")}{' '}<span className="keycap">{shortcut('k')}</span>
      </div>
      <div className="quick-chips">
        <button className="button" onClick={() => stamp('k4')}>
          K₄
        </button>
        <button className="button" onClick={() => stamp('cube')}>{t("Cube")}{' '}</button>
        <button className="button extended-template" onClick={() => stamp('rhombic-dodecahedron')}>{t("Rhombic dodecahedron")}{' '}</button>
      </div>
    </div>
  );
}

function useKeyboard(): void {
  const setTool = useStudioStore((state) => state.setTool);
  const toggleView = useStudioStore((state) => state.toggleView);
  const toggleMetric = useStudioStore((state) => state.toggleMetric);
  const toggleLabels = useStudioStore((state) => state.toggleLabels);
  const setTemplateDrawerOpen = useStudioStore((state) => state.setTemplateDrawerOpen);
  const setShortcutSheetOpen = useStudioStore((state) => state.setShortcutSheetOpen);
  const deleteSelection = useStudioStore((state) => state.deleteSelection);
  const undo = undoWorkspace;
  const redo = useStudioStore((state) => state.redo);
  const doc = useStudioStore((state) => state.doc);
  const setSelection = useStudioStore((state) => state.setSelection);
  const clearSelection = useStudioStore((state) => state.clearSelection);
  const templateDrawerOpen = useStudioStore((state) => state.templateDrawerOpen);
  const view = useStudioStore((state) => state.view);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
      if (inInput) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.ctrlKey && key === 'y') {
        event.preventDefault();
        redo();
      } else if ((event.metaKey || event.ctrlKey) && key === 'a') {
        event.preventDefault();
        setSelection([
          ...vertexArray(doc).map((vertex) => ({ kind: 'vertex' as const, id: vertex.id })),
          ...edgeArray(doc).map((edge) => ({ kind: 'edge' as const, id: edge.id }))
        ]);
      } else if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        setTemplateDrawerOpen(true);
      } else if (event.metaKey || event.ctrlKey || event.altKey) return;
      else if (key === 'v') setTool('select');
      else if (key === 'b') setTool('bond');
      else if (key === 's') setTool('brace');
      else if (key === 'e') setTool('erase');
      else if (key === 't') toggleView();
      else if (key === 'm') toggleMetric();
      else if (key === 'f') {
        fitGraphView();
      }
      else if (key === 'l') toggleLabels();
      else if (key === '?') setShortcutSheetOpen(true);
      else if (key === 'escape') {
        const canceledDrag = cancelActiveDrag();
        if (canceledDrag) return;
        if (templateDrawerOpen) setTemplateDrawerOpen(false);
        else clearSelection();
      }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); deleteSelection(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection, deleteSelection, doc, redo, setSelection, setShortcutSheetOpen, setTemplateDrawerOpen, setTool, templateDrawerOpen, toggleLabels, toggleMetric, toggleView, undo, view]);
}

export function App(): JSX.Element {
  const comparisonDocuments = useComparison(s => s.documents);
  const templatesOpen = useStudioStore(state => state.templateDrawerOpen);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  useEffect(() => { if (templatesOpen) setTemplatesLoaded(true); }, [templatesOpen]);
  useEffect(() => { document.documentElement.lang = 'en'; }, []);
  const view = useStudioStore((state) => state.view);
  const [visibleViews, setVisibleViews] = useState([view]);
  const calculationDetailsOpen = useProjectStore(state => state.calculationDetailsOpen);
  const resultsOpen = useProjectStore((state) => state.resultsOpen);

  const panels = useStudioStore(state => state.panels);
  useGraphViewport();

  useEffect(() => {
    setVisibleViews((current) => (current.includes(view) ? current : [view, ...current]));
    const timer = window.setTimeout(() => setVisibleViews([view]), 120);
    return () => window.clearTimeout(timer);
  }, [view]);

  useComputation(undefined, comparisonDocuments.length > 0);
  useEffect(startAutosave, []);
  useKeyboard();
  return (
    <main className={`app ${resultsOpen ? 'results-open' : ''}`} aria-label={t("Curvature Studio workspace")}>
      {comparisonDocuments.length ? <ComparisonView /> : visibleViews.map((paneView) => (
        <div key={paneView} className={`canvas-layer view-pane ${paneView === view ? 'active' : 'exiting'}`}>
          {paneView === '2d' ? <Canvas2D /> : <Suspense fallback={<div className="view-loading" role="status">{t("Loading 3D view…")}</div>}><View3D /></Suspense>}
        </div>
      ))}
      {comparisonDocuments.map(document => <ComputationRunner key={document.id} document={document} />)}
      {!comparisonDocuments.length ? <EmptyState /> : null}
      <TopBar />
      <ProjectBar />
      <ComputingChip />
      <IsolatedVertexChip />
      <ToolRail />
      {panels.hints ? <InteractionGuide /> : null}
      {templatesLoaded || templatesOpen ? <Suspense fallback={<div className="view-loading" role="status">{t("Loading…")}</div>}><TemplateDrawer /></Suspense> : null}
      {!resultsOpen ? <Inspector /> : null}
      <ResultsPanel />
      {calculationDetailsOpen ? <Suspense fallback={null}><CalculationDetailsPanel /></Suspense> : null}
      {panels.histogram ? <Histogram /> : null}
      <ShortcutSheet />
      <Toasts />
      <EndComparisonDialog />
    </main>
  );
}
