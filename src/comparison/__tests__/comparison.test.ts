import { serializeWorkspace } from '../serialization';
import comparisonExample from '../../../examples/cube-comparison.curvature-workspace.json';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStudioStore, selectStudioStore } from '../../state/store';
import { createProjectStore, selectProjectStore } from '../../project/store';
import { applyProject, captureProject, restorePreviousProject } from '../../project/workspace';
import { parseProjectJson } from '../../project/format';
import { enterComparison, showSingle, useComparison, replaceComparisonDocument, activateDocument, setLocalCamera2d } from '../store';
import { captureComparison, openComparison } from '../persistence';
import { parseWorkspace } from '../format';
import { comparisonDistribution } from '../distribution';
import { comparisonSession } from '../flag';
import { queueComputation } from '../../hooks/computationQueue';
import cube from '../../../examples/cube-study.curvature.json';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  for (const d of useComparison.getState().documents) d.stop?.();
  useComparison.setState(useComparison.getInitialState(), true);
  comparisonSession.present = false;
  selectStudioStore(createStudioStore()); selectProjectStore(createProjectStore());
  applyProject(parseProjectJson(cube), false);
});
afterEach(() => vi.unstubAllGlobals());
it('does not revive a transient calculation dialog after switching documents', () => {
  enterComparison();const [a,b]=useComparison.getState().documents;
  activateDocument(a.id);a.project.getState().setCalculationDetailsOpen(true);
  activateDocument(b.id);expect(a.project.getState().calculationDetailsOpen).toBe(false);
  b.project.getState().setCalculationDetailsOpen(true);activateDocument(a.id);
  expect(b.project.getState().calculationDetailsOpen).toBe(false);
  expect(a.project.getState().calculationDetailsOpen).toBe(false);
});
it('keeps Locate camera changes local even while gesture zoom is linked', () => {
  enterComparison(); const [a, b] = useComparison.getState().documents;
  for (const target of [a, b]) {
    activateDocument(target.id);
    const peer = target === a ? b : a, before = peer.studio.getState().camera2d;
    setLocalCamera2d({ scale: 0.4, tx: 90, ty: 100 });
    expect(peer.studio.getState().camera2d).toBe(before);
    target.studio.getState().setCamera2d({ ...target.studio.getState().camera2d, scale: 0.8 });
    expect(peer.studio.getState().camera2d.scale).toBeCloseTo(before.scale * 2);
  }
});
it('copies into independent histories and keeps both documents across single view', () => {
  enterComparison();const [a,b]=useComparison.getState().documents;
  expect(a.project.getState().metadata.id).not.toBe(b.project.getState().metadata.id);
  b.studio.getState().addVertex(10,20);expect(b.studio.getState().doc.vertices.size).toBe(9);
  expect(a.studio.getState().doc.vertices.size).toBe(8);
  showSingle(a.id);expect(useComparison.getState().activeId).toBe(a.id);
  showSingle(b.id);b.studio.getState().undo();expect(b.studio.getState().doc.vertices.size).toBe(8);
  b.studio.getState().redo();enterComparison();expect(useComparison.getState().documents).toEqual([a,b]);
  expect(b.studio.getState().doc.vertices.size).toBe(9);
});
it('saves both in single mode and rejects malformed B before replacing A', () => {
  enterComparison();const [a,b]=useComparison.getState().documents;b.project.getState().setTitle('研究 B');
  b.studio.getState().addVertex(42,17);showSingle(a.id);
  const saved=captureComparison();expect(saved.documents).toHaveLength(2);expect(saved.mode).toBe('single');
  const invalid=structuredClone(saved);invalid.documents[1].project.version=999 as 1;
  expect(()=>openComparison(invalid)).toThrow();expect(useComparison.getState().documents[0]).toBe(a);
  saved.extensions={'org.example':{version:1,text:'日本語'}};openComparison(saved);
  const restored=captureComparison();expect(restored.documents.map(d=>d.project.session.doc.vertices.length)).toEqual([8,9]);
  expect(restored.extensions).toEqual(saved.extensions);expect(restored.activeId).toBe(a.id);
});
it('restores native palette after shared comparison styling and Undo open', () => {
  enterComparison();const [a,b]=useComparison.getState().documents;
  const native=structuredClone(a.native.shared);
  a.studio.getState().setStyle(s=>({...s,shared:{...s.shared,metricGradients:{...s.shared.metricGradients,keff:{type:'threshold',threshold:.6,width:.1,lowColor:'#000000',highColor:'#FFFFFF'}}}}));
  expect(b.studio.getState().style.shared).toEqual(a.studio.getState().style.shared);
  expect(captureProject(a).session.style.shared).toEqual(native);
  activateDocument(a.id);replaceComparisonDocument(a,cube as never);restorePreviousProject();
  showSingle(a.id);expect(a.studio.getState().style.shared).toEqual(native);
});
it('links zoom ratios but isolates cameras when disabled and on Fit', () => {
  enterComparison();const [a,b]=useComparison.getState().documents;
  const before=b.studio.getState().camera2d.scale;
  a.studio.getState().setCamera2d({...a.studio.getState().camera2d,scale:a.studio.getState().camera2d.scale*1.1});
  expect(b.studio.getState().camera2d.scale).toBeCloseTo(before*1.1);
  useComparison.setState({linked:false});const camera=b.studio.getState().camera2d;
  a.studio.getState().setCamera2d({scale:2,tx:10,ty:20});expect(b.studio.getState().camera2d).toBe(camera);
  useComparison.setState({linked:true});a.studio.getState().fit2d();expect(b.studio.getState().camera2d).toBe(camera);
});
it('uses the same bin boundaries and shared scales with unequal population sizes', () => {
  const values=[Array(100).fill(.5),Array(20).fill(.5)];
  const share=comparisonDistribution(values,'keff','share');expect(share.series[0].heights).toEqual(share.series[1].heights);expect(share.upper).toBe(100);
  const count=comparisonDistribution(values,'keff','count');expect(count.upper).toBe(100);expect(Math.max(...count.series[1].heights)).toBe(20);
  const empty=comparisonDistribution([[],[NaN,Infinity]],'ollivier','share');expect(empty.series.every(s=>s.n===0)).toBe(true);expect(empty.min).toBe(-1);
});
it.each(['activeId','documents','ratio','version'])('rejects an invalid workspace %s', field => {
  enterComparison();const saved=captureComparison();(saved as unknown as Record<string,unknown>)[field]=null;expect(()=>parseWorkspace(saved)).toThrow();
});
it('runs one computation at a time and cancels waiting jobs', async () => {
  const a=createStudioStore(),b=createStudioStore(),calls:string[]=[];let finish=()=>{};
  const stopA=queueComputation(a,done=>{calls.push('a');finish=done;});
  const stopB=queueComputation(b,()=>{calls.push('b');});expect(calls).toEqual(['a']);stopB();finish();await Promise.resolve();expect(calls).toEqual(['a']);stopA();
  let end=()=>{};const stop=queueComputation(b,done=>{calls.push('b2');end=done;});expect(calls).toEqual(['a','b2']);end();stop();
});

