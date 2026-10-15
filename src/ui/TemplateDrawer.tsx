import { FileErrorNotice, fileFailure, type FileFailure } from './FileErrorNotice';
import { PolyhedronImportGuide } from './PolyhedronImportGuide';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { resolveTemplate, templates, type Template } from '../data/templates';
import { stampTemplate, templateParameter, type PlacementMode } from '../data/templateActions';
import { tokens } from '../design/tokens';
import { useStudioStore } from '../state/store';
import { loadImportedTemplates, parsePolyhedronFile, saveImportedTemplates, type ImportedTemplate } from '../import/polyhedron';
import { readTextFile } from '../state/persistence';
import { storePreference } from '../state/storage';
import { t } from '../i18n';

const RECENT_KEY = 'curvature-studio:recent-templates';
type RecentTemplate = { id: string; n?: number };
function loadRecent(): RecentTemplate[] {
  try {
    const input: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(input) ? input.filter((v): v is RecentTemplate => v && typeof v.id === 'string' && (v.n === undefined || Number.isSafeInteger(v.n))).slice(0, 5) : [];
  } catch { return []; }
}
function description(template: Template): string {
  if (template.id === 'bond-brace-example') return t('Compare a contact with a rigid tie.');
  if (template.parametric === 'cycle') return t('A ring for exploring local curvature.');
  if (template.parametric === 'prism') return t('Two rings connected by bonds.');
  if (template.parametric === 'antiprism') return t('Triangular sides connect two rings.');
  return t(template.group === 'Theory examples' ? 'A small graph for understanding the calculation.' : 'Compare curvature across a polyhedron’s edges.');
}

