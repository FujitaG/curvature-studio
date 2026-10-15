import type { StudioStore } from '../state/store';
/** Legacy single-project autosave is suspended once both documents exist. */
export const comparisonSession: {
    present: boolean;
    applying: boolean;
    onCapture?: (store: StudioStore, value: import('../project/format').ProjectJson) => void;
    onApplied?: (store: StudioStore) => void;
} = { present: false, applying: false };
