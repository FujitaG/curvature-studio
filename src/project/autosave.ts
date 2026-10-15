import { create } from 'zustand';
import { comparisonSession } from '../comparison/flag';
import { captureComparison, openComparison, serialize } from '../comparison/persistence';
import { useComparison } from '../comparison/store';
import { MAX_WORKSPACE_BYTES, parseWorkspace } from '../comparison/format';
import { AUTOSAVE_KEY, MAX_IMPORT_BYTES } from '../state/persistence';
import { useStudioStore } from '../state/store';
import { WORKSPACE_CHANGED } from '../state/viewMemory';
import { parseProjectJson, projectToJson, serializeProject } from './format';
import { useProjectStore, type SaveStatus } from './store';
import { applyProject, applyingProject, captureProject } from './workspace';
import { currentDatabase, fingerprint, isCurrent, LEGACY_PROJECT_KEY, SaveConflict, type CurrentRecord, type MigrationRecord } from '../storage/current';
import { clearCommittedJournal, deleteJournal, journalCapacityAvailable, journals, writeJournal } from '../storage/journal';

function notificationChannel(): BroadcastChannel | null {
  try { return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('curvature-studio-current-v2'); }
  catch { return null; } // Cross-tab correctness is provided by IDB CAS, not notifications.
}
function notify(channel: BroadcastChannel | null, record: CurrentRecord) {
  try { channel?.postMessage({ generation: record.generation, revision: record.revision }); } catch { /* Advisory only. */ }
}
export const PROJECT_AUTOSAVE_KEY = LEGACY_PROJECT_KEY; // legacy migration input only
let expected: CurrentRecord | null = null, recoveryRaw: string | null = null;
let initialized = false;
let observedRecovery: { current: unknown; migration: MigrationRecord | undefined } | null = null;
let controller: { suspend: () => Promise<() => void>; changed: () => void; adopt: () => void } | null = null;
export interface RecoverySource { name: string; raw: string; message: string; journalKey?: string }
export const useRecoverySources = create<{ sources: RecoverySource[]; capacityWarning: boolean }>(() => ({ sources: [], capacityWarning: false }));
export function getRecoveryText(): string | null { return recoveryRaw; }
function status(saveStatus: SaveStatus, message: string) {
  useProjectStore.setState({ saveStatus, saveMessage: message });
  useComparison.setState({ saveStatus, message });
}
const saved = () => status('saved', 'Autosaved in this browser. Download a file to keep a portable copy.');
const blocked = () => ['conflict', 'recovery'].includes(useComparison.getState().documents.length ? useComparison.getState().saveStatus : useProjectStore.getState().saveStatus);
function legacyRaw() { return localStorage.getItem(PROJECT_AUTOSAVE_KEY) ?? localStorage.getItem(AUTOSAVE_KEY); }
async function collectRecoverySources(legacyFingerprint: string | undefined) {
  const sources: RecoverySource[] = [];
  try {
    const raw = legacyRaw();
    if (raw && legacyFingerprint && await fingerprint(raw) !== legacyFingerprint)
      sources.push({ name: 'legacy-project.json', raw, message: 'An older tab changed legacy autosave. Download it to inspect or open explicitly; your current workspace was not replaced.' });
  } catch { /* Canonical IDB remains usable when LS is blocked. */ }
  for (const j of journals()) {
    if (j.journal?.raw === expected?.raw) { try { deleteJournal(j.key); } catch {} continue; }
    sources.push({ journalKey: j.key, name: 'unsaved-project-recovery.json', raw: j.journal?.raw ?? j.text,
      message: j.journal?.generation === expected?.generation && j.journal?.baseRevision === expected?.revision
        ? 'A tab left possibly unsaved project edits. Download and inspect before opening them.'
        : 'Recovery data belongs to another saved revision. It will not replace this workspace automatically.' });
  }
  useRecoverySources.setState({ sources, capacityWarning: !journalCapacityAvailable() });
}
export async function initializeWorkspace(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const inspected = await currentDatabase.inspect();
    observedRecovery = inspected;
    if (isCurrent(inspected.current)) expected = inspected.current;
    else if (inspected.migration) {
      recoveryRaw = JSON.stringify(inspected.current ?? { error: 'Missing current workspace', migration: inspected.migration });
      throw new Error('The saved workspace is missing or unreadable. Legacy autosave has not been substituted.');
    } else {
      const legacy = legacyRaw();
      const previous = inspected.current as { raw?: unknown } | undefined;
      if (previous !== undefined && typeof previous.raw !== 'string') {
        recoveryRaw = JSON.stringify(previous); throw new Error('Unrecognized saved comparison');
      }
      recoveryRaw = previous?.raw as string ?? legacy;
      const kind = previous ? 'comparison' : 'project';
      let raw: string;
      if (previous) { const value = parseWorkspace(JSON.parse(previous.raw as string)); raw = await serialize(value); }
      else if (legacy) {
        if (new Blob([legacy]).size > MAX_IMPORT_BYTES) throw new Error('Stored project exceeds 8 MiB');
        raw = serializeProject(projectToJson(parseProjectJson(JSON.parse(legacy), 'Recovered document')));
      } else raw = serializeProject(captureProject());
      const hash = await fingerprint(legacy);
      if (legacyRaw() !== legacy) throw new SaveConflict();
      try { expected = await currentDatabase.migrate(inspected.current, kind, raw, hash); }
      catch (error) {
        if (!(error instanceof SaveConflict)) throw error;
        // Another new tab won migration; open its canonical record, never overwrite it.
        expected = await currentDatabase.read(); if (!expected) throw error;
      }
    }
    recoveryRaw = expected.raw;
    if (new Blob([expected.raw]).size > (expected.kind === 'project' ? MAX_IMPORT_BYTES : MAX_WORKSPACE_BYTES)) throw new Error('Stored workspace exceeds the size limit');
    if (expected.kind === 'comparison') openComparison(JSON.parse(expected.raw), false);
    else applyProject(parseProjectJson(JSON.parse(expected.raw)), false);
    recoveryRaw = null; observedRecovery = null; saved();
    await collectRecoverySources((await currentDatabase.inspect()).migration?.legacyFingerprint);
  } catch (error) {
    status(error instanceof SaveConflict ? 'conflict' : recoveryRaw ? 'recovery' : 'error',
      `Browser autosave could not be opened: ${error instanceof Error ? error.message : 'Storage unavailable'}. Download your work or recovery data. Nothing was discarded.`);
    await collectRecoverySources(undefined);
  }
}
/** One controller for project and comparison, including lifecycle and commit ownership. */
export function startAutosave(): () => void {
  let timer: number | undefined, disposed = false, paused = 0, sequence = 0, committed = 0;
  let flight: Promise<void> | null = null;
  let documents = useComparison.getState().documents;
  let identity: unknown = documents.length ? documents : useProjectStore.getState().metadata.id;
  let replace = false, epoch = 0;
  let stops: Array<() => void> = [];
  const channel = notificationChannel();
  const currentIdentity = () => useComparison.getState().documents.length ? useComparison.getState().documents : useProjectStore.getState().metadata.id;
  const schedule = () => {
    if (disposed || applyingProject || comparisonSession.applying) return;
    const next = currentIdentity();
    if (next !== identity) { identity = next; epoch++; replace = true; }
    sequence++;
    if (paused || blocked()) return;
    status('pending', 'Saving workspace…'); clearTimeout(timer); timer = window.setTimeout(() => void flush(), 500);
  };
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    if (flight) return flight;
    if (disposed || paused || blocked() || committed === sequence) return Promise.resolve();
    const seq = sequence, token = epoch, base = expected, replacing = replace;
    const kind = useComparison.getState().documents.length ? 'comparison' : 'project';
    flight = Promise.resolve().then(async () => {
      try {
        if (!base) throw new Error('Browser autosave is unavailable. Reload after downloading your work.');
        const raw = kind === 'comparison' ? await serialize(captureComparison()) : serializeProject(captureProject());
        if (disposed || token !== epoch) return;
        const next = await currentDatabase.commit(base, kind, raw, replacing || kind !== base.kind, () => !disposed && token === epoch);
        expected = next; committed = seq; if (token === epoch) replace = false;
        clearCommittedJournal(seq); notify(channel, next);
        if (sequence === seq) saved();
      } catch (error) {
        if (!disposed && token === epoch) status(error instanceof SaveConflict ? 'conflict' : 'error',
          `${error instanceof Error ? error.message : 'Browser autosave failed'}. Your work is still here; download a file to keep it.`);
      } finally {
        flight = null;
        if (!disposed && !paused && !blocked() && sequence !== seq) timer = window.setTimeout(() => void flush(), 500);
      }
    });
    return flight;
  };
  const bind = () => {
    stops.forEach(stop => stop());
    const targets = documents.length ? documents : [{ studio: useStudioStore, project: useProjectStore }];
    stops = targets.flatMap(d => [d.studio.subscribe((s, b) => {
      if (s.doc !== b.doc || s.style !== b.style || s.customGradients !== b.customGradients || s.camera2d !== b.camera2d || s.metric !== b.metric || s.view !== b.view || s.projection !== b.projection || s.panels !== b.panels || s.histogramCollapsed !== b.histogramCollapsed || s.labelsVisible !== b.labelsVisible) schedule();
    }), d.project.subscribe((s, b) => {
      if (s.metadata !== b.metadata || s.extensions !== b.extensions || s.precision !== b.precision || s.figure !== b.figure) schedule();
    })]);
  };
  bind();
  const stopComparison = useComparison.subscribe((s, b) => {
    if (s.documents !== b.documents) { documents = s.documents; bind(); }
    if (s.documents !== b.documents || s.mode !== b.mode || s.activeId !== b.activeId || s.ratio !== b.ratio || s.linked !== b.linked || s.distribution !== b.distribution || s.colors !== b.colors || s.custom !== b.custom || s.extensions !== b.extensions) schedule();
  });
  const checkPeer = async () => {
    try { const latest = await currentDatabase.read();
      if (!disposed && expected && latest && (latest.generation !== expected.generation || latest.revision !== expected.revision))
        status('conflict', new SaveConflict().message);
    } catch { /* Writes still verify in a transaction. */ }
  };
  if (channel) channel.onmessage = () => void checkPeer();
  const visibility = () => { if (document.visibilityState === 'hidden') void flush(); else void checkPeer(); };
  const pagehide = () => {
    if (!documents.length && sequence !== committed && !blocked()) {
      try { if (!writeJournal(expected ?? { generation: 'uncommitted', revision: 0 }, sequence, serializeProject(captureProject()))) status('error', 'Could not keep an emergency recovery copy. Download a project file.'); } catch { /* No invalid recovery snapshot. */ }
    }
    void flush();
  };
  const resume = async () => {
    let changedGeneration = false;
    paused++; clearTimeout(timer); if (flight) await flight;
    try {
      const latest = await currentDatabase.read();
      changedGeneration = !!latest && !!expected && (latest.generation !== expected.generation || latest.kind !== expected.kind);
      if (!latest || !expected || latest.generation !== expected.generation || latest.kind !== expected.kind || recoveryRaw)
        throw new Error('The saved workspace was replaced or needs recovery. Download your work, then reload or explicitly open a file.');
      expected = latest; status('pending', 'Saving workspace…'); schedule();
    } catch (error) { status(changedGeneration || error instanceof SaveConflict ? 'conflict' : recoveryRaw ? 'recovery' : 'error', error instanceof Error ? error.message : 'Could not resume autosave'); }
    finally { paused--; if (!blocked()) void flush(); }
  };
  const onStorage = () => { void currentDatabase.inspect().then(v => collectRecoverySources(v.migration?.legacyFingerprint)).catch(() => {}); };
  const replaced = (event: Event) => {
    const target = (event as CustomEvent).detail;
    if (documents.some(d => d.studio === target) || (!documents.length && target.getState() === useStudioStore.getState())) { epoch++; replace = true; schedule(); }
  };
  const api = { changed: schedule, adopt: () => { identity = currentIdentity(); epoch++; replace = false; committed = sequence; clearCommittedJournal(sequence); }, suspend: async () => {
    paused++; clearTimeout(timer); if (flight) await flight;
    let released = false;
    return () => { if (released) return; released = true; paused--; if (!paused && sequence !== committed && !blocked()) timer = window.setTimeout(() => void flush(), 500); };
  } };
  controller = api;
  window.addEventListener('curvature-studio:workspace-replaced', replaced);
  window.addEventListener(WORKSPACE_CHANGED, schedule);
  window.addEventListener('pagehide', pagehide); document.addEventListener('visibilitychange', visibility);
  window.addEventListener('storage', onStorage);
  window.addEventListener('curvature-studio:resume-autosave', resume); window.addEventListener('curvature-studio:resume-comparison', resume);
  return () => {
    disposed = true; epoch++; clearTimeout(timer); stops.forEach(stop => stop()); stopComparison(); channel?.close();
    if (controller === api) controller = null;
    window.removeEventListener('curvature-studio:workspace-replaced', replaced);
    window.removeEventListener(WORKSPACE_CHANGED, schedule); window.removeEventListener('pagehide', pagehide);
    document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', onStorage);
    window.removeEventListener('curvature-studio:resume-autosave', resume); window.removeEventListener('curvature-studio:resume-comparison', resume);
  };
}
export async function suspendAutosave() {
  if (!controller) throw new Error('Autosave is not ready. Try again after the workspace has opened.');
  return controller.suspend();
}
export async function commitEndedProject(raw: string, valid: () => boolean) {
  if (blocked() || !expected) throw new Error('Resolve the autosave conflict or recovery first. Download both structures to keep your work.');
  const base = expected;
  // A freshly-created comparison may not have reached autosave yet; CAS still guards its base.
  const next = await currentDatabase.commit(base, 'project', raw, true, valid);
  expected = next;
  const channel = notificationChannel();
  notify(channel, next); channel?.close();
  saved();
}

