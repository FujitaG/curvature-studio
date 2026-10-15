/** Preference storage must never prevent an edit. Project autosave reports failures separately. */
export function storePreference(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // In-memory state remains usable when browser storage is full or disabled.
  }
}
