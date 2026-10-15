import { requestEndComparison } from '../comparison/endComparison';
import { checkImportTarget } from '../import/files';
import { FileErrorNotice, fileFailure, type FileFailure } from './FileErrorNotice';
import { exportScene } from '../view3d/sceneApis';
import { useComparison } from '../comparison/store';
import { CompareButton } from '../comparison/ComparisonView';
import { PanelsButton } from './PanelsButton';
import { figurePng } from '../export/figure';
import { t } from '../i18n';
import { useProjectStore } from '../project/store';
import { downloadProject } from './ProjectBar';
import { shortcut } from '../shortcuts';
import { lazy, Suspense, useRef, useState } from 'react';
import { strings } from '../strings';
import { tokens } from '../design/tokens';
import { completeResult, currentResult } from '../results/model';
import { renderValuesCsv } from '../export/csv';
import { renderHistogramSvg } from '../export/histogram';
import { renderDocumentSvg } from '../export/svg';
import { docToJson, downloadText, parseDocJson, readJsonFile } from '../state/persistence';
import { mergeGradients, parseSessionJson, parseStyleJson, styleToJson } from '../state/interchange';
import { getActiveStudioStore, useStudioStore } from '../state/store';
import { styleForView } from '../state/style';
import { applyProject, captureProject, createNewProject } from '../project/workspace';
import { parseProjectJson } from '../project/format';
import { Icon } from './icons';
import { Tooltip } from './Tooltip';
import { usePopoverDismiss } from './usePopoverDismiss';
import { ViewMenu } from './ViewMenu';
import { fitGraphView } from './navigation';

const FigureSetupPanel = lazy(() => import('./FigureSetupPanel').then(module => ({ default: module.FigureSetupPanel })));
const DisplaySettingsPanel = lazy(() => import('./DisplaySettingsPanel').then(module => ({ default: module.DisplaySettingsPanel })));

