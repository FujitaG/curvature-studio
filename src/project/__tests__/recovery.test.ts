import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import cube from '../../../examples/cube-study.curvature.json';
import { comparisonSession } from '../../comparison/flag';
import { parseWorkspace } from '../../comparison/format';
import { useComparison, enterComparison, showSingle } from '../../comparison/store';
import { createStudioStore, selectStudioStore, getActiveStudioStore } from '../../state/store';
import { createProjectStore, selectProjectStore, getActiveProjectStore } from '../store';
import { applyProject } from '../workspace';
import { parseProjectJson } from '../format';
import { prepareRecoveryFile } from '../recovery';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker asset unavailable'); } });
  for (const d of useComparison.getState().documents) d.stop?.();
  useComparison.setState(useComparison.getInitialState(), true);
  comparisonSession.present = false;
  selectStudioStore(createStudioStore()); selectProjectStore(createProjectStore());
  applyProject(parseProjectJson(cube), false);
});
afterEach(() => vi.unstubAllGlobals());

it('exports recent project edits without network or a serializer Worker', () => {
  getActiveStudioStore().getState().addVertex(42, 17);
  getActiveProjectStore().getState().setNotes('未保存の編集 😀');
  const file = prepareRecoveryFile();
  const restored = parseProjectJson(JSON.parse(file.text));
  expect(file.filename).toBe('recovery.curvature.json');
  expect(restored.session.doc.vertices.size).toBe(9);
  expect(restored.metadata.notes).toBe('未保存の編集 😀');
  expect(getActiveStudioStore().getState().historyPast.length).toBe(1);
});

it('retains edited hidden B and metadata when comparison is in Single mode', () => {
  enterComparison(); const [a,b] = useComparison.getState().documents;
  b.project.getState().setTitle('Hidden B'); b.studio.getState().addVertex(42,17);
  showSingle(a.id);
  const file = prepareRecoveryFile();
  const restored = parseWorkspace(JSON.parse(file.text));
  expect(file.filename).toBe('recovery.curvature-workspace.json');
  expect(restored.mode).toBe('single'); expect(restored.activeId).toBe(a.id);
  expect(restored.documents.map(d => d.project.session.doc.vertices.length)).toEqual([8,9]);
  expect(restored.documents[1].project.metadata.title).toBe('Hidden B');
  expect(b.studio.getState().historyPast.length).toBe(1);
});

it('refuses an invalid recovery file rather than reporting a successful backup', () => {
  getActiveStudioStore().setState({ camera2d: { scale: NaN, tx: 0, ty: 0 } });
  expect(() => prepareRecoveryFile()).toThrow(/camera/i);
});
