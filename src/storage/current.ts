/** Browser autosave only. Portable project/workspace formats are unchanged. */
export type SaveKind = 'project' | 'comparison';
export interface CurrentRecord { version: 2; kind: SaveKind; generation: string; revision: number; raw: string }
export interface MigrationRecord { version: 2; legacyFingerprint: string }
export class StaleCandidate extends Error {
  constructor() { super('The workspace changed while confirming. Choose the structure again.'); }
}
export class SaveConflict extends Error {
  constructor() { super('Another tab changed the saved workspace. Download your work before opening the saved version.'); }
}
export const DATABASE = 'curvature-studio-workspaces';
export const LEGACY_PROJECT_KEY = 'curvature-studio:project:v1';
export function isCurrent(value: unknown): value is CurrentRecord {
  const v = value as CurrentRecord;
  return !!v && v.version === 2 && ['project', 'comparison'].includes(v.kind) && typeof v.generation === 'string' &&
    v.generation.length > 0 && Number.isSafeInteger(v.revision) && v.revision > 0 && typeof v.raw === 'string';
}
export function sameRevision(a: CurrentRecord | null, b: CurrentRecord | null) {
  return a === null ? b === null : !!b && a.generation === b.generation && a.revision === b.revision && a.kind === b.kind;
}
export async function fingerprint(raw: string | null): Promise<string> {
  if (raw === null) return 'absent';
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `${bytes.length}:${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
}
export class CurrentDatabase {
  private pending?: Promise<IDBDatabase>;
  constructor(private name = DATABASE) {}
  close() { void this.pending?.then(db => db.close()); this.pending = undefined; }
  private open(): Promise<IDBDatabase> {
    return this.pending ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(this.name, 2);
      let rejected = false;
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('workspaces')) r.result.createObjectStore('workspaces'); };
      r.onblocked = () => { rejected = true; this.pending = undefined; reject(new Error('Close or reload older Curvature Studio tabs, then retry. Browser database upgrade is blocked.')); };
      r.onerror = () => { this.pending = undefined; reject(r.error); };
      r.onsuccess = () => {
        if (rejected) { r.result.close(); return; }
        r.result.onversionchange = () => { r.result.close(); this.pending = undefined; };
        resolve(r.result);
      };
    });
  }
  async inspect(): Promise<{ current: unknown; migration: MigrationRecord | undefined }> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspaces'), s = tx.objectStore('workspaces');
      const current = s.get('current'), migration = s.get('migrationComplete');
      tx.oncomplete = () => resolve({ current: current.result, migration: migration.result });
      tx.onabort = () => reject(tx.error); tx.onerror = () => {};
    });
  }
  async read(): Promise<CurrentRecord | null> {
    const { current, migration } = await this.inspect();
    if (current === undefined && !migration) return null;
    if (!isCurrent(current)) throw new Error('The saved workspace is missing or unreadable. Download recovery data; legacy data will not be opened automatically.');
    return current;
  }
  /** Atomic initial migration: retain the v1 comparison as explicit recovery material. */
  async migrate(previous: unknown, kind: SaveKind, raw: string, legacyFingerprint: string): Promise<CurrentRecord> {
    const db = await this.open();
    const next: CurrentRecord = { version: 2, kind, raw, generation: crypto.randomUUID(), revision: 1 };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite'), s = tx.objectStore('workspaces');
      const get = s.get('current'), migration = s.get('migrationComplete');
      let conflict = false;
      migration.onsuccess = () => {
        if (migration.result || JSON.stringify(get.result) !== JSON.stringify(previous)) { conflict = true; tx.abort(); return; }
        try {
          if (previous !== undefined) s.put(previous, 'recovery-before-v2');
          s.put(next, 'current'); s.put({ version: 2, legacyFingerprint }, 'migrationComplete');
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(conflict ? new SaveConflict() : tx.error ?? new Error('Could not migrate browser autosave'));
      tx.onerror = () => {};
    });
  }
  /** Explicit recovery only: CAS against exactly what failed to open, archive before replacement. */
  async replaceObserved(observed: { current: unknown; migration: MigrationRecord | undefined }, kind: SaveKind, raw: string, recoveryRaw: string, legacyFingerprint: string): Promise<CurrentRecord> {
    const db = await this.open();
    const oldRevision = (observed.current as CurrentRecord | undefined)?.revision;
    const revision = Number.isSafeInteger(oldRevision) && oldRevision! > 0 ? oldRevision! + 1 : 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Autosave revision limit reached. Download your work.');
    const next: CurrentRecord = { version: 2, kind, raw, generation: crypto.randomUUID(), revision };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite'), store = tx.objectStore('workspaces');
      const current = store.get('current'), migration = store.get('migrationComplete'); let conflict = false;
      migration.onsuccess = () => {
        if (JSON.stringify(current.result) !== JSON.stringify(observed.current) || JSON.stringify(migration.result) !== JSON.stringify(observed.migration)) { conflict = true; tx.abort(); return; }
        try {
          store.put({ current: observed.current, raw: recoveryRaw }, `recovery-${crypto.randomUUID()}`);
          store.put(next, 'current');
          store.put(observed.migration ?? { version: 2, legacyFingerprint }, 'migrationComplete');
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(next); tx.onerror = () => {};
      tx.onabort = () => reject(conflict ? new SaveConflict() : tx.error ?? new Error('Could not replace unreadable autosave'));
    });
  }
  async commit(expected: CurrentRecord, kind: SaveKind, raw: string, replace: boolean, valid = () => true): Promise<CurrentRecord> {
    const db = await this.open();
    const next: CurrentRecord = { version: 2, kind, raw, generation: replace ? crypto.randomUUID() : expected.generation, revision: expected.revision + 1 };
    if (!Number.isSafeInteger(next.revision)) throw new Error('Autosave revision limit reached. Download your project.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite'), s = tx.objectStore('workspaces'), get = s.get('current');
      let conflict = false, stale = false;
      get.onsuccess = () => {
        if (!valid()) { stale = true; tx.abort(); return; }
        if (!isCurrent(get.result) || !sameRevision(expected, get.result)) { conflict = true; tx.abort(); return; }
        try { s.put(next, 'current'); } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(stale ? new StaleCandidate() : conflict ? new SaveConflict() : tx.error ?? new Error('Browser storage could not save the workspace'));
      tx.onerror = () => {};
    });
  }
}
export const currentDatabase = new CurrentDatabase();
