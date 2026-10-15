import type { ToolMode } from '../state/types';

interface IconProps {
  name: ToolMode | 'templates' | 'overflow' | 'collapse' | 'crosshair' | 'close' | 'undo' | 'redo' | 'download' | 'fit' | 'clear' | 'style';
}

export function Icon({ name }: IconProps): JSX.Element {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'select') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M5 3l9 8-5 1.2-2.2 4.6L5 3z" />
      </svg>
    );
  }
  if (name === 'bond') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M5 15L15 5" />
        <circle cx="5" cy="15" r="2" fill="currentColor" />
        <circle cx="15" cy="5" r="2" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'brace') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M5 13.3L13.3 5" />
        <path {...common} d="M6.7 15L15 6.7" />
        <circle cx="5" cy="15" r="1.7" fill="currentColor" />
        <circle cx="15" cy="5" r="1.7" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'erase') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M4 12l6.5-6.5a2 2 0 012.8 0l1.2 1.2a2 2 0 010 2.8L9 15H5.5L4 13.5V12z" />
        <path {...common} d="M8 15h8" />
      </svg>
    );
  }
  if (name === 'templates') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M10 3l6 3.5v7L10 17l-6-3.5v-7L10 3z" />
        <path {...common} d="M4 6.5l6 3.5 6-3.5M10 10v7" />
      </svg>
    );
  }
  if (name === 'overflow') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="5" r="1.3" fill="currentColor" />
        <circle cx="10" cy="10" r="1.3" fill="currentColor" />
        <circle cx="10" cy="15" r="1.3" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'download') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M10 3v9" />
        <path {...common} d="M6.5 8.5L10 12l3.5-3.5" />
        <path {...common} d="M5 16h10" />
      </svg>
    );
  }
  if (name === 'fit') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M6.5 4H4v2.5M13.5 4H16v2.5M16 13.5V16h-2.5M6.5 16H4v-2.5" />
        <circle {...common} cx="10" cy="10" r="3" />
        <path {...common} d="M10 6v2M10 12v2M6 10h2M12 10h2" />
      </svg>
    );
  }
  if (name === 'clear') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M5 6h10" />
        <path {...common} d="M8 6V4h4v2" />
        <path {...common} d="M7 8l.5 7h5L13 8" />
        <path {...common} d="M5 16h10" />
      </svg>
    );
  }
  if (name === 'style') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M5 6h10M5 14h10" />
        <circle cx="8" cy="6" r="2" fill="currentColor" />
        <circle cx="12" cy="14" r="2" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'collapse') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path {...common} d="M6 8l4 4 4-4" />
      </svg>
    );
  }
  if (name === 'crosshair') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle {...common} cx="10" cy="10" r="5" />
        <path {...common} d="M10 2v4M10 14v4M2 10h4M14 10h4" />
      </svg>
    );
  }
  if (name === 'undo' || name === 'redo') {
    const flip = name === 'redo' ? 'scale(-1 1) translate(-20 0)' : undefined;
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <g transform={flip}>
          <path {...common} d="M8 6H4v4" />
          <path {...common} d="M4 10c2-4 10-5 12 2" />
        </g>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path {...common} d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