function EffectiveMetricName(): JSX.Element {
  const [prefix] = t(strings.effectiveLong).split('κ_eff');
  return (
    <>
      {prefix}κ<sub>eff</sub>
    </>
  );
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function svgDimensions(root: SVGSVGElement): { width: number; height: number } {
  const width = Number(root.getAttribute('width'));
  const height = Number(root.getAttribute('height'));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  const viewBox = root.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? [];
  return {
    width: Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : 240,
    height: Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 160
  };
}

async function svgToPngDataUrl(svgText: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement as unknown as SVGSVGElement;
  const { width, height } = svgDimensions(root);
  root.querySelector('rect')?.setAttribute('fill', tokens.white);
  root.querySelectorAll('text').forEach((text) => text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'));
  const rasterSvg = new XMLSerializer().serializeToString(root);
  const blob = new Blob([rasterSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('PNG export failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(2, 8192 / Math.max(width, height), Math.sqrt(16_777_216 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export failed');
    context.fillStyle = tokens.white;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function TopBar(): JSX.Element {
  const paired = useComparison(s => s.documents.length > 0);
  const side = useComparison(s => s.documents.find(d => d.id === s.activeId)?.side);
  const title = useProjectStore(s => s.metadata.title);
  const exportTarget = `${side ? `${side} — ` : ''}${title}`;
  const [exportError, setExportError] = useState<{ target: string; message: string } | null>(null);
  const [importError, setImportError] = useState<FileFailure | null>(null);
  const [figureOpen, setFigureOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const view = useStudioStore((state) => state.view);
  const projection = useStudioStore((state) => state.projection);
  const metric = useStudioStore((state) => state.metric);
  const setView = useStudioStore((state) => state.setView);
  const setProjection = useStudioStore((state) => state.setProjection);
  const setMetric = useStudioStore((state) => state.setMetric);
  const fit2d = useStudioStore((state) => state.fit2d);
  const doc = useStudioStore((state) => state.doc);
  const replaceDoc = useStudioStore((state) => state.replaceDoc);
  const newDocument = useStudioStore((state) => state.newDocument);
  const templateDrawerOpen = useStudioStore((state) => state.templateDrawerOpen);
  const setTemplateDrawerOpen = useStudioStore((state) => state.setTemplateDrawerOpen);
  const overflowOpen = useStudioStore((state) => state.overflowOpen);
  const setOverflowOpen = useStudioStore((state) => state.setOverflowOpen);
  const relax3dAllNext = useStudioStore((state) => state.relax3dAllNext);
  const relax3dRunning = useStudioStore((state) => state.relax3dRunning);
  const relax3dLayout = useStudioStore((state) => state.relax3dLayout);
  const setShortcutSheetOpen = useStudioStore((state) => state.setShortcutSheetOpen);
  const colorblindSafe = useStudioStore((state) => state.colorblindSafe);
  const style = useStudioStore((state) => state.style);
  const customGradients = useStudioStore((state) => state.customGradients);
  const results = useStudioStore((state) => state.results);
  const pushToast = useStudioStore((state) => state.pushToast);
  const labelsVisible = useStudioStore((state) => state.labelsVisible);
  const setStyle = useStudioStore((state) => state.setStyle);
  const setCustomGradients = useStudioStore((state) => state.setCustomGradients);
  const fileRef = useRef<HTMLInputElement>(null);
  const styleFileRef = useRef<HTMLInputElement>(null);
  const sessionFileRef = useRef<HTMLInputElement>(null);
  const metricTriggerRef = useRef<HTMLButtonElement>(null);
  const metricMenuRef = useRef<HTMLDivElement>(null);
  const styleTriggerRef = useRef<HTMLButtonElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const documentEmpty = doc.vertices.size === 0 && doc.edges.size === 0;
  const resultsCurrent = Boolean(currentResult(doc, results));
  const histogramValues = (results?.values ?? []).map((value) => (metric === 'keff' ? value.kEff : value.ollivier)).filter(Number.isFinite);
  const hasHistogram = resultsCurrent && histogramValues.length > 0;
  const hasValuesCsv = doc.edges.size > 0 && completeResult(doc, results);

  usePopoverDismiss(metricOpen, () => setMetricOpen(false), [metricTriggerRef, metricMenuRef]);
  usePopoverDismiss(styleOpen, () => setStyleOpen(false), [styleTriggerRef, styleMenuRef]);
  usePopoverDismiss(exportOpen, () => setExportOpen(false), [exportTriggerRef, exportMenuRef]);
  usePopoverDismiss(overflowOpen, () => setOverflowOpen(false), [overflowTriggerRef, overflowMenuRef]);

  const exportJson = () => {
    downloadText('curvature-studio.json', JSON.stringify(docToJson(doc), null, 2), 'application/json');
    pushToast('Exported JSON');
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImportError(null);
      const input = await readJsonFile(file); checkImportTarget(input, 'doc');
      replaceDoc(parseDocJson(input), false, true);
      fit2d();
      pushToast('Imported JSON');
    } catch (error) {
      setImportError(fileFailure(file, error)); setOverflowOpen(false);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportStyle = () => {
    downloadText('curvature-style.json', JSON.stringify(styleToJson(style, customGradients), null, 2), 'application/json');
    setOverflowOpen(false);
  };

  const importStyle = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImportError(null);
      const input = await readJsonFile(file); checkImportTarget(input, 'style');
      const parsed = parseStyleJson(input);
      const merged = mergeGradients(customGradients, parsed.customGradients, parsed.style);
      setCustomGradients(merged.customGradients);
      setStyle(merged.style);
      pushToast('Style imported');
    } catch (error) { setImportError(fileFailure(file, error)); setOverflowOpen(false); }
    finally { if (styleFileRef.current) styleFileRef.current.value = ''; }
  };

  const saveSession = () => {
    const payload = captureProject().session;
    downloadText('curvature-session.json', JSON.stringify(payload, null, 2), 'application/json');
    setOverflowOpen(false);
    pushToast('Saved curvature-session.json');
  };

  const openSession = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImportError(null);
      const input = await readJsonFile(file); checkImportTarget(input, 'session');
      parseSessionJson(input);
      applyProject(parseProjectJson(input, file.name.replace(/\.json$/i, '')));
      setOverflowOpen(false);
      pushToast('Session opened');
    } catch (error) { setImportError(fileFailure(file, error)); setOverflowOpen(false); }
    finally { if (sessionFileRef.current) sessionFileRef.current.value = ''; }
  };

  const exportSvg = () => {
    setExportError(null);
    try {
      const svg =
        view === '2d'
          ? renderDocumentSvg(doc, results, metric, colorblindSafe, styleForView(style, '2d'), customGradients, labelsVisible, useProjectStore.getState().figure)
          : exportScene(getActiveStudioStore(), 'svg');
      downloadText('curvature-studio.svg', svg, 'image/svg+xml');
      setExportOpen(false);
      setOverflowOpen(false);
      pushToast('Saved curvature-studio.svg');
    } catch (error) {
      setExportError({ target: exportTarget, message: error instanceof Error ? error.message : 'SVG export failed. Try exporting again.' });
      setExportOpen(false);
    }
  };

  const exportPng = async () => {
    setExportError(null);
    try {
      if (view === '2d') {
        const dataUrl = await figurePng(renderDocumentSvg(doc, results, metric, colorblindSafe, styleForView(style, '2d'), customGradients, labelsVisible, useProjectStore.getState().figure), useProjectStore.getState().figure);
        downloadDataUrl('curvature-studio.png', dataUrl);
      } else {
        downloadDataUrl('curvature-studio.png', exportScene(getActiveStudioStore(), 'png'));
      }
      setExportOpen(false);
      setOverflowOpen(false);
      pushToast('Saved curvature-studio.png');
    } catch (error) {
      setExportError({ target: exportTarget, message: error instanceof Error ? error.message : 'PNG export failed. Try exporting again.' });
      setExportOpen(false);
    }
  };

  const exportHistogramSvg = () => {
    if (!hasHistogram) return;
    try {
      downloadText('curvature-histogram.svg', renderHistogramSvg(histogramValues, metric, colorblindSafe, style.shared, customGradients), 'image/svg+xml');
      setExportOpen(false);
      setOverflowOpen(false);
      pushToast('Saved curvature-histogram.svg');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Histogram SVG export failed');
    }
  };

  const exportHistogramPng = async () => {
    if (!hasHistogram) return;
    try {
      downloadDataUrl('curvature-histogram.png', await svgToPngDataUrl(renderHistogramSvg(histogramValues, metric, colorblindSafe, style.shared, customGradients)));
      setExportOpen(false);
      setOverflowOpen(false);
      pushToast('Saved curvature-histogram.png');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Histogram PNG export failed');
    }
  };

  const fitView = () => {
    if (documentEmpty) return;
    fitGraphView();
  };

  const exportValuesCsv = () => {
    if (!hasValuesCsv || !results) return;
    downloadText('curvature-values.csv', renderValuesCsv(doc, results), 'text/csv;charset=utf-8');
    setExportOpen(false);
    setOverflowOpen(false);
    pushToast('Saved curvature-values.csv');
  };

  const selectMetric = (next: typeof metric) => {
    setMetric(next);
    setMetricOpen(false);
  };

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="wordmark">{strings.appName}</div>
        <Tooltip content={`${t('Templates')} — ${shortcut('k')}`}>
          <button className="button" data-template-toggle onClick={() => setTemplateDrawerOpen(!templateDrawerOpen)}>
            <Icon name="templates" />
            {t(strings.templates)}
          </button>
        </Tooltip>
      </div>
      <div className="topbar-center">
        <div className="segment-group" role="group" aria-label={t("View")}>
          <button className={`segment ${view === '2d' ? 'active' : ''}`} aria-pressed={view === '2d'} onClick={() => setView('2d')}>
            2D
          </button>
          <button className={`segment ${view === '3d' ? 'active' : ''}`} aria-pressed={view === '3d'} onClick={() => setView('3d')}>
            3D
          </button>
        </div>
        {view === '3d' ? (
          <div className="segment-group projection-toggle" aria-label={t("Projection")}>
            <button className={`segment ${projection === 'perspective' ? 'active' : ''}`} aria-pressed={projection === 'perspective'} onClick={() => setProjection('perspective')}>{t("Persp")}{' '}</button>
            <button className={`segment ${projection === 'orthographic' ? 'active' : ''}`} aria-pressed={projection === 'orthographic'} onClick={() => setProjection('orthographic')}>{t("Ortho")}{' '}</button>
          </div>
        ) : null}
        <div className="segment-group metric-dropdown" aria-label={t("Metric")}>
          <button ref={metricTriggerRef} className="segment metric-trigger" aria-expanded={metricOpen} aria-label={t("Metric")} onClick={() => setMetricOpen(!metricOpen)}>
            <span>{metric === 'keff' ? <EffectiveMetricName /> : t(strings.ollivierLong)}</span>
            <Icon name="collapse" />
          </button>
          {metricOpen ? (
            <div ref={metricMenuRef} className="metric-menu panel">
              <button className="menu-item" onClick={() => selectMetric('ollivier')}>
                <span>{t("Ollivier–Ricci curvature")}</span>
                <span>{metric === 'ollivier' ? '✓' : ''}</span>
              </button>
              <button className="menu-item" aria-label={t(strings.effectiveLong)} onClick={() => selectMetric('keff')}>
                <span>
                  <EffectiveMetricName />
                </span>
                <span>{metric === 'keff' ? '✓' : ''}</span>
              </button>
            </div>
          ) : null}
        </div>
        <CompareButton /><PanelsButton />
      </div>
      <div className="topbar-right">
        <Tooltip content={t("Fit view — F")}>
          <button className="icon-button" aria-label={t("Fit view")} disabled={documentEmpty} onClick={fitView}>
            <Icon name="fit" />
          </button>
        </Tooltip>
        <Tooltip content={t("Clear canvas — undoable")}>
          <button className="icon-button" aria-label={t("Clear canvas")} disabled={documentEmpty} onClick={newDocument}>
            <Icon name="clear" />
          </button>
        </Tooltip>
        <Tooltip content={t("Display settings")}>
          <button
            ref={styleTriggerRef}
            className={`icon-button ${styleOpen ? 'active' : ''}`}
            aria-label={t("Display settings")}
            aria-expanded={styleOpen}
            onClick={() => {
              setStyleOpen(!styleOpen);
              setExportOpen(false);
              setOverflowOpen(false);
            }}
          >
            <Icon name="style" />
          </button>
        </Tooltip>
        <Tooltip content={t("Save & export")}>
          <button
            ref={exportTriggerRef}
            className={`icon-button ${exportOpen ? 'active' : ''}`}
            aria-label={t("Save & export")}
            aria-expanded={exportOpen}
            onClick={() => {
              setExportOpen(!exportOpen);
              setOverflowOpen(false);
              setStyleOpen(false);
            }}
          >
            <Icon name="download" />
          </button>
        </Tooltip>
        <Tooltip content={t("Menu")}>
          <button
            ref={overflowTriggerRef}
            className="icon-button"
            aria-label={t("Menu")}
            aria-expanded={overflowOpen}
            onClick={() => {
              setOverflowOpen(!overflowOpen);
              setExportOpen(false);
              setStyleOpen(false);
            }}
          >
            <Icon name="overflow" />
          </button>
        </Tooltip>
        {styleOpen ? (
          <div ref={styleMenuRef}>
            <Suspense fallback={<div className="panel" role="status" style={{ padding: 16 }}>{t('Loading…')}</div>}>
              <DisplaySettingsPanel onClose={() => setStyleOpen(false)} />
            </Suspense>
          </div>
        ) : null}
        {figureOpen ? <Suspense fallback={<div role="status">Loading figure setup…</div>}><FigureSetupPanel onClose={() => { setFigureOpen(false); exportTriggerRef.current?.focus(); }} /></Suspense> : null}
        {exportOpen ? (
          <div ref={exportMenuRef} className="export-popover panel">
            <h3 className="menu-heading">{t('Keep your work')}</h3>
            <button className="menu-item export-row" onClick={() => { downloadProject(); setExportOpen(false); }}><span>{paired ? 'Download comparison (A + B)' : t('Download project file')}</span><small>{paired ? 'Both structures, including the hidden side' : t('Graph, notes, and display settings')}</small></button>
            <h3 className="menu-heading">{t('Analyze results')}</h3>
            <button className="menu-item export-row" onClick={() => { useProjectStore.getState().setResultsOpen(true); setExportOpen(false); }}><span>{t('Results table & downloads')}</span><small>{t('CSV or JSON with calculation details')}</small></button>
            <h3 className="menu-heading">Export figure · {exportTarget}</h3>
            <button className="menu-item export-row" disabled={view !== '2d'} onClick={() => { setFigureOpen(true); setExportOpen(false); }}><span>Figure setup (2D)</span><small>Paper size, background, labels, and preview</small></button>
            <button className="menu-item export-row" onClick={exportSvg}>
              <span>{t("SVG (vector)")}</span>
              <small>{view === '2d' ? 'Uses saved figure setup' : t('current view, fitted')}</small>
            </button>
            <button className="menu-item export-row" onClick={() => void exportPng()}>
              <span>{view === '2d' ? 'PNG (figure size)' : t('PNG (2×)')}</span>
              <small>{view === '2d' ? 'Uses saved figure setup' : t('current view, fitted')}</small>
            </button>
            <Tooltip className="tooltip-row" content={t(strings.noValuedBonds)} disabled={hasHistogram}>
              <button className="menu-item export-row" disabled={!hasHistogram} onClick={exportHistogramSvg}>
                <span>{t("Histogram SVG")}</span>
                <small>{t(hasHistogram ? 'standalone figure' : 'no valued bonds')}</small>
              </button>
            </Tooltip>
            <Tooltip className="tooltip-row" content={t(strings.noValuedBonds)} disabled={hasHistogram}>
              <button className="menu-item export-row" disabled={!hasHistogram} onClick={() => void exportHistogramPng()}>
                <span>{t("Histogram PNG (2×)")}</span>
                <small>{t(hasHistogram ? 'standalone figure' : 'no valued bonds')}</small>
              </button>
            </Tooltip>
          </div>
        ) : null}
        {overflowOpen ? (
          <div ref={overflowMenuRef} className="overflow-menu panel">
            <ViewMenu />
            {paired ? <button className="menu-item" onClick={() => { setOverflowOpen(false); requestEndComparison(); }}>End comparison…</button> : null}
            <button className="menu-item" onClick={createNewProject}>{t('New project')}</button>
            <button className="menu-item" disabled={documentEmpty} onClick={() => { newDocument(); setOverflowOpen(false); }}>{t('Clear canvas')}</button>
            <details className="compatibility-menu"><summary>{t('Compatibility formats')}</summary>
              <p className="muted">{t('For older versions or exchanging only part of a project.')}</p>
              <button className="menu-item" onClick={() => fileRef.current?.click()}>{t('Import JSON')}</button>
              <button className="menu-item" onClick={exportJson}>{t('Export JSON')}</button>
              <button className="menu-item" onClick={exportStyle}>{t('Export style')}</button>
              <button className="menu-item" onClick={() => styleFileRef.current?.click()}>{t('Import style…')}</button>
              <button className="menu-item" onClick={saveSession}>{t('Save session')}</button>
              <button className="menu-item" onClick={() => sessionFileRef.current?.click()}>{t('Open session…')}</button>
              <button className="menu-item" disabled={!hasValuesCsv} onClick={exportValuesCsv}>{t('CSV (values)')}</button>
            </details>
            <Tooltip className="tooltip-row" content={t("3D view only")} disabled={view === '3d'}>
              <button className="menu-item" disabled={view !== '3d' || relax3dRunning || documentEmpty} onClick={relax3dLayout}>{t("Relax 3D layout")}{relax3dAllNext ? t(' (all)') : ''}
              </button>
            </Tooltip>
            <button className="menu-item" onClick={() => setShortcutSheetOpen(true)}>{t("Shortcut sheet")}{' '}</button>
          </div>
        ) : null}
        <input ref={fileRef} data-testid="document-file-input" type="file" accept="application/json,.json" hidden onChange={(event) => void importJson(event.target.files?.[0])} />
        <input ref={styleFileRef} data-testid="style-file-input" type="file" accept="application/json,.json" hidden onChange={(event) => void importStyle(event.target.files?.[0])} />
        <input ref={sessionFileRef} data-testid="session-file-input" type="file" accept="application/json,.json" hidden onChange={(event) => void openSession(event.target.files?.[0])} />
      </div>
      {importError ? <FileErrorNotice failure={importError} onDismiss={() => setImportError(null)} className="import-notice" /> : null}
      {exportError ? <div className="file-error panel import-notice" role="alert">
        <div className="file-error-copy"><strong>Could not export figure</strong>
          <span className="file-error-name">{exportError.target}</span><p>{exportError.message}</p>
          <p>No image was saved. Your project data is unchanged.</p></div>
        <button className="button" onClick={() => setExportError(null)}>Dismiss</button>
      </div> : null}
    </div>
  );
}
