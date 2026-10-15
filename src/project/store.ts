import { activeStore } from '../state/activeStore';
import { DEFAULT_FIGURE, parseFigure, type FigureSettings } from '../export/figure';
import { create } from 'zustand';
import { newMetadata, type JsonValue, type ProjectJson, type ProjectMetadata } from './format';

export type SaveStatus = 'saved' | 'pending' | 'error' | 'conflict' | 'recovery';
interface ProjectState {
  metadata: ProjectMetadata;
  extensions: Record<string, JsonValue>;
  precision: number;
  figure: FigureSettings;
  setFigure: (figure: FigureSettings) => void;
  resultsOpen: boolean;
  calculationDetailsOpen: boolean;
  setCalculationDetailsOpen: (open: boolean) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  previousProject: ProjectJson | null;
  previousAction: 'open' | 'new' | null;
  setTitle: (title: string) => void;
  setNotes: (notes: string) => void;
  setPrecision: (precision: number) => void;
  setResultsOpen: (open: boolean) => void;
}

export const createProjectStore = () => create<ProjectState>((set) => ({
  figure: { ...DEFAULT_FIGURE }, setFigure: (figure) => set({ figure: parseFigure(figure) }),
  metadata: newMetadata(), extensions: {}, precision: 6, resultsOpen: false, calculationDetailsOpen: false,
  setCalculationDetailsOpen: (calculationDetailsOpen) => set({ calculationDetailsOpen }),
  saveStatus: 'pending', saveMessage: '', previousProject: null, previousAction: null,
  setTitle: (title) => set((state) => ({ metadata: { ...state.metadata, title: title.slice(0, 120) } })),
  setNotes: (notes) => set((state) => ({ metadata: { ...state.metadata, notes: notes.slice(0, 10000) } })),
  setPrecision: (precision) => set({ precision: Math.max(2, Math.min(10, Math.round(precision))) }),
  setResultsOpen: (resultsOpen) => set({ resultsOpen })
}));

export type ProjectStore = ReturnType<typeof createProjectStore>;
const projectAccess = activeStore(createProjectStore());
export const useProjectStore = projectAccess.hook;
export const getActiveProjectStore = projectAccess.get;
export const selectProjectStore = projectAccess.select;