it('opens the shipped comparison example and refuses to write unreadable cameras', () => {
  expect(parseWorkspace(comparisonExample).documents).toHaveLength(2);
  enterComparison();const saved=captureComparison();
  const raw=serializeWorkspace(saved);expect(parseWorkspace(JSON.parse(raw)).documents).toHaveLength(2);
  saved.documents[1].project.session.camera2d.scale=NaN;
  expect(()=>serializeWorkspace(saved)).toThrow();
});
it('keeps a downloadable previous-work snapshot when a full comparison replaces it', () => {
  enterComparison();const [a]=useComparison.getState().documents;
  a.project.getState().setNotes('Unsaved research note');
  openComparison(comparisonExample);
  const backup=useComparison.getState().previousImport;
  expect(backup?.format).toBe('curvature-studio/workspace');
  if(backup?.format==='curvature-studio/workspace')expect(backup.documents[0].project.metadata.notes).toBe('Unsaved research note');
});

it('persists label visibility changed during comparison', () => {
  enterComparison(); const [a,b]=useComparison.getState().documents;
  a.studio.getState().toggleLabels();
  expect(captureProject(a).session.labelsVisible).toBe(false);
  expect(captureProject(b).session.labelsVisible).toBe(true);
  showSingle(a.id); expect(a.studio.getState().labelsVisible).toBe(false);
});
