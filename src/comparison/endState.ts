import { create } from 'zustand';
import type { ProjectJson } from '../project/format';
export const useEndComparison = create<{ open: boolean; discarded: { side: string; project: ProjectJson } | null }>(() => ({ open: false, discarded: null }));
export const requestEndComparison = () => useEndComparison.setState({ open: true });
export const clearDiscarded = () => useEndComparison.setState({ discarded: null, open: false });
