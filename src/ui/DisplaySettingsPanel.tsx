import { getPanelLayout, setPanelLayout } from '../state/viewMemory';
import { ThresholdControls } from './ThresholdControls';
import { t } from '../i18n';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { tokens } from '../design/tokens';
import {
  DEFAULT_RIGID_COLOR,
  DEFAULT_BOND_CASING_COLOR,
  DEFAULT_VERTEX_COLOR,
  DEFAULT_VERTEX_OUTLINE_COLOR,
  defaultCustomStops,
  normalizeGradientStops,
  type PaintSetting,
  type GradientPresetId,
  type GradientStop,
  type MetricGradientSetting,
  type SavedGradient,
  type OrnamentalStyle
} from '../state/style';
import { useStudioStore } from '../state/store';
import type { MetricMode } from '../state/types';
import { Icon } from './icons';

const PRESETS: Array<{ id: GradientPresetId; label: string }> = [
  { id: 'studio', label: 'Studio (default)' },
  { id: 'colorblind', label: 'Color-blind safe' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'coolwarm', label: 'Cool-warm (diverging)' },
  { id: 'grayscale', label: 'Grayscale' }
];

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `gradient-${Date.now()}`;
}

function gradientValue(setting: MetricGradientSetting): string {
  if (setting.type === 'preset') return `preset:${setting.preset}`;
  if (setting.type === 'custom') return `custom:${setting.id}`;
  return setting.type === 'threshold' ? 'threshold' : 'draft';
}

function gradientCss(stops: GradientStop[]): string {
  return `linear-gradient(90deg, ${stops.map((stop) => `${stop.color} ${stop.position}%`).join(', ')})`;
}

function metricTitle(metric: MetricMode): string {
  return metric === 'keff' ? 'Effective curvature' : 'Ollivier-Ricci curvature';
}

interface ColorControlProps {
  allowNone?: boolean;
  defaultValue: string;
  enabled?: boolean;
  label: string;
  onEnabledChange?: (enabled: boolean) => void;
  onChange: (value: string) => void;
  onReset?: () => void;
  value: string;
}

function ColorControl({ allowNone = false, defaultValue, enabled = true, label, onEnabledChange, onChange, onReset, value }: ColorControlProps): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const commit = () => {
    const next = draft.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(next)) { setInvalid(true); return; }
    setDraft(next); setInvalid(false); onChange(next);
  };
  return (
    <div className="style-control-row color-row">
      <label htmlFor={id}>{t(label)}</label>
      <div className="color-control">
        <input type="color" aria-label={t('{label} picker', { label: t(label) })} disabled={!enabled} value={value} onChange={(event) => { setInvalid(false); setDraft(event.target.value.toUpperCase()); onChange(event.target.value.toUpperCase()); }} />
        <input id={id} aria-label={t('{label} hex', { label: t(label) })} className="hex-input" disabled={!enabled}
          maxLength={7} spellCheck={false} autoComplete="off" value={draft} aria-invalid={enabled && invalid} aria-describedby={enabled && invalid ? `${id}-error` : undefined}
          onBlur={commit} onChange={(event) => {
            const next = event.target.value.toUpperCase();
            setDraft(next); setInvalid(false);
            if (/^#[0-9A-F]{6}$/.test(next)) onChange(next);
          }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(value); setInvalid(false); }
          }} />
        {allowNone ? <label className="none-toggle"><input type="checkbox" checked={!enabled} onChange={(event) => onEnabledChange?.(!event.target.checked)} />{t('None')}</label> : null}
        <button type="button" className="mini-button icon-only" aria-label={t('Reset {label}', { label: t(label) })} onClick={() => { setDraft(defaultValue); setInvalid(false); if (onReset) onReset(); else onChange(defaultValue); }}>↺</button>
      </div>
      {enabled && invalid ? <p id={`${id}-error`} role="alert" className="field-error">{t('Enter a color as #RRGGBB (for example, #FF0000). The previous color is still in use.')}</p> : null}
    </div>
  );
}

function paintPatch(paint: PaintSetting, patch: Partial<PaintSetting>): PaintSetting {
  return { ...paint, ...patch };
}

function StopPosition({ value, disabled, label, onCommit }: { value: number; disabled: boolean; label: string; onCommit: (value: number) => void }): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = draft.trim() !== '' && Number.isFinite(Number(draft)) && Number(draft) >= 0 && Number(draft) <= 100;
  const commit = () => { if (valid) onCommit(Number(draft)); };
  return <input className="gradient-position-number" aria-label={label} type="number" min="0" max="100" step="1" disabled={disabled}
    value={draft} aria-invalid={!valid} title="Enter a position from 0 to 100 percent" onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } }} />;
}

