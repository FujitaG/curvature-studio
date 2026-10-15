import { beforeEach, expect, it } from 'vitest';
import { useStudioStore as studio } from '../store';
import { cloneDoc } from '../history';
import { docFromArrays } from '../persistence';
import { computationKeyForDoc } from '../../math/graph';
import { canvasDocument } from '../documentView';

beforeEach(() => studio.setState({ ...studio.getInitialState() }));

it('retains only changed vertices for 200 moves and restores the entire trajectory', () => {
  const doc = docFromArrays(Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, x: i, y: 0 })), [{ id: 1, a: 1, b: 2, kind: 'bond' }]);
  studio.getState().replaceDoc(doc);
  studio.setState({ historyPast: [] });
  const original = studio.getState().doc;
  const key = computationKeyForDoc(original);
  for (let i = 0; i < 200; i += 1) studio.getState().moveVertices([1], 1, -1);
  expect(original.vertices.get(1)).toEqual({ id: 1, x: 0, y: 0 });
  expect(studio.getState().doc.edges).toBe(original.edges);
  expect(computationKeyForDoc(studio.getState().doc)).toBe(key);
  expect(studio.getState().historyPast.reduce((n, entry) => n + entry.vertices.length + entry.edges.length, 0)).toBe(200);
  for (let i = 199; i >= 0; i -= 1) {
    studio.getState().undo();
    expect(studio.getState().doc.vertices.get(1)?.x).toBe(i);
  }
  expect(studio.getState().doc).toEqual(original);
  for (let i = 0; i < 200; i += 1) studio.getState().redo();
  expect(studio.getState().doc.vertices.get(1)?.x).toBe(200);
});

it('round-trips conversion, 3D movement, grouped erasure and document replacement', () => {
  studio.getState().createEdgeBetweenNewVertices(0, 0, 64, 0, 'bond');
  const states = [cloneDoc(studio.getState().doc)];
  studio.getState().convertEdge(1, 'brace'); states.push(cloneDoc(studio.getState().doc));
  const viewBefore = canvasDocument(studio.getState().doc);
  const p3: [number, number, number] = [1, 2, 3];
  studio.getState().moveVertices3d([{ id: 1, p3 }]); p3[0] = 999;
  expect(studio.getState().doc.vertices.get(1)?.p3).toEqual([1, 2, 3]);
  expect(canvasDocument(studio.getState().doc)).toBe(viewBefore);
  states.push(cloneDoc(studio.getState().doc));
  studio.getState().beginEraseGesture();
  studio.getState().scrubEraseItem({ kind: 'vertex', id: 1 });
  studio.getState().scrubEraseItem({ kind: 'vertex', id: 2 });
  studio.getState().endEraseGesture(); states.push(cloneDoc(studio.getState().doc));
  studio.getState().replaceDoc(docFromArrays([{ id: 50, x: 1, y: 2 }], [])); states.push(cloneDoc(studio.getState().doc));
  for (let i = states.length - 2; i >= 0; i -= 1) { studio.getState().undo(); expect(studio.getState().doc).toEqual(states[i]); }
  for (let i = 1; i < states.length; i += 1) { studio.getState().redo(); expect(studio.getState().doc).toEqual(states[i]); }
  studio.getState().undo(); studio.getState().addVertex(3, 4);
  expect(studio.getState().historyFuture).toHaveLength(0);
});
