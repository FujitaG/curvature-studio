import type { Doc } from './types';

const canvasDocuments = new WeakMap<Doc, Doc>();

/** A 2D-only projection may reuse its previous document after a pure 3D edit. */
export function canvasDocument(doc: Doc): Doc { return canvasDocuments.get(doc) ?? doc; }
export function inheritCanvasDocument(before: Doc, after: Doc): void { canvasDocuments.set(after, canvasDocument(before)); }