function Thumbnail({ template }: { template: Template }): JSX.Element {
  const points = template.layout2d;
  if (points.length === 0) return <svg className="template-thumb" />;
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = 48 / Math.max(width, height);
  const tx = 32 - ((minX + maxX) / 2) * scale;
  const ty = 32 - ((minY + maxY) / 2) * scale;
  return (
    <svg className="template-thumb" viewBox="0 0 64 64" aria-hidden="true">
      {template.edges.map(([a, b], index) => (
        <line
          key={index}
          x1={points[a][0] * scale + tx}
          y1={points[a][1] * scale + ty}
          x2={points[b][0] * scale + tx}
          y2={points[b][1] * scale + ty}
          stroke={tokens.ink500}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
      {points.map(([x, y], index) => (
        <circle key={index} cx={x * scale + tx} cy={y * scale + ty} r="2" fill={tokens.ink800} />
      ))}
    </svg>
  );
}

function TemplateRow({ template, mode, onStamp, initialN, onDelete }: {
  template: Template; mode: PlacementMode; onStamp: (template: Template, n?: number) => void; initialN?: number; onDelete?: () => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(String(initialN ?? template.defaultN ?? 6));
  const [committed, setCommitted] = useState(initialN ?? template.defaultN ?? 6);
  const [invalid, setInvalid] = useState(false);
  const min = template.minN ?? 3, max = template.maxN ?? 128;
  const parsed = templateParameter(draft, min, max);
  const n = parsed ?? committed;
  const resolved = resolveTemplate(template, n);
  const name = `${t(template.label)}${template.parametric ? ` ${n}` : ''}`;
  const commit = (): number | null => {
    setInvalid(parsed === null);
    if (parsed !== null) { setCommitted(parsed); setDraft(String(parsed)); }
    return parsed;
  };
  return <div className="template-card" data-template-id={template.id}>
    <button className="template-item" aria-label={t(mode === 'add' ? 'Add {name}' : 'Replace with {name}', { name })} onClick={() => {
      const value = template.parametric ? commit() : undefined;
      if (value !== null) onStamp(template, value);
    }}>
      <Thumbnail template={resolved} />
      <span>
        <span className="template-label">{name}</span>
        <small className="template-counts">{t('{vertices} vertices · {edges} edges', { vertices: resolved.vertices3d.length, edges: resolved.edges.length })}</small>
        <small className="template-description">{description(template)}</small>
      </span>
    </button>
    {template.parametric ? <div className="template-parameter">
      <label htmlFor={id}>{t(template.parametric === 'cycle' ? 'Vertices' : 'Vertices per ring')} ({min}–{max})</label>
      <input id={id} className="template-param" type="text" inputMode="numeric" autoComplete="off"
        aria-label={t('{name} size', { name: t(template.label) })} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit}
        onKeyDown={(event) => {
          if (event.isPropagationStopped() || event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); }
        }} />
      {invalid ? <p id={`${id}-error`} className="field-error" role="alert">{t('Enter a whole number from {min} to {max}.', { min, max })}</p> : null}
    </div> : null}
    {onDelete ? <button className="mini-button icon-only template-delete" aria-label={t('Delete {name}', { name: template.label })} title={t('Delete imported template')} onClick={onDelete}>×</button> : null}
  </div>;
}

export function TemplateDrawer(): JSX.Element | null {
  const open = useStudioStore((state) => state.templateDrawerOpen);
  const setOpen = useStudioStore((state) => state.setTemplateDrawerOpen);
  const pushToast = useStudioStore((state) => state.pushToast);
  const [importError, setImportError] = useState<FileFailure | null>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [imported, setImported] = useState<ImportedTemplate[]>(() => loadImportedTemplates());
  const [recent, setRecent] = useState(loadRecent);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<PlacementMode>('add');
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const template of [...imported, ...templates]) {
      const haystack = [template.label, template.id, template.group].join(' ').normalize('NFKC').toLowerCase();
      if (!query.normalize('NFKC').toLowerCase().trim().split(/\s+/).every((word) => haystack.includes(word))) continue;
      const group = imported.includes(template as ImportedTemplate) ? 'Imported' : template.group;
      map.set(group, [...(map.get(group) ?? []), template]);
    }
    return [...map.entries()];
  }, [query, imported]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!drawerRef.current?.contains(target) && !target?.closest('[data-template-toggle]')) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); setOpen(false); previous?.focus(); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    drawerRef.current?.addEventListener('keydown', onKeyDown);
    const drawer = drawerRef.current;
    return () => { document.removeEventListener('pointerdown', onPointerDown); drawer?.removeEventListener('keydown', onKeyDown); };
  }, [open, setOpen]);

  if (!open) return null;
  const stamp = (template: Template, n?: number) => {
    if (!stampTemplate(template, n, mode)) return;
    const next = [{ id: template.id, ...(n !== undefined ? { n } : {}) }, ...recent.filter((v) => v.id !== template.id)].slice(0, 5);
    setRecent(next); storePreference(RECENT_KEY, JSON.stringify(next));
  };
  const importPolyhedron = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImportError(null);
      const template = parsePolyhedronFile(await readTextFile(file), file.name);
      const next = [...imported, template];
      const saved = saveImportedTemplates(next);
      setImported(next); stamp(template);
      pushToast(t('Imported {name}', { name: template.label }));
      if (!saved) pushToast(t('The template library could not be saved in this browser. Save the project to keep the graph.'));
      if (template.approximateLayout) pushToast(t('Imported without planar layout — 2D positions are approximate'));
    } catch (error) { setImportError(fileFailure(file, error)); }
    finally { if (importRef.current) importRef.current.value = ''; }
  };
  const deleteImported = (template: ImportedTemplate) => {
    if (!window.confirm(t('Delete imported template “{name}”?', { name: template.label }))) return;
    const next = imported.filter((item) => item.id !== template.id);
    const saved = saveImportedTemplates(next); setImported(next);
    pushToast(t(saved ? 'Imported template deleted' : 'Removed for this session; the browser template library could not be updated'));
  };
  const recentTemplates = recent.flatMap((entry) => {
    const template = [...templates, ...imported].find((item) => item.id === entry.id);
    if (!template || (template.parametric && templateParameter(String(entry.n ?? template.defaultN), template.minN ?? 3, template.maxN ?? 128) === null)) return [];
    return [{ template, n: entry.n }];
  });
  return <div className="drawer panel" ref={drawerRef} role="region" aria-label={t('Templates')}>
    <div className="drawer-header"><h2>{t('Templates')}</h2><button className="button" onClick={() => { setOpen(false); document.querySelector<HTMLButtonElement>('[data-template-toggle]')?.focus(); }}>{t('Close')}</button></div>
    <div className="template-search"><input ref={searchRef} type="search" aria-label={t('Search templates')} placeholder={t('Name or alias, e.g. cube / 立方体')} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <label className="placement-mode">{t('Placement')}<select aria-label={t('Placement')} value={mode} onChange={(event) => setMode(event.target.value as PlacementMode)}><option value="add">{t('Add graph')}</option><option value="replace">{t('Replace canvas')}</option></select></label>
    <p className="muted placement-description">{t(mode === 'add' ? 'Adds beside existing graphs. Undo restores the canvas.' : 'Replaces the graph; keeps the project name and notes. Undo is available.')}</p>
    <button className="button import-polyhedron" onClick={() => importRef.current?.click()}>{t('Import polyhedron…')}</button>
    <button className="button polyhedron-format-help" onClick={() => setFormatOpen(true)}>File format & examples</button>
    {importError ? <FileErrorNotice failure={importError} onDismiss={() => setImportError(null)} /> : null}
    {formatOpen ? <PolyhedronImportGuide onClose={() => setFormatOpen(false)} onChooseFile={() => { setFormatOpen(false); importRef.current?.click(); }} /> : null}
    <input ref={importRef} data-testid="polyhedron-file-input" type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(event) => void importPolyhedron(event.target.files?.[0])} />
    {!query && recentTemplates.length ? <section data-testid="recent-templates"><h3 className="template-group">{t('Recently used')}</h3>{recentTemplates.map(({template, n}) => <TemplateRow key={`${template.id}:${n}`} template={template} initialN={n} mode={mode} onStamp={stamp} />)}</section> : null}
    {groups.map(([group, list]) => <section key={group}><h3 className="template-group">{t(group)}</h3>{list.map((template) => <TemplateRow key={template.id} template={template} mode={mode} onStamp={stamp} onDelete={group === 'Imported' ? () => deleteImported(template as ImportedTemplate) : undefined} />)}</section>)}
    {!groups.length ? <p role="status">{t('No matching templates')}</p> : null}
  </div>;
}