export function adoptEndedWorkspace() { controller?.adopt(); }

/** Explicit recovery action; normal Resume never replaces an unreadable/new-generation record. */
export async function replaceUnreadableAutosave() {
  if (!observedRecovery || !recoveryRaw) throw new Error('Reload to inspect the saved workspace before replacing it.');
  const release = await suspendAutosave();
  try {
    const kind = useComparison.getState().documents.length ? 'comparison' : 'project';
    const raw = kind === 'comparison' ? await serialize(captureComparison()) : serializeProject(captureProject());
    const legacy = legacyRaw();
    expected = await currentDatabase.replaceObserved(observedRecovery, kind, raw, recoveryRaw, await fingerprint(legacy));
    recoveryRaw = null; observedRecovery = null; saved(); controller?.changed();
  } finally { release(); }
}
export async function deleteRecoverySource(source: RecoverySource) {
  if (source.journalKey) deleteJournal(source.journalKey);
  await collectRecoverySources((await currentDatabase.inspect()).migration?.legacyFingerprint);
}
export function openRecoverySource(source: RecoverySource) {
  if (new Blob([source.raw]).size > MAX_IMPORT_BYTES) throw new Error('Recovery project exceeds 8 MiB. Download it for inspection.');
  applyProject(parseProjectJson(JSON.parse(source.raw), 'Recovered project'), true);
}
