import { useEffect, useState } from 'react';
import { metricColor } from '../design/tokens';
import type { MetricMode } from '../state/types';
import type { ThresholdGradient } from '../state/style';

export function ThresholdControls({ metric, setting, onChange, compact = false }: { compact?: boolean; metric: MetricMode; setting: ThresholdGradient; onChange: (next: ThresholdGradient) => void }): JSX.Element {
  const min = metric === 'ollivier' ? -1 : 0, span = 1 - min;
  const [threshold, setThreshold] = useState(String(setting.threshold));
  const [width, setWidth] = useState(String(setting.width));
  useEffect(() => { setThreshold(String(setting.threshold)); setWidth(String(setting.width)); }, [setting.threshold, setting.width]);
  const valid = threshold.trim() !== '' && width.trim() !== '' && Number.isFinite(Number(threshold)) && Number.isFinite(Number(width)) && Number(threshold) >= min && Number(threshold) <= 1 && Number(width) >= 0 && Number(width) <= span;
  const commit = () => { if (valid) onChange({ ...setting, threshold: Number(threshold), width: Number(width) }); };
  const colors = Array.from({ length: 101 }, (_, i) => `${metricColor(metric, min + span * i / 100, false, { metricGradients: { [metric]: setting } })} ${i}%`);
  const position = (setting.threshold - min) / span * 100;
  const background = setting.width === 0 ? `linear-gradient(90deg, ${setting.lowColor} ${position}%, ${setting.highColor} ${position}%)` : `linear-gradient(90deg, ${colors.join(',')})`;
  return <div className={`threshold-editor ${compact ? 'compact' : ''}`}>
    <div className="gradient-preview" aria-label="Threshold color preview" style={{ background }} />
    <div className="threshold-scale"><span>{min}</span><span>Threshold: {setting.threshold}</span><span>1</span></div>
    {!compact ? <label className="style-control-row"><span>Transition</span><select className="style-select" aria-label="Color transition" value={setting.width === 0 ? 'hard' : 'smooth'} onChange={e => onChange({ ...setting, width: e.target.value === 'hard' ? 0 : span * 0.2 })}><option value="smooth">Smooth gradient</option><option value="hard">Hard cutoff</option></select></label> : null}
    <label className="style-control-row"><span>{compact ? "Threshold" : "Threshold (curvature)"}</span><input className="style-text-input" aria-label="Color threshold" inputMode="decimal" value={threshold} aria-invalid={!valid} onChange={e => setThreshold(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } }} /></label>
    <input className="threshold-slider" type="range" aria-label="Adjust color threshold" min={min} max="1" step={span / 200} value={setting.threshold} onChange={e => onChange({ ...setting, threshold: Number(e.target.value) })} />
    <label className="style-control-row"><span>Transition width</span><input className="style-text-input" aria-label="Transition width" inputMode="decimal" value={width} aria-invalid={!valid} onChange={e => setWidth(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } }} /></label>
    <input className="threshold-slider" type="range" aria-label="Adjust transition width" min="0" max={span} step={span / 200} value={setting.width} onChange={e => onChange({ ...setting, width: Number(e.target.value) })} />
    {!valid ? <p className="field-error" role="alert">Threshold must be {min} to 1; width must be 0 to {span}. The previous colors remain in use.</p> : null}

    <p className="muted">{compact ? "Width 0 = sharp cutoff. Colors only." : "Width is in curvature units, centered on the threshold. A smaller width makes the color change sharper; 0 uses the upper color at and above the threshold."}</p>
  </div>;
}
