export function shortcut(key: string): string {
  const apple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  const parts = key.split('+').map((part) => part.toLowerCase() === 'shift' ? (apple ? '⇧' : 'Shift') : part.toUpperCase());
  return apple ? `⌘${parts.join('')}` : `Ctrl+${parts.join('+')}`;
}
