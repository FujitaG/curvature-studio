export interface PanelPosition { x: number; y: number }
export interface PanelLayout {
  guide: { position?: PanelPosition; collapsed: boolean };
  thresholdExpanded: boolean;
}
export function parsePanelLayout(value: unknown): PanelLayout {
  if (value === undefined) return { guide: { collapsed: false }, thresholdExpanded: false };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid panel layout');
  const raw = value as Record<string, unknown>, guide = raw.guide as Record<string, unknown>;
  if (!guide || typeof guide !== 'object' || Array.isArray(guide) || typeof guide.collapsed !== 'boolean' || typeof raw.thresholdExpanded !== 'boolean') throw new Error('Invalid panel layout settings');
  let position: PanelPosition | undefined;
  if (guide.position !== undefined) {
    const pos = guide.position as Record<string, unknown>;
    if (!pos || ![pos.x, pos.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000)) throw new Error('Invalid interaction guide position');
    position = { x: pos.x as number, y: pos.y as number };
  }
  return { guide: { collapsed: guide.collapsed, ...(position ? { position } : {}) }, thresholdExpanded: raw.thresholdExpanded };
}