interface StopsEditorProps {
  gradient: SavedGradient | { name: string; stops: GradientStop[] };
  metric: MetricMode;
  onChange: (gradient: { name: string; stops: GradientStop[] }) => void;
}

function StopsEditor({ gradient, metric, onChange }: StopsEditorProps): JSX.Element {
  // Editor identities are independent of the normalized, sorted persistence format.
  const [rows, setRows] = useState(() => gradient.stops.map(stop => ({ ...stop, id: makeId(), locked: metric === 'ollivier' && stop.position === 50 })));
  const [name, setName] = useState(gradient.name);
  const lastPublished = useRef(JSON.stringify(gradient));
  useEffect(() => {
    const incoming = JSON.stringify(gradient);
    if (incoming !== lastPublished.current) {
      setRows(gradient.stops.map(stop => ({ ...stop, id: makeId(), locked: metric === 'ollivier' && stop.position === 50 })));
      setName(gradient.name);
      lastPublished.current = incoming;
    }
  }, [gradient, metric]);
  const stops = rows;
  const minimumStops = metric === 'ollivier' ? 3 : 2;
  const publish = (nextRows: typeof rows, nextName = name) => {
    const next = { name: nextName.trim() || 'Custom gradient', stops: normalizeGradientStops(metric, nextRows) };
    lastPublished.current = JSON.stringify('id' in gradient ? { ...gradient, ...next } : next);
    onChange(next);
  };
  const updateStop = (index: number, patch: Partial<GradientStop>) => {
    // Only the fixed Ollivier midpoint may occupy 50; never merge an edited row into it.
    if (metric === 'ollivier' && !rows[index].locked && patch.position === 50) patch.position = rows[index].position < 50 ? 51 : 49;
    const next = rows.map((stop, i) => i === index ? { ...stop, ...patch } : stop).sort((a, b) => a.position - b.position);
    setRows(next); publish(next);
  };
  const addStop = () => {
    if (rows.length >= 6) return;
    const position = metric === 'ollivier' ? 25 : 50;
    const next = [...rows, { id: makeId(), color: tokens.ink500, position, locked: false }].sort((a, b) => a.position - b.position);
    setRows(next); publish(next);
  };
  const removeStop = (index: number) => {
    if (rows.length <= minimumStops || rows[index].locked) return;
    const next = rows.filter((_, i) => i !== index);
    setRows(next); publish(next);
  };
  return (
    <div className="gradient-editor">
      <label className="style-control-row">
        <span>{t("Name")}</span>
        <input
          className="style-text-input"
          value={name} maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => { const next = name.trim() || 'Custom gradient'; setName(next); publish(rows, next); }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } }}
        />
      </label>
      <div className="gradient-preview" style={{ background: gradientCss(stops) }} />
      <div className="gradient-stops">
        {stops.map((stop, index) => {
          const locked = stop.locked;
          return (
            <div className="gradient-stop-row" key={stop.id}>
              <input type="color" aria-label={t('Stop {n} color', { n: index + 1 })} value={stop.color} onChange={(event) => updateStop(index, { color: event.target.value.toUpperCase() })} />
              <input
                aria-label={t('Stop {n} position', { n: index + 1 })}
                type="range"
                min="0"
                max="100"
                step="1"
                disabled={locked}
                value={stop.position}
                onChange={(event) => updateStop(index, { position: Number(event.target.value) })}
              />
              <StopPosition value={stop.position} disabled={locked} label={`Stop ${index + 1} position percent`} onCommit={(position) => updateStop(index, { position })} />
              <button type="button" className="mini-button icon-only" disabled={locked || stops.length <= minimumStops} aria-label={t('Remove stop {n}', { n: index + 1 })} onClick={() => removeStop(index)}>
                -
              </button>
            </div>
          );
        })}
      </div>
      {metric === 'ollivier' ? <p className="style-help">The midpoint stays at 50%. Other stops skip that position when moved across it.</p> : null}
      <button type="button" className="button style-inline-button" disabled={stops.length >= 6} onClick={addStop}>{t("Add stop")}{' '}</button>
    </div>
  );
}


interface DisplaySettingsPanelProps {
  onClose: () => void;
}

