import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
let stop: (() => void) | undefined;
beforeEach(() => { vi.resetModules(); localStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const autosave = await import('../autosave');
  const { useProjectStore: project } = await import('../store');
  const { useStudioStore: studio } = await import('../../state/store');
  const { currentDatabase: db } = await import('../../storage/current');
  return { autosave, project, studio, db };
}
const settle = (project: Awaited<ReturnType<typeof setup>>['project'], status = 'saved') => vi.waitFor(() => expect(project.getState().saveStatus).toBe(status), { timeout: 4000 });
describe('unified autosave reliability', () => {
  it('keeps an in-progress name intact but saves canonical content to IDB', async () => {
    const { autosave, project, db } = await setup(); await autosave.initializeWorkspace(); stop = autosave.startAutosave();
    project.getState().setTitle('My '); await settle(project);
    expect(project.getState().metadata.title).toBe('My ');
    expect(JSON.parse((await db.read())!.raw).metadata.title).toBe('My');
    expect(localStorage.getItem(autosave.PROJECT_AUTOSAVE_KEY)).toBeNull();
  });
  it('journals pending single edits synchronously and clears only after IDB commit', async () => {
    const { autosave, project, studio } = await setup(); await autosave.initializeWorkspace(); stop = autosave.startAutosave();
    project.getState().setNotes('Source and interpretation'); studio.getState().addVertex(13, 24, [1, 2, 3], true);
    window.dispatchEvent(new Event('pagehide'));
    const { journals } = await import('../../storage/journal');
    const snapshot = JSON.parse(journals()[0].journal!.raw);
    expect(snapshot.metadata.notes).toBe('Source and interpretation');
    expect(snapshot.session.doc.vertices[0].baked3d).toBe(true);
    await settle(project); expect(journals()).toHaveLength(0);
  });
  it('keeps edits after transaction failure and supports retry in the same generation', async () => {
    const { autosave, project, studio, db } = await setup(); await autosave.initializeWorkspace(); stop = autosave.startAutosave();
    const write = vi.spyOn(db, 'commit').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
    studio.getState().addVertex(1, 2); await settle(project, 'error'); expect(studio.getState().doc.vertices.size).toBe(1);
    write.mockRestore(); window.dispatchEvent(new Event('curvature-studio:resume-autosave')); await settle(project);
  });
  it('preserves corrupt legacy bytes and does not overwrite them', async () => {
    const { autosave, project, studio, db } = await setup(); localStorage.setItem(autosave.PROJECT_AUTOSAVE_KEY, '{broken original');
    await autosave.initializeWorkspace(); stop = autosave.startAutosave(); studio.getState().addVertex(0, 0);
    window.dispatchEvent(new Event('pagehide'));
    expect(project.getState().saveStatus).toBe('recovery'); expect(autosave.getRecoveryText()).toBe('{broken original');
    expect(localStorage.getItem(autosave.PROJECT_AUTOSAVE_KEY)).toBe('{broken original'); expect(await db.read()).toBeNull();
  });
  it('detects a writer without needing a broadcast event and prevents stale-generation resume', async () => {
    const { autosave, project, db } = await setup(); await autosave.initializeWorkspace(); stop = autosave.startAutosave();
    const old = (await db.read())!, newer = JSON.parse(old.raw); newer.metadata.title = 'Other tab';
    await db.commit(old, 'project', JSON.stringify(newer), true);
    project.getState().setNotes('My unsaved edits'); await settle(project, 'conflict');
    window.dispatchEvent(new Event('curvature-studio:resume-autosave')); await new Promise(r => setTimeout(r, 30));
    expect(project.getState().saveStatus).toBe('conflict'); expect(JSON.parse((await db.read())!.raw).metadata.title).toBe('Other tab');
  });
  it('initializes the UI with an error when IndexedDB is unavailable', async () => {
    const { autosave, project } = await setup(); vi.stubGlobal('indexedDB', undefined);
    await autosave.initializeWorkspace(); expect(project.getState().saveStatus).toBe('error');
  });
  it('keeps saved bytes when the live camera or output size is invalid, and recovers', async () => {
    const { autosave, project, studio, db } = await setup(); await autosave.initializeWorkspace(); stop = autosave.startAutosave();
    const original = (await db.read())!.raw;
    studio.setState({ camera2d: { tx: 1e300, ty: 0, scale: 1 } }); await settle(project, 'error');
    expect((await db.read())!.raw).toBe(original);
    studio.getState().fit2d(); project.setState({ extensions: { payload: 'x'.repeat(8 * 1024 * 1024) } });
    await settle(project, 'error'); expect(project.getState().saveMessage).toContain('8 MiB'); expect((await db.read())!.raw).toBe(original);
    project.setState({ extensions: {} }); await settle(project);
  });
  it('repairs a legacy camera before migrating without changing graph data', async () => {
    const { autosave, project, studio, db } = await setup();
    const { default: example } = await import('../../../examples/cube-study.curvature.json');
    const input = structuredClone(example); input.session.camera2d.tx = 1e300;
    localStorage.setItem(autosave.PROJECT_AUTOSAVE_KEY, JSON.stringify(input)); await autosave.initializeWorkspace();
    expect(studio.getState().doc.vertices.size).toBe(8); expect(project.getState().saveStatus).toBe('saved');
    const saved = JSON.parse((await db.read())!.raw); const { parseProjectJson } = await import('../format');
    expect(() => parseProjectJson(saved, 'test', false)).not.toThrow(); expect(saved.session.doc).toEqual(input.session.doc);
  });
});
it('explicitly replaces corrupt autosave and resumes saving without deleting recovery bytes',async()=>{
  const {autosave,project,studio,db}=await setup();localStorage.setItem(autosave.PROJECT_AUTOSAVE_KEY,'{damaged');
  await autosave.initializeWorkspace();stop=autosave.startAutosave();studio.getState().addVertex(5,6);
  await autosave.replaceUnreadableAutosave();await settle(project);expect(autosave.getRecoveryText()).toBeNull();
  expect(JSON.parse((await db.read())!.raw).session.doc.vertices).toHaveLength(1);
  expect(localStorage.getItem(autosave.PROJECT_AUTOSAVE_KEY)).toBe('{damaged');
  project.getState().setNotes('after recovery');await settle(project);expect(JSON.parse((await db.read())!.raw).metadata.notes).toBe('after recovery');
});
it('offers completed foreign journals for cleanup instead of accumulating them',async()=>{
  const {autosave,db}=await setup();await autosave.initializeWorkspace();const raw=(await db.read())!.raw;
  localStorage.setItem('curvature-studio:recovery-journal:v2:other',JSON.stringify({version:2,generation:'old',baseRevision:1,raw}));
  stop=autosave.startAutosave();window.dispatchEvent(new StorageEvent('storage',{key:'curvature-studio:recovery-journal:v2:other'}));
  await vi.waitFor(()=>expect(localStorage.getItem('curvature-studio:recovery-journal:v2:other')).toBeNull());
});
it('retrying unavailable IDB does not misclassify failure as a cross-tab conflict or disable the emergency copy',async()=>{
  const {autosave,project,studio,db}=await setup();vi.spyOn(db,'inspect').mockRejectedValue(new Error('IDB unavailable'));
  await autosave.initializeWorkspace();stop=autosave.startAutosave();studio.getState().addVertex(1,2);
  window.dispatchEvent(new Event('curvature-studio:resume-autosave'));await settle(project,'error');
  window.dispatchEvent(new Event('pagehide'));expect((await import('../../storage/journal')).journals()).toHaveLength(1);
});
