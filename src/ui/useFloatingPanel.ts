import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { PanelPosition } from '../state/panelLayout';

/** Drag only from the title. Persist once on release, not once per pointer move. */
export function useFloatingPanel(saved: PanelPosition | null, save: (position: PanelPosition | null) => void, restoreEvent?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(saved);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; origin: PanelPosition } | null>(null);
  const latest = useRef(position); latest.current = position;
  const clamp = (p: PanelPosition) => {
    const rect = ref.current?.getBoundingClientRect();
    const chrome = document.querySelector('.project-bar')?.getBoundingClientRect().bottom ?? 0;
    const minY = Math.min(chrome + 8, Math.max(8, window.innerHeight - 48));
    return { x: Math.max(8, Math.min(Math.max(8, window.innerWidth - (rect?.width ?? 264) - 8), p.x)),
      y: Math.max(minY, Math.min(Math.max(minY, window.innerHeight - (rect?.height ?? 40) - 8), p.y)) };
  };
  useEffect(() => { setPosition(saved ? clamp(saved) : null); }, [saved?.x, saved?.y]);
  useEffect(() => {
    if (!restoreEvent) return;
    const restore = (event: Event) => { const p = (event as CustomEvent<PanelPosition | null>).detail; setPosition(p ? clamp(p) : null); };
    window.addEventListener(restoreEvent, restore);
    return () => window.removeEventListener(restoreEvent, restore);
  }, [restoreEvent]);
  useLayoutEffect(() => {
    const resize = () => setPosition(p => { if (!p) return p; const next = clamp(p); return next.x === p.x && next.y === p.y ? p : next; });
    const observer = new ResizeObserver(resize);
    if (ref.current) observer.observe(ref.current);
    const bar = document.querySelector('.project-bar'); if (bar) observer.observe(bar);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, []);
  const reset = () => { save(null); setPosition(null); };
  const interactive = (target: EventTarget) => (target as HTMLElement).closest('button,input,select,a,.tooltip-anchor');
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    const p = latest.current; if (p) save(p);
  };
  return {
    ref, dragging,
    style: position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined,
    titleProps: {
      tabIndex: 0,
      title: 'Drag to move. Arrow keys move; Home resets position.',
      onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => { if (!interactive(e.target)) reset(); },
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Home') { reset(); return; }
        const rect = ref.current!.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
        const p = clamp({ x: rect.left + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y: rect.top + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) });
        setPosition(p); save(p);
      },
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || interactive(e.target)) return;
        const rect = ref.current!.getBoundingClientRect();
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, origin: { x: rect.left, y: rect.top } };
        e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); setDragging(true);
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current; if (!d || d.id !== e.pointerId) return;
        const p = clamp({ x: d.origin.x + e.clientX - d.x, y: d.origin.y + e.clientY - d.y });
        latest.current = p; setPosition(p);
      },
      onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end
    }
  };
}