export function DisplaySettingsPanel({ onClose }: DisplaySettingsPanelProps): JSX.Element {
  const view = useStudioStore((state) => state.view);
  const [pickedScope, setPickedScope] = useState<'2d' | '3d' | null>(null);
  const scope = pickedScope ?? view;
  const metric = useStudioStore((state) => state.metric);
  const labelsVisible = useStudioStore((state) => state.labelsVisible);
  const setLabelsVisible = useStudioStore((state) => state.setLabelsVisible);
  const studioStyle = useStudioStore((state) => state.style);
  const style = scope === '2d' ? studioStyle.view2d : studioStyle.view3d;
  const setStyle = useStudioStore((state) => state.setStyle);
  const resetStyle = useStudioStore((state) => state.resetStyle);
  const setMetricGradient = useStudioStore((state) => state.setMetricGradient);
  const customGradients = useStudioStore((state) => state.customGradients);
  const setCustomGradients = useStudioStore((state) => state.setCustomGradients);
  const pushToast = useStudioStore((state) => state.pushToast);
  const setting = studioStyle.shared.metricGradients[metric];
  const savedForMetric = useMemo(() => customGradients.filter((gradient) => gradient.metric === metric), [customGradients, metric]);
  const selectedCustom = setting.type === 'custom' ? savedForMetric.find((gradient) => gradient.id === setting.id) : undefined;
  const editableGradient = setting.type === 'draft' ? { name: setting.name, stops: setting.stops } : selectedCustom;

  const updateStyle = (patch: Partial<OrnamentalStyle>) => setStyle((current) => ({ ...current, [scope === '2d' ? 'view2d' : 'view3d']: { ...(scope === '2d' ? current.view2d : current.view3d), ...patch } }));
  const copyToOtherView = () => {
    const target = scope === '2d' ? 'view3d' : 'view2d';
    setStyle((current) => ({ ...current, [target]: { ...(scope === '2d' ? current.view2d : current.view3d) } }));
    pushToast(t('Copied {from} settings to {to}', { from: scope.toUpperCase(), to: scope === '2d' ? '3D' : '2D' }));
  };
  const updateEditableGradient = (next: { name: string; stops: GradientStop[] }) => {
    if (setting.type === 'custom' && selectedCustom) {
      setCustomGradients(customGradients.map((gradient) => (gradient.id === selectedCustom.id ? { ...gradient, name: next.name, stops: next.stops } : gradient)));
      return;
    }
    setMetricGradient(metric, { type: 'draft', name: next.name, stops: next.stops });
  };
  const saveDraft = () => {
    if (!editableGradient) return;
    const saved: SavedGradient = {
      id: setting.type === 'custom' && selectedCustom ? selectedCustom.id : makeId(),
      metric,
      name: editableGradient.name.trim() || `${t(metricTitle(metric))} custom`,
      stops: normalizeGradientStops(metric, editableGradient.stops)
    };
    const next = setting.type === 'custom' && selectedCustom
      ? customGradients.map((gradient) => (gradient.id === selectedCustom.id ? saved : gradient))
      : [...customGradients, saved];
    setCustomGradients(next);
    setMetricGradient(metric, { type: 'custom', id: saved.id });
    pushToast('Saved gradient');
  };
  const deleteSelectedCustom = () => {
    if (setting.type !== 'custom' || !selectedCustom) return;
    setCustomGradients(customGradients.filter((gradient) => gradient.id !== selectedCustom.id));
    setMetricGradient(metric, { type: 'preset', preset: 'studio' });
    pushToast('Deleted gradient');
  };

  return (
    <div className="display-settings-panel panel" role="dialog" aria-label={t("Display settings")}>
      <div className="style-panel-header">
        <h2>{t("Display settings")}</h2>
        <button type="button" className="icon-button" aria-label={t("Close display settings")} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="style-scope-row">
        <div className="segment-group" aria-label={t("Style scope")}>
          <button type="button" className={`segment ${scope === '2d' ? 'active' : ''}`} onClick={() => setPickedScope('2d')}>2D</button>
          <button type="button" className={`segment ${scope === '3d' ? 'active' : ''}`} onClick={() => setPickedScope('3d')}>3D</button>
        </div>
        <button type="button" className="button" onClick={copyToOtherView}>{t("Copy to")}{' '}{scope === '2d' ? '3D' : '2D'}</button>
      </div>

      <section className="style-section">
        <h3>{t("Labels")}</h3>
        <label className="style-control-row">
          <span>{t("Show values")}</span>
          <input type="checkbox" checked={labelsVisible} onChange={(event) => setLabelsVisible(event.target.checked)} />
        </label>
        <label className="style-control-row">
          <span>{t("Label size")}</span>
          <span className="slider-field">
            <input
              aria-label={t("Label size")}
              type="range"
              min="70"
              max="200"
              step="10"
              value={Math.round(style.labelScale * 100)}
              onChange={(event) => updateStyle({ labelScale: Number(event.target.value) / 100 })}
            />
            <output>{Math.round(style.labelScale * 100)}%</output>
          </span>
        </label>
      </section>

      <section className="style-section">
        <h3>Vertices & edges</h3>
        <ColorControl
          allowNone
          label={t("Vertex fill")}
          value={style.vertexFill.color}
          enabled={style.vertexFill.enabled}
          defaultValue={DEFAULT_VERTEX_COLOR}
          onReset={() => updateStyle({ vertexFill: { enabled: true, color: DEFAULT_VERTEX_COLOR } })}
          onEnabledChange={(enabled) => updateStyle({ vertexFill: paintPatch(style.vertexFill, { enabled }) })}
          onChange={(color) => updateStyle({ vertexFill: paintPatch(style.vertexFill, { enabled: true, color }) })}
        />
        <ColorControl
          allowNone
          label={t("Vertex outline")}
          value={style.vertexOutline.color}
          enabled={style.vertexOutline.enabled}
          defaultValue={DEFAULT_VERTEX_OUTLINE_COLOR}
          onReset={() => updateStyle({ vertexOutline: { enabled: true, color: DEFAULT_VERTEX_OUTLINE_COLOR } })}
          onEnabledChange={(enabled) => updateStyle({ vertexOutline: paintPatch(style.vertexOutline, { enabled }) })}
          onChange={(color) => updateStyle({ vertexOutline: paintPatch(style.vertexOutline, { enabled: true, color }) })}
        />
        <label className="style-control-row">
          <span>{t("Vertex size")}</span>
          <span className="slider-field">
            <input
              aria-label={t("Vertex size")}
              type="range"
              min="2"
              max="10"
              step="0.5"
              value={style.vertexSize}
              onChange={(event) => updateStyle({ vertexSize: Number(event.target.value) })}
            />
            <output>{style.vertexSize.toFixed(1)}{' '}px</output>
          </span>
        </label>
        <label className="style-control-row">
          <span>{t("Outline width")}</span>
          <span className="slider-field">
            <input
              aria-label={t("Vertex outline width")}
              type="range"
              min="0"
              max="4"
              step="0.5"
              value={style.vertexOutlineWidth}
              onChange={(event) => updateStyle({ vertexOutlineWidth: Number(event.target.value) })}
            />
            <output>{style.vertexOutlineWidth.toFixed(1)}{' '}px</output>
          </span>
        </label>
        <label className="style-control-row">
          <span>{t("Hide vertices")}</span>
          <input type="checkbox" checked={style.verticesHidden} onChange={(event) => updateStyle({ verticesHidden: event.target.checked })} />
        </label>
        <label className="style-control-row">
          <span>{t("Bond width")}</span>
          <span className="slider-field">
            <input
              aria-label={t("Bond width")}
              type="range"
              min="1"
              max="4"
              step="0.5"
              value={style.bondWidth}
              onChange={(event) => updateStyle({ bondWidth: Number(event.target.value) })}
            />
            <output>{style.bondWidth.toFixed(1)}{' '}px</output>
          </span>
        </label>
        <label className="style-control-row">
          <span>{t("Bond style")}</span>
          <select
            className="style-select"
            aria-label={t("Bond style")} title="Line appearance only; curvature is unchanged."
            value={style.bondStyle}
            onChange={(event) => updateStyle({ bondStyle: event.target.value === 'double' ? 'double' : event.target.value === 'dashed' ? 'dashed' : 'single' })}
          >
            <option value="single">{t("Single line")}</option>
            <option value="double">{t("Double line")}</option>
            <option value="dashed">{t("Dashed")}</option>
          </select>
        </label>
        <ColorControl
          allowNone
          label={t("Bond casing")}
          value={style.bondCasing.color}
          enabled={style.bondCasing.enabled}
          defaultValue={DEFAULT_BOND_CASING_COLOR}
          onReset={() => updateStyle({ bondCasing: { enabled: false, color: DEFAULT_BOND_CASING_COLOR } })}
          onEnabledChange={(enabled) => updateStyle({ bondCasing: paintPatch(style.bondCasing, { enabled }) })}
          onChange={(color) => updateStyle({ bondCasing: paintPatch(style.bondCasing, { enabled: true, color }) })}
        />
        <label className="style-control-row">
          <span>{t("Casing width")}</span>
          <span className="slider-field">
            <input
              aria-label={t("Bond casing width")}
              type="range"
              min="0.5"
              max="4"
              step="0.5"
              disabled={!style.bondCasing.enabled}
              value={style.bondCasingWidth}
              onChange={(event) => updateStyle({ bondCasingWidth: Number(event.target.value) })}
            />
            <output>{style.bondCasingWidth.toFixed(1)}{' '}px</output>
          </span>
        </label>
        <label className="style-control-row">
          <span>{t("Brace style")}</span>
          <select
            className="style-select"
            aria-label={t("Brace style")} title="Line appearance only; curvature is unchanged."
            value={style.braceStyle}
            onChange={(event) => updateStyle({ braceStyle: event.target.value === 'single' ? 'single' : event.target.value === 'dashed' ? 'dashed' : 'double' })}
          >
            <option value="double">{t("Double line")}</option>
            <option value="single">{t("Single line")}</option>
            <option value="dashed">{t("Dashed")}</option>
          </select>
        </label>
        <ColorControl label={t("Brace color")} value={style.braceColor} defaultValue={DEFAULT_RIGID_COLOR} onReset={() => updateStyle({ braceColor: DEFAULT_RIGID_COLOR })} onChange={(braceColor) => updateStyle({ braceColor })} />
      </section>

      <section className="style-section">
        <h3>{t("Metric gradient")}{' '}<small>{t("applies to both views")}</small></h3>
        <label className="style-control-row">
          <span>{t(metricTitle(metric))}</span>
          <select
            className="style-select"
            aria-label={t("Metric gradient preset")}
            value={gradientValue(setting)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'threshold') {
                setMetricGradient(metric, { type: 'threshold', threshold: metric === 'keff' ? 0.5 : 0, width: metric === 'keff' ? 0.2 : 0.4, lowColor: '#3B4CC0', highColor: '#B40426' });
              } else if (value === 'draft') {
                setMetricGradient(metric, { type: 'draft', name: '', stops: defaultCustomStops(metric) });
              } else if (value.startsWith('preset:')) {
                const preset = value.slice('preset:'.length) as GradientPresetId;
                setMetricGradient(metric, { type: 'preset', preset });
              } else if (value.startsWith('custom:')) {
                setMetricGradient(metric, { type: 'custom', id: value.slice('custom:'.length) });
              }
            }}
          >
            {PRESETS.map((preset) => (
              <option key={preset.id} value={`preset:${preset.id}`}>
                {t(preset.label)}
              </option>
            ))}
            {savedForMetric.map((gradient) => (
              <option key={gradient.id} value={`custom:${gradient.id}`}>
                {gradient.name}
              </option>
            ))}
            <option value="threshold">Threshold…</option>
            <option value="draft">{t("Custom...")}</option>
          </select>
        </label>
        <button className="button style-inline-button" onClick={() => { useStudioStore.setState(state => ({ panels: { ...state.panels, histogram: true }, histogramCollapsed: false })); setPanelLayout({ ...getPanelLayout(), thresholdExpanded: true }); onClose(); }}>Adjust threshold with histogram</button>
        {setting.type === 'threshold' ? <><ThresholdControls key={metric} metric={metric} setting={setting} onChange={next => setMetricGradient(metric, next)} /><ColorControl label="Low-side color" value={setting.lowColor} defaultValue="#3B4CC0" onChange={lowColor => setMetricGradient(metric, { ...setting, lowColor })} /><ColorControl label="High-side color" value={setting.highColor} defaultValue="#B40426" onChange={highColor => setMetricGradient(metric, { ...setting, highColor })} /></> : null}
        {editableGradient ? (
          <>
            <StopsEditor key={`${metric}:${setting.type === 'custom' ? setting.id : 'draft'}`} metric={metric} gradient={editableGradient} onChange={updateEditableGradient} />
            <div className="style-action-row">
              <button type="button" className="button" onClick={saveDraft}>{t("Save")}{' '}</button>
              {selectedCustom ? (
                <button type="button" className="button danger" onClick={deleteSelectedCustom}>{t("Delete")}{' '}</button>
              ) : null}
            </div>
          </>
        ) : null}
      </section>



      <div className="style-panel-footer">
        <button
          type="button"
          className="button"
          onClick={() => {
            resetStyle();
            pushToast('Display settings reset');
          }}
        >{t("Reset all")}{' '}</button>
      </div>
    </div>
  );
}
