export interface PanelVisibility { histogram: boolean; inspector: boolean; legend: boolean; hints: boolean }
export const DEFAULT_PANELS: PanelVisibility = { histogram: true, inspector: true, legend: true, hints: true };

/** Optional in session v2 so older projects retain their original defaults. */
export function parsePanels(value: unknown): PanelVisibility {
  if (value === undefined) return { ...DEFAULT_PANELS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid panel visibility settings');
  const panels = { ...DEFAULT_PANELS };
  for (const key of Object.keys(panels) as Array<keyof PanelVisibility>) {
    const setting = (value as Record<string, unknown>)[key];
    if (setting !== undefined && typeof setting !== 'boolean') throw new Error(`Invalid ${key} panel visibility`);
    if (typeof setting === 'boolean') panels[key] = setting;
  }
  return panels;
}
