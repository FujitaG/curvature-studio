import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { CurrentDatabase, SaveConflict, StaleCandidate } from '../current';
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => vi.unstubAllGlobals());
it('commits content and ownership atomically; two simultaneous endings have one winner', async () => {
  const x = new CurrentDatabase('race'), y = new CurrentDatabase('race');
  const base = await x.migrate(undefined, 'comparison', 'both', 'legacy');
  const results = await Promise.allSettled([x.commit(base, 'project', 'A', true), y.commit(base, 'project', 'B', true)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof x.commit>>>;
  expect(await y.read()).toEqual(winner.value);
  expect(winner.value.generation).not.toBe(base.generation);
  await expect(x.commit(base, 'comparison', 'stale', false)).rejects.toBeInstanceOf(SaveConflict);
  expect(await x.read()).toEqual(winner.value); x.close(); y.close();
});
it('checks a captured job token at write time', async () => {
  const db = new CurrentDatabase('token'), base = await db.migrate(undefined, 'comparison', 'both', 'absent');
  await expect(db.commit(base, 'project', 'A', true, () => false)).rejects.toBeInstanceOf(StaleCandidate);
  expect(await db.read()).toEqual(base); db.close();
});
it('migration CAS cannot overwrite a concurrently initialized workspace', async () => {
  const db = new CurrentDatabase('migration'); const current = await db.migrate(undefined, 'project', 'first', 'hash');
  await expect(db.migrate(undefined, 'project', 'second', 'hash')).rejects.toBeInstanceOf(SaveConflict);
  expect(await db.read()).toEqual(current); expect((await db.inspect()).migration?.legacyFingerprint).toBe('hash'); db.close();
});
it('does not treat a missing migrated current record as a fresh install', async () => {
  const db = new CurrentDatabase('missing'); await db.migrate(undefined, 'project', 'original', 'hash');
  await new Promise<void>((resolve, reject) => { const r = indexedDB.open('missing', 2); r.onsuccess = () => {
    const tx = r.result.transaction('workspaces', 'readwrite'); tx.objectStore('workspaces').delete('current');
    tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onabort = () => reject(tx.error);
  }; });
  await expect(db.read()).rejects.toThrow(/missing or unreadable/); db.close();
});
it('explicit recovery archives unreadable bytes and rejects changes made since inspection', async () => {
  const db=new CurrentDatabase('recover');
  const observed=await db.inspect();
  const restored=await db.replaceObserved(observed,'project','my work','{broken legacy','hash');
  expect(await db.read()).toEqual(restored);
  await expect(db.replaceObserved(observed,'project','stale replacement','old','hash')).rejects.toBeInstanceOf(SaveConflict);
  const records=await new Promise<unknown[]>(resolve=>{const r=indexedDB.open('recover',2);r.onsuccess=()=>{const tx=r.result.transaction('workspaces');const q=tx.objectStore('workspaces').getAll();tx.oncomplete=()=>{r.result.close();resolve(q.result);};};});
  expect(records).toContainEqual({current:undefined,raw:'{broken legacy'});db.close();
});
