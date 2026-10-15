import { parseFigure, type FigureSettings } from '../export/figure';
import { CURRENT_CALCULATION, assertCurrentCalculation } from '../math/calculation';
import { parseSessionJson, sessionToJson, type ParsedSession, type SessionJson } from '../state/interchange';
import { MAX_IMPORT_BYTES, parseDocJson } from '../state/persistence';
import { DEFAULT_STUDIO_STYLE } from '../state/style';

/** Public alias: one definition shared with the calculation boundary. */
export const CALCULATION = CURRENT_CALCULATION;

export interface ProjectMetadata {
  id: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
// TODO(weighted-graphs): non-unit weights require a new document AND enclosing
// format version, plus an explicit supported model. Do not widen v1 in place.
export interface ProjectJson {
  format: 'curvature-studio/project';
  version: 1;
  metadata: ProjectMetadata;
  calculation: typeof CALCULATION;
  session: SessionJson;
  resultsDisplay: { precision: number };
  extensions: Record<string, JsonValue>;
  figure?: FigureSettings;
}
export interface ParsedProject extends Omit<ProjectJson, 'session'> { session: ParsedSession }

export function newMetadata(title = 'Untitled project'): ProjectMetadata {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title, notes: '', createdAt: now, updatedAt: now };
}

const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
const timestamp = (input: unknown): input is string => typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(input) && Number.isFinite(Date.parse(input));

function validateJson(input: unknown, depth = 0): void {
  if (depth > 30) throw new Error('Project extensions are nested too deeply');
  if (input === null || typeof input === 'string' || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return;
  if (Array.isArray(input)) { input.forEach((item) => validateJson(item, depth + 1)); return; }
  if (record(input)) { Object.values(input).forEach((item) => validateJson(item, depth + 1)); return; }
  throw new Error('Project extensions must contain JSON values');
}

export function projectToJson(project: ParsedProject): ProjectJson {
  assertCurrentCalculation(project.calculation);
  return {
    format: 'curvature-studio/project', version: 1,
    metadata: { ...project.metadata }, calculation: { ...CALCULATION },
    session: sessionToJson(project.session),
    resultsDisplay: { ...project.resultsDisplay }, ...(project.figure === undefined ? {} : { figure: parseFigure(project.figure) }),
    extensions: structuredClone(project.extensions)
  };
}

/** Validate everything before applying any part of a file to the live workspace. */
export function parseProjectJson(input: unknown, legacyTitle = 'Imported project', repairCameras = true): ParsedProject {
  if (!record(input)) throw new Error('The file must contain a JSON object');
  if (input.format === 'curvature-studio/doc' || input.format === 'curvature-studio/session') {
    const session = input.format === 'curvature-studio/session' ? parseSessionJson(input, repairCameras) : parseSessionJson(sessionToJson({
      doc: parseDocJson(input), view: '2d', metric: 'keff', labelsVisible: true,
      camera2d: { tx: 0, ty: 0, scale: 1 }, histogramCollapsed: false,
      style: DEFAULT_STUDIO_STYLE, customGradients: []
    }));
    return { format: 'curvature-studio/project', version: 1, metadata: newMetadata(legacyTitle.slice(0, 120)), calculation: CALCULATION, session, resultsDisplay: { precision: 6 }, extensions: {} };
  }
  if (input.format !== 'curvature-studio/project') throw new Error('Choose a project, session, or document. Style and polyhedron files have their own import commands.');
  if (input.version !== 1) throw new Error(`Project version ${String(input.version)} is not supported. Open it with a compatible version of Curvature Studio.`);
  const meta = input.metadata;
  if (!record(meta) || typeof meta.id !== 'string' || !meta.id.trim() || meta.id.length > 128 ||
      typeof meta.title !== 'string' || !meta.title.trim() || meta.title.length > 120 ||
      typeof meta.notes !== 'string' || meta.notes.length > 10000 || !timestamp(meta.createdAt) || !timestamp(meta.updatedAt)) {
    throw new Error('Invalid project metadata (name, notes, or dates)');
  }
  if (Date.parse(meta.createdAt) > Date.parse(meta.updatedAt)) throw new Error('Project update date precedes its creation date');
  const calculation = input.calculation;
  assertCurrentCalculation(calculation);
  const display = input.resultsDisplay ?? { precision: 6 };
  if (!record(display) || !Number.isInteger(display.precision) || Number(display.precision) < 2 || Number(display.precision) > 10) throw new Error('Result precision must be between 2 and 10 decimal places');
  const extensions = input.extensions ?? {};
  if (!record(extensions)) throw new Error('Project extensions must be an object');
  validateJson(extensions);
  return {
    format: 'curvature-studio/project', version: 1,
    metadata: { id: meta.id, title: meta.title.trim(), notes: meta.notes, createdAt: meta.createdAt, updatedAt: meta.updatedAt },
    calculation: CALCULATION, session: parseSessionJson(input.session, repairCameras), ...(input.figure === undefined ? {} : { figure: parseFigure(input.figure) }),
    resultsDisplay: { precision: Number(display.precision) }, extensions: structuredClone(extensions) as Record<string, JsonValue>
  };
}

/** Downloads and autosave use the same validation and compact UTF-8 size contract. */
export function serializeProject(project: ProjectJson): string {
  // Do not silently repair an invalid live document, camera or extension while saving.
  const parsed = parseProjectJson(project, 'Imported project', false);
  const text = JSON.stringify(projectToJson(parsed));
  const bytes = new Blob([text]).size;
  if (bytes > MAX_IMPORT_BYTES) throw new Error(`Project is ${(bytes / 1048576).toFixed(2)} MiB (${bytes.toLocaleString('en-US')} bytes); the limit is 8 MiB. Reduce project content or extension data before saving. Nothing was discarded.`);
  return text;
}

export function projectFilename(title: string, suffix: string): string {
  const name = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || 'curvature-project';
  return `${name}${suffix}`;
}
