import { useEffect, type RefObject } from 'react';

export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>
): void {
  useEffect(() => {
    if (!open) return;

    const containsTarget = (target: EventTarget | null) =>
      target instanceof Node && refs.some((ref) => ref.current?.contains(target));

    const onPointerDown = (event: PointerEvent) => {
      if (!containsTarget(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        onClose(); refs.at(-1)?.current?.focus();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose, open, refs]);
}
