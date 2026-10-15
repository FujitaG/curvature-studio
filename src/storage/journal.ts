import type { CurrentRecord } from './current';
export const JOURNAL_PREFIX = 'curvature-studio:recovery-journal:v2:';
// Immutable snapshot keys: deleting an inspected copy cannot erase a later write
// from its original tab. sessionStorage IDs can be copied when a tab is duplicated.
const owned = new Map<string, { sequence: number; raw: string }>();
const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 4;
export interface Journal { version: 2; generation: string; baseRevision: number; sequence: number; raw: string }
export function writeJournal(base: Pick<CurrentRecord, 'generation' | 'revision'>, sequence: number, raw: string): boolean {
  try {
    const text = JSON.stringify({ version: 2, generation: base.generation, baseRevision: base.revision, sequence, raw });
    const others = Object.keys(localStorage).filter(k => k.startsWith(JOURNAL_PREFIX) && !owned.has(k));
    if (others.length >= MAX_RECORDS || new Blob([text, ...others.map(k => localStorage.getItem(k) ?? '')]).size > MAX_BYTES) return false;
    const key = JOURNAL_PREFIX + crypto.randomUUID();
    localStorage.setItem(key, text);
    // The latest snapshot supersedes only this page's own previous recovery copies.
    for (const old of owned.keys()) localStorage.removeItem(old);
    owned.clear(); owned.set(key, { sequence, raw }); return true;
  } catch { return false; }
}
export function clearCommittedJournal(sequence: number) {
  try { for (const [key, item] of owned) if (item.sequence <= sequence) { localStorage.removeItem(key); owned.delete(key); } }
  catch { /* Preserve recovery bytes if storage is unavailable. */ }
}
export function deleteJournal(key: string) {
  if (!key.startsWith(JOURNAL_PREFIX)) throw new Error('Not a recovery journal key');
  localStorage.removeItem(key); owned.delete(key);
}
export function journals(): Array<{ key: string; text: string; journal: Journal | null }> {
  try { return Object.keys(localStorage).filter(k => k.startsWith(JOURNAL_PREFIX)).map(key => {
    const text = localStorage.getItem(key)!;
    try { const j = JSON.parse(text); return { key, text, journal: j?.version === 2 && typeof j.raw === 'string' && typeof j.generation === 'string' && Number.isSafeInteger(j.baseRevision) ? j as Journal : null }; }
    catch { return { key, text, journal: null }; }
  }); } catch { return []; }
}
export function journalCapacityAvailable(): boolean {
  try { const all = journals().filter(j => !owned.has(j.key)); return all.length < MAX_RECORDS && new Blob(all.map(j => j.text)).size < MAX_BYTES; } catch { return false; }
}
