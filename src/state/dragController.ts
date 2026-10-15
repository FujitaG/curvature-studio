export const CANCEL_DRAG_EVENT = 'curvature-studio:cancel-drag';

export function cancelActiveDrag(): boolean {
  const event = new Event(CANCEL_DRAG_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
