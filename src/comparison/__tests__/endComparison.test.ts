import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
let stop: (() => void) | undefined;
beforeEach(() => { vi.resetModules(); localStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('requestAnimationFrame', () => 0); });
afterEach(() => { stop?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const autosave = await import('../../project/autosave'); await autosave.initializeWorkspace();
  const c = await import('../store'), end = await import('../endComparison');
  stop = autosave.startAutosave(); c.enterComparison();
  return { c, end, db: (await import('../../storage/current')).currentDatabase };
}
it('ends an unsaved new comparison keeping B and its history; next Compare clones B', async () => {
  const { c, end, db } = await setup(); const [a,b] = c.useComparison.getState().documents;
  b.project.getState().setTitle('Keep B'); b.studio.getState().addVertex(10,20);
  const history = b.studio.getState().historyPast, doc = b.studio.getState().doc;
  await end.endComparison(b.id,'current');
  expect((await import('../../state/store')).getActiveStudioStore()).toBe(b.studio);
  expect(b.studio.getState().doc).toBe(doc); expect(b.studio.getState().historyPast).toBe(history);
  expect(c.useComparison.getState().documents).toHaveLength(0);
  const current = (await db.read())!; expect(current.kind).toBe('project'); expect(JSON.parse(current.raw).metadata.title).toBe('Keep B');
  expect(end.useEndComparison.getState().discarded?.side).toBe(a.side);
  c.enterComparison(); expect(end.useEndComparison.getState().discarded).toBeNull();
  expect(c.useComparison.getState().documents.map(d=>d.studio.getState().doc.vertices.size)).toEqual([1,1]);
});
it('does not copy the visible A display when keeping hidden B', async () => {
  const { c, end } = await setup(); const [a,b] = c.useComparison.getState().documents;
  c.showSingle(a.id); b.studio.getState().setMetric('ollivier'); a.studio.getState().setMetric('keff');
  await end.endComparison(b.id,'current'); expect(b.studio.getState().metric).toBe('ollivier');
});
it('changes no graph, appearance, or history when commit fails', async () => {
  const { c, end, db } = await setup(); const state = c.useComparison.getState(), b = state.documents[1];
  const original = b.studio.getState(); const stored = await db.read();
  vi.spyOn(db,'commit').mockRejectedValue(new Error('quota'));
  await expect(end.endComparison(b.id,'current')).rejects.toThrow('quota');
  expect(c.useComparison.getState().documents).toBe(state.documents); expect(b.studio.getState()).toBe(original); expect(await db.read()).toEqual(stored);
  expect(end.useEndComparison.getState().discarded).toBeNull();
});
it('remaps colliding custom palette IDs and references when keeping comparison appearance', async () => {
  const { c, end } = await setup(); const b = c.useComparison.getState().documents[1];
  const first = {id:'same',name:'Original',metric:'keff' as const,stops:[{position:0,color:'#000000'},{position:1,color:'#FFFFFF'}]};
  b.native.custom=[first]; const shared = structuredClone(c.useComparison.getState().colors);
  shared.metricGradients.keff={type:'custom',id:'same'};
  c.useComparison.setState({colors:shared,custom:[{...first,name:'Comparison'}]});
  const p = end.prepareKeptProject(b,'current');
  expect(p.session.customGradients).toHaveLength(2);
  expect(p.session.style.shared.metricGradients.keff).not.toEqual({type:'custom',id:'same'});
  const own=end.prepareKeptProject(b,'own');expect(own.session.customGradients).toEqual([first]);
});
it('refuses to discard while the kept layout is still running', async () => {
  const { c,end }=await setup();const b=c.useComparison.getState().documents[1];b.studio.setState({relax3dRunning:true});
  await expect(end.endComparison(b.id,'current')).rejects.toThrow(/Finish or stop/);expect(c.useComparison.getState().documents).toHaveLength(2);
});
it('drains a delayed comparison serialization before ending; old work cannot resurrect the pair',async()=>{
  const {c,end,db}=await setup();const b=c.useComparison.getState().documents[1];b.project.getState().setTitle('Kept after slow save');
  const persistence=await import('../persistence');const {serializeWorkspace}=await import('../serialization');
  let resolve!: (raw:string)=>void;const gate=new Promise<string>(r=>resolve=r);
  const spy=vi.spyOn(persistence,'serialize').mockImplementationOnce(()=>gate).mockImplementation(async p=>serializeWorkspace(p));
  await vi.waitFor(()=>expect(spy).toHaveBeenCalled(),{timeout:2000});
  const captured=persistence.captureComparison();let finished=false;
  const ending=end.endComparison(b.id,'current').then(()=>{finished=true;});await new Promise(r=>setTimeout(r,20));expect(finished).toBe(false);
  resolve(serializeWorkspace(captured));await ending;
  const record=(await db.read())!;expect(record.kind).toBe('project');expect(JSON.parse(record.raw).metadata.title).toBe('Kept after slow save');
  await new Promise(r=>setTimeout(r,650));expect((await db.read())!.generation).toBe(record.generation);expect((await db.read())!.kind).toBe('project');
});
it('switching the active side does not clear a comparison conflict',async()=>{
  const {c,end}=await setup();const [a,b]=c.useComparison.getState().documents;
  c.activateDocument(a.id);c.useComparison.setState({saveStatus:'conflict'});a.project.setState({saveStatus:'conflict'});c.activateDocument(b.id);
  await expect(end.endComparison(b.id,'own')).rejects.toThrow(/Resolve the autosave conflict/);expect(c.useComparison.getState().documents).toHaveLength(2);
});
