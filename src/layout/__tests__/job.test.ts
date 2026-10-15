import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioStore as studio } from '../../state/store';
import { docFromArrays } from '../../state/persistence';
import type { LayoutMessage } from '../relax3d';

class TestWorker {
  static all: TestWorker[] = [];
  onmessage?: (event: MessageEvent<LayoutMessage>) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.all.push(this); }
  send(data: LayoutMessage) { this.onmessage?.({ data } as MessageEvent<LayoutMessage>); }
}
const original = () => docFromArrays([{ id: 1, x: 0, y: 0, p3: [0, 0, 0] }, { id: 2, x: 64, y: 0, p3: [1, 0, 0] }], [{ id: 1, a: 1, b: 2, kind: 'bond' }]);
const result: LayoutMessage = { type: 'result', positions: [{ id: 1, p3: [0, 1, 0] }, { id: 2, p3: [1, 2, 3] }] };
beforeEach(() => {
  studio.getState().stopRelax3dLayout();
  studio.setState({ ...studio.getInitialState(), doc: original() });
  TestWorker.all = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => { studio.getState().stopRelax3dLayout(); vi.unstubAllGlobals(); });

describe('background layout transaction', () => {
  it('keeps the graph editable while running and commits one reversible operation', () => {
    const before = studio.getState().doc;
    const snapshot = original();
    studio.getState().relax3dLayout();
    expect(studio.getState().relax3dRunning).toBe(true);
    expect(studio.getState().doc).toBe(before);
    const worker = TestWorker.all[0];
    worker.send({ type: 'progress', progress: 0.5 });
    expect(studio.getState().relax3dProgress).toBe(0.5);
    studio.getState().relax3dLayout();
    expect(TestWorker.all).toHaveLength(1);
    studio.getState().setSelection([{ kind: 'vertex', id: 1 }]);
    worker.send(result);
    expect(studio.getState().relax3dRunning).toBe(false);
    expect(studio.getState().historyPast).toHaveLength(1);
    expect(studio.getState().doc.vertices.get(2)!.p3).toEqual([1, 2, 3]);
    expect(before).toEqual(snapshot);
    expect(worker.terminate).toHaveBeenCalledOnce();
    studio.getState().undo();
    expect(studio.getState().doc).toEqual(snapshot);
    studio.getState().redo();
    expect(studio.getState().doc.vertices.get(2)!.p3).toEqual([1, 2, 3]);
  });
  it.each(['stop', 'edit', 'replace'] as const)('discards late results after %s', (action) => {
    studio.getState().relax3dLayout();
    const oldWorker = TestWorker.all[0];
    if (action === 'stop') studio.getState().stopRelax3dLayout();
    if (action === 'edit') studio.getState().moveVertices([1], 2, 3);
    if (action === 'replace') studio.getState().replaceDoc(original());
    const after = studio.getState().doc;
    expect(studio.getState().relax3dRunning).toBe(false);
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    studio.getState().relax3dLayout();
    oldWorker.send(result);
    expect(studio.getState().doc).toBe(after);
    expect(studio.getState().relax3dRunning).toBe(true);
  });
  it('surfaces failure without changing positions or history, and permits retry', () => {
    const before = studio.getState().doc;
    studio.getState().relax3dLayout();
    TestWorker.all[0].send({ type: 'error', message: 'Layout failed' });
    expect(studio.getState().doc).toBe(before);
    expect(studio.getState().historyPast).toHaveLength(0);
    expect(studio.getState().relax3dError).toBe('Layout failed');
    studio.getState().relax3dLayout();
    TestWorker.all[1].send(result);
    expect(studio.getState().relax3dError).toBeNull();
    expect(studio.getState().doc.vertices.get(2)!.p3).toEqual([1, 2, 3]);
  });
});
