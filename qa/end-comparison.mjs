import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const port = 5196, base = `http://127.0.0.1:${port}`, artifacts = new URL('./artifacts/end-comparison/', import.meta.url);
mkdirSync(artifacts, { recursive: true }); rmSync(new URL('report.json', artifacts), { force: true });
const server = spawn('npm', ['run','dev','--','--host','127.0.0.1','--port',String(port),'--strictPort'], { cwd: new URL('..', import.meta.url), stdio:'pipe', detached:true });
let log = '', browser, page; server.stdout.on('data',c=>log+=c); server.stderr.on('data',c=>log+=c);
const errors = [], cases = [];
try {
  const deadline=Date.now()+20000;
  while(true) { try { if((await fetch(base)).ok)break; }catch{} if(Date.now()>deadline)throw Error(log);await new Promise(r=>setTimeout(r,100)); }
  browser=await chromium.launch({headless:true});
  const pair=JSON.parse(readFileSync(new URL('../examples/cube-comparison.curvature-workspace.json',import.meta.url),'utf8'));
  const cube=JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json',import.meta.url),'utf8'));
  for(const d of pair.documents) { d.project=structuredClone(cube); d.project.metadata.id=`end-${d.side}`;d.project.metadata.title=`Cube ${d.side} 日本語`;d.project.extensions={test:d.side};d.camera2dMode='fit'; }
  const saved=()=>page.waitForFunction(()=>document.querySelector('.save-status')?.textContent?.includes('saved in browser') || document.querySelector('.save-status')?.textContent==='Saved in browser');
  const open=async input=>{ await page.getByTestId('project-file-input').setInputFiles({name:'end.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))}); await page.waitForFunction(()=>document.querySelector('[data-testid="project-file-input"]').value==='');await saved(); };
  const download=async name=>{const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name,exact:true}).click()]);assert.equal(await d.failure(),null);return readFileSync(await d.path());};
  const openEnd = async () => {
    assert.equal(await page.locator('.comparison-controls').getByRole('button',{name:'End comparison…',exact:true}).count(),0);
    if (await page.getByRole('button',{name:'Single view',exact:true}).count()) {
      await page.getByRole('button',{name:'Single view',exact:true}).click();
      const choices=page.getByRole('dialog',{name:'Single view options',exact:true});
      const option=choices.getByRole('button',{name:'End comparison…',exact:true});
      await option.scrollIntoViewIfNeeded();
      await page.screenshot({path:new URL(`choices-${cases.length}.png`,artifacts).pathname});
      await option.focus();await page.keyboard.press('Enter');
    } else {
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      await page.getByRole('button',{name:'End comparison…',exact:true}).click();
    }
  };
  for(const [view,side,hidden,width] of [['2d','A',false,1280],['2d','B',false,390],['2d','B',true,320],['3d','A',false,1280],['3d','B',false,1084],['3d','B',true,844]]) {
    const context=await browser.newContext({viewport:{width,height:width===844?390:900}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
    const input=structuredClone(pair);input.view=view;for(const d of input.documents)d.project.session.view=view;input.mode=hidden?'single':'compare';input.activeId=input.documents[0].id;
    await open(input);
    await page.waitForFunction(async view=>{const c=(await import('/src/comparison/store.ts')).useComparison.getState();return c.documents.every(d=>!!d.studio.getState().results&&!d.studio.getState().computing) && (view==='2d' || (await import('/src/view3d/sceneApis.ts')).sceneApis.size>0);},view);
    // Edit through the document API to create a real independent history entry.
    await page.evaluate(async side=>{const c=(await import('/src/comparison/store.ts')).useComparison.getState();const d=c.documents.find(d=>d.side===side);d.studio.getState().addVertex(3,4,[2,2,2],true);window.__kept=d;window.__history=d.studio.getState().historyPast;},side);
    await saved();
    await openEnd();
    const dialog=page.getByRole('dialog',{name:'End comparison',exact:true});
    const id=await page.evaluate(side=>(window.__kept.side===side?window.__kept.id:''),side);
    await dialog.locator(`input[value="${id}"]`).check();
    await page.screenshot({path:new URL(`confirm-${view}-${side}-${width}.png`,artifacts).pathname});
    await dialog.getByRole('button',{name:`Keep ${side} and discard ${side==='A'?'B':'A'}`,exact:true}).click();
    await dialog.waitFor({state:'hidden'});await saved();
    await page.waitForFunction(()=>document.activeElement?.matches('[data-graph-canvas]'));
    assert.equal(await page.locator('.comparison-controls').count(),0);
    assert(await page.evaluate(async()=>{const s=(await import('/src/state/store.ts')).getActiveStudioStore();return s===window.__kept.studio&&s.getState().historyPast===window.__history;}));
    const file=JSON.parse((await download('Save project')).toString());assert.equal(file.format,'curvature-studio/project');assert.equal(file.extensions.test,side);assert.equal(file.session.doc.vertices.length,9);assert.equal(file.session.view,view);
    const other=side==='A'?'B':'A';const discarded=JSON.parse((await download(`Download discarded ${other}`)).toString());assert.equal(discarded.extensions.test,other);assert.equal(discarded.session.doc.vertices.length,8);
    if(view==='3d') {
      await page.waitForFunction(async()=>{const s=(await import('/src/state/store.ts')).getActiveStudioStore();const m=await import('/src/view3d/sceneApis.ts');return m.sceneApis.size===1&&m.sceneApis.has(s);});

      await page.getByRole('button',{name:'Save & export',exact:true}).click();
      const svg=await download(/^SVG \(vector\)/);assert(svg.toString().includes('<svg'));
      await page.getByRole('button',{name:'Save & export',exact:true}).click();const png=await download(/^PNG \(2×\)/);
      const colors=await page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<data.length;i+=4)colors.add(`${data[i]},${data[i+1]},${data[i+2]}`);return colors.size;},`data:image/png;base64,${png.toString('base64')}`);assert(colors>10);writeFileSync(new URL(`${view}-${side}-${width}.png`,artifacts),png);
    }
    await page.reload();await saved();assert.equal(await page.locator('.comparison-controls').count(),0);
    assert.equal((JSON.parse((await download('Save project')).toString())).extensions.test,side);
    await page.getByRole('button',{name:'Compare',exact:true}).click();await page.waitForSelector('.comparison-controls');await saved();
    assert.deepEqual(await page.evaluate(async()=>{const c=(await import('/src/comparison/store.ts')).useComparison.getState();return c.documents.map(d=>d.studio.getState().doc.vertices.size);}),[9,9]);
    assert.equal(await page.getByRole('button',{name:`Download discarded ${other}`,exact:true}).count(),0);
    cases.push({view,side,hidden,width});await context.close();
  }
  // Abort the canonical write: both concrete stores and histories must survive.
  const context=await browser.newContext();page=await context.newPage();await page.goto(base);await open(pair);
  await page.evaluate(async()=>{const db=(await import('/src/storage/current.ts')).currentDatabase;window.__commit=db.commit;db.commit=async()=>{throw Error('Injected storage failure');};window.__docs=(await import('/src/comparison/store.ts')).useComparison.getState().documents;});
  await openEnd();
  await page.getByRole('dialog').getByRole('button',{name:/Keep .* and discard/}).click();await page.getByRole('alert').filter({hasText:'Nothing was discarded'}).waitFor();
  assert(await page.evaluate(async()=>window.__docs===(await import('/src/comparison/store.ts')).useComparison.getState().documents));
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.evaluate(async()=>{(await import('/src/storage/current.ts')).currentDatabase.commit=window.__commit;});
  // A stale tab must not resurrect the comparison after another tab ends it.
  const stale=await context.newPage();await stale.goto(base);await stale.waitForSelector('.comparison-controls');
  await page.reload();await saved();await openEnd();
  await page.getByRole('dialog').getByRole('button',{name:/Keep .* and discard/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await saved();
  await stale.getByRole('alert').filter({hasText:'Another tab changed'}).waitFor();
  await stale.getByRole('button',{name:'Resume with both structures',exact:true}).click();await stale.getByRole('alert').filter({hasText:'replaced'}).waitFor();
  await page.reload();await saved();assert.equal(await page.locator('.comparison-controls').count(),0);
  await context.close();
  // Damaged legacy bytes can be explicitly archived/replaced, never silently lost.
  const recoveryContext=await browser.newContext();page=await recoveryContext.newPage();
  await page.addInitScript(()=>localStorage.setItem('curvature-studio:project:v1','{damaged legacy'));
  await page.goto(base);await page.getByRole('button',{name:'Cube',exact:true}).click();
  assert.equal((await download('Download recovery file')).toString(),'{damaged legacy');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Replace unreadable autosave…',exact:true}).click();await saved();
  const repaired=await page.evaluate(async()=>{const db=(await import('/src/storage/current.ts')).currentDatabase;return await db.read();});
  assert.equal(JSON.parse(repaired.raw).session.doc.vertices.length,8);await recoveryContext.close();
  // Four independent emergency copies remain reachable; explicit deletion frees capacity.
  const journalContext=await browser.newContext();page=await journalContext.newPage();
  await page.addInitScript(raw=>{for(let i=0;i<4;i++)localStorage.setItem('curvature-studio:recovery-journal:v2:fixture-'+i,JSON.stringify({version:2,generation:'older',baseRevision:1,raw}));},JSON.stringify(cube));
  await page.goto(base);await page.getByRole('alert').filter({hasText:'Emergency recovery copies are full'}).waitFor();
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete recovery copy…',exact:true}).first().click();
  await page.waitForFunction(()=>Object.keys(localStorage).filter(k=>k.startsWith('curvature-studio:recovery-journal:v2:')).length===3);
  await page.getByRole('alert').filter({hasText:'Emergency recovery copies are full'}).waitFor({state:'hidden'});
  await journalContext.close();
  assert.deepEqual(errors,[]);writeFileSync(new URL('report.json',artifacts),JSON.stringify({cases,transactionFailure:'passed',staleResume:'passed',corruptRecovery:'passed',journalDeletion:'passed',errors},null,2));console.log('qa:end-comparison passed',cases.length,'UI cases + failure + stale tab');
}catch(e){await page?.screenshot({path:new URL('failure.png',artifacts).pathname}).catch(()=>{});throw e;}
finally{await browser?.close();if(server.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}
