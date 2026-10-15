/** Coalesce edits and pointer events; only keep ticking while the camera animates. */
export function createRenderScheduler(render: (time: number) => boolean) {
  let frame: number | null = null;
  let visible = true;
  let disposed = false;
  const request = () => {
    if (disposed || !visible || frame !== null) return;
    frame = requestAnimationFrame((time) => {
      frame = null;
      if (render(time)) request();
    });
  };
  return {
    request,
    setVisible(value: boolean) {
      visible = value;
      if (!visible && frame !== null) { cancelAnimationFrame(frame); frame = null; }
      if (visible) request();
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
  };
}

export const MAX_SCREEN_PIXELS = 4_000_000;
export function screenPixelRatio(width: number, height: number, deviceRatio: number): number {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(ratio, 2, Math.sqrt(MAX_SCREEN_PIXELS / Math.max(1, width * height)));
}
