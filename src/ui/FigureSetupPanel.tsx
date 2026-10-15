import { styleForView } from '../state/style';
import { useMemo, useState } from 'react';
import { actualFigureLabelSizePt, captureFigureFrame, figurePixels, figurePng, parseFigure, type FigureSettings } from '../export/figure';
import { renderDocumentSvg } from '../export/svg';
import { useProjectStore } from '../project/store';
import { projectFilename } from '../project/format';
import { currentResult } from '../results/model';
import { useStudioStore } from '../state/store';
import { downloadText } from '../state/persistence';
import { Dialog } from './Dialog';

export function FigureSetupPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const saved = useProjectStore(state => state.figure);
  const studio = useStudioStore();
  const [draft, setDraft] = useState(() => ({ ...saved, widthMm: String(saved.widthMm), heightMm: String(saved.heightMm), paddingMm: String(saved.paddingMm), dpi: String(saved.dpi), labelSizePt: String(saved.labelSizePt), decimals: String(saved.decimals) }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const updateDraft = (patch: Partial<typeof draft>) => {
    setDraft(current => ({ ...current, ...patch }));
    setMessage(''); setExportError('');
  };
  const numberOrInvalid = (value: string) => value.trim() ? Number(value) : NaN;
  const parsed = useMemo(() => {
    try {
      return { settings: parseFigure({ ...draft, widthMm: numberOrInvalid(draft.widthMm), heightMm: numberOrInvalid(draft.heightMm), paddingMm: numberOrInvalid(draft.paddingMm), dpi: numberOrInvalid(draft.dpi), labelSizePt: numberOrInvalid(draft.labelSizePt), decimals: numberOrInvalid(draft.decimals) }), error: '' };
    } catch (error) { return { settings: null, error: error instanceof Error ? error.message : 'Invalid figure setup' }; }
  }, [draft]);
  const preview = useMemo(() => {
    if (!parsed.settings) return { ...parsed, svg: '' };
    try {
      const svg = renderDocumentSvg(studio.doc, currentResult(studio.doc, studio.results), studio.metric, studio.colorblindSafe, styleForView(studio.style, '2d'), studio.customGradients, studio.labelsVisible, parsed.settings);
      return { settings: parsed.settings, svg, error: '' };
    } catch (error) { return { settings: null, svg: '', error: error instanceof Error ? error.message : 'Invalid figure setup' }; }
  }, [parsed, studio.doc, studio.results, studio.metric, studio.colorblindSafe, studio.style, studio.customGradients, studio.labelsVisible]);
  // Compare normalized settings, not edit events or the latest success notification.
  const dirty = !parsed.settings || JSON.stringify(parsed.settings) !== JSON.stringify(parseFigure(saved));
  const actualPt = actualFigureLabelSizePt(numberOrInvalid(draft.labelSizePt), studio.style.view2d.labelScale);
  const capture = () => captureFigureFrame(studio.camera2d, studio.viewport2d);
  const apply = () => {
    if (!preview.settings) return;
    useProjectStore.getState().setFigure(preview.settings);
    setMessage('Figure settings saved in this project.');
  };
  const download = async (format: 'svg' | 'png') => {
    if (!preview.settings) return;
    setBusy(true); setMessage(''); setExportError('');
    try {
      const filename = projectFilename(useProjectStore.getState().metadata.title, `.${format}`);
      if (format === 'svg') downloadText(filename, preview.svg, 'image/svg+xml');
      else {
        const url = await figurePng(preview.svg, preview.settings);
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      }
      apply(); setMessage(`Saved ${filename} and its figure settings.`);
    } catch (error) { setExportError(error instanceof Error ? error.message : 'Figure export failed'); }
    finally { setBusy(false); }
  };
  const numeric = (key: 'widthMm' | 'heightMm' | 'paddingMm' | 'dpi' | 'labelSizePt' | 'decimals', label: string, min: number, max: number, step = 1) =>
    <label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={draft[key]} onChange={e => updateDraft({ [key]: e.target.value })} /></label>;
  return <Dialog className="figure-dialog" title="Figure setup (2D)" onClose={onClose}>
    <p>Set up a clean paper figure. Graph coordinates and curvature are unchanged. Save settings or download to keep your changes.</p>
    <div className="figure-fields">
      {numeric('widthMm', 'Width (mm)', 20, 500, 0.1)}
      {numeric('heightMm', 'Height (mm)', 20, 500, 0.1)}
      {numeric('paddingMm', 'Minimum margin (mm)', 0, 200, 0.1)}
      {numeric('dpi', 'PNG DPI', 72, 600)}
      <label>Background<select aria-label="Background" value={draft.background} onChange={e => updateDraft({ background: e.target.value as FigureSettings['background'] })}><option value="white">White</option><option value="transparent">Transparent</option></select></label>
      <label>Output range<select aria-label="Output range" value={draft.range} onChange={e => updateDraft({ range: e.target.value as FigureSettings['range'], ...(e.target.value === 'current' ? { frame: capture() } : {}) })}><option value="fit">Fit entire graph</option><option value="current">Current 2D range</option></select></label>
      {draft.range === 'current' ? <button className="button" onClick={() => updateDraft({ frame: capture() })}>Recapture current range</button> : null}
    </div>
    <details className="figure-labels" open><summary>Figure labels</summary>
      <div className="figure-fields">
        <label>Label format<select aria-label="Label format" value={draft.labels} onChange={e => updateDraft({ labels: e.target.value as FigureSettings['labels'] })}><option value="decimal">Decimal</option><option value="fraction">Exact fraction</option><option value="hidden">Hidden</option></select></label>
        {numeric('decimals', 'Figure decimal places', 0, 10)}
        {numeric('labelSizePt', 'Base label size (pt)', 3, 36, 0.125)}
        <label>Font<select aria-label="Font" value={draft.font} onChange={e => updateDraft({ font: e.target.value as FigureSettings['font'] })}><option value="sans-serif">Sans serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select></label>
      </div>
      <p className="figure-actual-size">Actual label size: <strong>{Number.isFinite(actualPt) ? `${Number(actualPt.toFixed(3))} pt` : '—'}</strong>{draft.labels === 'hidden' || !studio.labelsVisible ? ' (labels hidden)' : ''}</p>
      <p className="style-help">The 2D Display settings label scale ({Math.round(studio.style.view2d.labelScale * 100)}%) also applies. Effective curvature uses decimals; exact fractions are available for Ollivier only. Edge labels are currently {studio.labelsVisible ? 'on' : 'off'}.</p>
    </details>
    {preview.error ? <p role="alert" className="field-error">{preview.error}</p> : <>
      <p className="figure-dimensions">SVG: {draft.widthMm} × {draft.heightMm} mm · PNG: {figurePixels(preview.settings!).width} × {figurePixels(preview.settings!).height} pixels. Set this physical size when placing the PNG in your paper.</p>
      <div className="figure-preview"><img alt="Figure export preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`} /></div>
    </>}
    <p className="style-help">Fit reserves extra space for vertex outlines and labels. Current range keeps its aspect ratio and crops outside the captured range. Preview fonts depend on your system.</p>
    <p role="status" data-testid="figure-save-status">{busy ? 'Rendering PNG…' : dirty ? 'Unsaved figure changes' : message || 'Figure settings match this project.'}</p>
    {exportError ? <p role="alert" className="field-error">{exportError}</p> : null}
    <div className="figure-actions">
      <button className="button" disabled={!preview.settings || busy} onClick={apply}>Save figure settings</button>
      <button className="button" disabled={!preview.settings || busy} onClick={() => void download('svg')}>Download figure SVG</button>
      <button className="button" disabled={!preview.settings || busy} onClick={() => void download('png')}>Download figure PNG</button>
    </div>
  </Dialog>;
}
