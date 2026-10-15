import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderScheduler, MAX_SCREEN_PIXELS, screenPixelRatio } from '../renderScheduler';

let pending: Map<number, FrameRequestCallback>;
let id: number;
const tick = () => {
  const batch = [...pending.values()]; pending.clear();
  batch.forEach((callback) => callback(performance.now()));
};
beforeEach(() => {
  pending = new Map(); id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
});
afterEach(() => vi.unstubAllGlobals());

describe('3D render scheduling', () => {
  it('coalesces rapid edits into one frame and consumes no frames at rest', () => {
    const render = vi.fn(() => false), scheduler = createRenderScheduler(render);
    for (let i = 0; i < 100; i++) scheduler.request();
    tick();
    expect(render).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    tick();
    expect(render).toHaveBeenCalledOnce();
  });
  it('continues through camera damping, then stops', () => {
    let remaining = 3;
    const render = vi.fn(() => --remaining > 0), scheduler = createRenderScheduler(render);
    scheduler.request();
    tick(); tick(); tick(); tick();
    expect(render).toHaveBeenCalledTimes(3);
    expect(pending.size).toBe(0);
  });
  it('suspends hidden tabs, redraws on return, and cancels pending work on unmount', () => {
    const render = vi.fn(() => false), scheduler = createRenderScheduler(render);
    scheduler.request(); scheduler.setVisible(false); scheduler.request(); tick();
    expect(render).not.toHaveBeenCalled();
    scheduler.setVisible(true); tick();
    expect(render).toHaveBeenCalledOnce();
    scheduler.request(); scheduler.dispose(); scheduler.request(); tick();
    expect(render).toHaveBeenCalledOnce();
  });
  it.each([[390, 844, 3], [1440, 960, 2], [3840, 2160, 2], [320, 600, 1]])('bounds the screen pixel cost at %ipx', (w, h, dpr) => {
    const ratio = screenPixelRatio(w, h, dpr);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(Math.min(dpr, 2));
    expect(Math.floor(w * ratio) * Math.floor(h * ratio)).toBeLessThanOrEqual(MAX_SCREEN_PIXELS);
  });
});
