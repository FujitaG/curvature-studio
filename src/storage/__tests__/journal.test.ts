import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
beforeEach(()=>{vi.resetModules();localStorage.clear();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>vi.unstubAllGlobals());
it('uses immutable keys and never clears a newer snapshot on an older commit',async()=>{
  const j=await import('../journal');const base={generation:'test',revision:1};
  expect(j.writeJournal(base,1,'old')).toBe(true);const old=j.journals()[0].key;
  expect(j.writeJournal(base,2,'new')).toBe(true);const next=j.journals()[0].key;expect(next).not.toBe(old);
  j.clearCommittedJournal(1);expect(j.journals()).toHaveLength(1);j.deleteJournal(old);expect(j.journals()).toHaveLength(1);
  j.clearCommittedJournal(2);expect(j.journals()).toHaveLength(0);
});
it('does not evict other pages at capacity and explicit delete frees room',async()=>{
  const j=await import('../journal');for(let i=0;i<4;i++)localStorage.setItem(j.JOURNAL_PREFIX+i,JSON.stringify({version:2,raw:'old',generation:'other',baseRevision:1}));
  expect(j.writeJournal({generation:'mine',revision:1},1,'new')).toBe(false);expect(j.journalCapacityAvailable()).toBe(false);
  j.deleteJournal(j.JOURNAL_PREFIX+'0');expect(j.writeJournal({generation:'mine',revision:1},1,'new')).toBe(true);
});
it('rejects an oversized emergency copy while leaving normal autosave independent',async()=>{
  const j=await import('../journal');expect(j.writeJournal({generation:'test',revision:1},1,'x'.repeat(2*1024*1024))).toBe(false);expect(j.journals()).toHaveLength(0);
});
