import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5186';
const artifacts = new URL('./artifacts/comparison/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5186', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
let output = '', browser;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseUrl);
  const button = name => page.getByRole('button', { name, exact: true });
  const type = async (locator, value) => { await locator.click(); await locator.press('ControlOrMeta+A'); await locator.press('Backspace'); await locator.pressSequentially(value); };
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  const capture = () => page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject());
  const open = async project => {
    await page.getByTestId('project-file-input').setInputFiles({ name: 'figure.curvature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
    await waitForBrowser(page, async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return !!s.results && !s.computing; });
    await saved();
  };
  const download = async locator => {
    const event = page.waitForEvent('download'); await locator.click();
    const file = await event; assert.equal(await file.failure(), null); return readFileSync(await file.path());
  };
  const base=JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json',import.meta.url),'utf8'));
  await open(base);
  await button('Compare').click();
  await page.waitForSelector('[data-document-id]');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('[data-document-id]').count(),2);
  await page.screenshot({path:new URL('split.png',artifacts).pathname});
  const snapshot = () => page.evaluate(async () => {
    const c=(await import('/src/comparison/store.ts')).useComparison.getState();
    return {mode:c.mode,active:c.documents.find(d=>d.id===c.activeId)?.side,status:c.saveStatus,ratio:c.ratio, documents:c.documents.map(d=>({side:d.side,title:d.project.getState().metadata.title,vertices:d.studio.getState().doc.vertices.size,edges:d.studio.getState().doc.edges.size,camera:d.studio.getState().camera2d,history:d.studio.getState().historyPast.length}))};
  });
  const savedBoth=()=>page.waitForFunction(()=>document.querySelector('.save-status')?.textContent==='Both structures saved in browser');
  assert.equal((await snapshot()).active,'B');
  await type(page.getByRole('textbox',{name:'Project name',exact:true}),'Variant B');
  await page.getByRole('textbox',{name:'Project name',exact:true}).press('Tab');
  // Real pointer edits in B, independent undo and the first click in inactive A.
  await page.evaluate(async()=>{(await import('/src/state/store.ts')).useStudioStore.getState().setTool('bond');});
  const bCanvas=page.getByRole('region',{name:'Structure B'}).locator('[data-graph-canvas]');
  const box=await bCanvas.boundingBox();
  await page.mouse.click(box.x+60,box.y+60);
  assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,9]);
  await button('Undo').click();
  assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,8]);
  await button('Redo').click();
  assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,9]);
  await page.getByRole('region',{name:'Structure A'}).getByRole('button',{name:'Fit A',exact:true}).click();
  assert.equal((await snapshot()).active,'A');
  assert.equal(await button('Redo').isEnabled(),false);
  // Linked relative zoom preserves each centre; turning it off isolates the peer.
  const zoom=()=>page.evaluate(async()=>{const s=(await import('/src/state/store.ts')).useStudioStore.getState();s.setCamera2d({...s.camera2d,scale:s.camera2d.scale*1.1});});
  const beforeZoom=await snapshot(); await zoom();const afterZoom=await snapshot();
  assert.ok(Math.abs(afterZoom.documents[1].camera.scale/beforeZoom.documents[1].camera.scale-1.1)<1e-8);
  await page.getByRole('checkbox',{name:'Link rotation & zoom'}).uncheck();
  const off=await snapshot();await zoom();assert.deepEqual((await snapshot()).documents[1].camera,off.documents[1].camera);
  await button('Single view').click();
  await page.getByRole('dialog').getByRole('button',{name:/Show B · Variant B/}).click();
  assert.equal((await snapshot()).mode,'single');assert.equal((await snapshot()).active,'B');
  assert.equal(await page.locator('[data-document-id]').count(),1);
  assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,9]);
  await savedBoth();
  const bytes=await download(button('Save comparison (A + B)'));
  const workspace=JSON.parse(bytes.toString());
  assert.equal(workspace.documents.length,2);assert.equal(workspace.mode,'single');
  assert.deepEqual(workspace.documents.map(d=>d.project.session.doc.vertices.length),[8,9]);
  const centres = () => page.evaluate(async()=>{const c=(await import('/src/comparison/persistence.ts')).captureComparison();return c.documents.map(d=>{const v=d.viewport2d,k=d.project.session.camera2d;return [(v.x+v.width/2-k.tx)/k.scale,(v.y+v.height/2-k.ty)/k.scale];});});
  const beforeReloadCentres=await centres();
  await page.reload();await savedBoth();
  const afterReloadCentres=await centres();
  afterReloadCentres.forEach((centre,i)=>centre.forEach((value,j)=>assert.ok(Math.abs(value-beforeReloadCentres[i][j])<1e-6,`Saved camera centre changed on reload: ${JSON.stringify({beforeReloadCentres,afterReloadCentres})}`)));
  assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,9]);
  assert.equal((await snapshot()).active,'B');
  await button('Compare').click();
  assert.equal(await page.locator('[data-document-id]').count(),2);
  assert.equal(await page.locator('[data-distribution-side]').count(),2);
  await page.getByLabel('Distribution scale').selectOption('count');
  const divider=page.getByRole('separator',{name:'Resize structure A'});await divider.focus();await divider.press('ArrowLeft');assert.equal((await snapshot()).ratio,48);
  // Invalid B never partially overwrites either document.
  const invalid=structuredClone(base);invalid.version=999;
  await page.getByLabel('Open project B',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
  await page.getByRole('alert').filter({hasText:/version/i}).waitFor();
  assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,9]);
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();
  for(const viewport of [{width:390,height:844},{width:320,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);await page.waitForTimeout(300);
    await button('Single view').click();await page.getByRole('dialog').getByRole('button',{name:/Show A/}).click();
    assert.equal((await snapshot()).active,'A');
    await page.getByRole('button',{name:/Show B · Variant B \(hidden\)/}).click();assert.equal((await snapshot()).active,'B');
    await button('Compare').click();
    await page.waitForTimeout(200);
    const headerHits=await page.locator('.comparison-pane-header').getByRole('button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {name:b.textContent,clear:b.contains(hit),hit:hit?.outerHTML?.slice(0,200),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};}));
    assert.ok(headerHits.every(hit=>hit.clear),`Pane header controls are covered: ${JSON.stringify(headerHits)}`);
    await page.screenshot({path:new URL(`comparison-${viewport.width}.png`,artifacts).pathname});
  }
  await page.setViewportSize({width:1280,height:900});await savedBoth();
  // A pan must not rebuild both React canvases on every frame.
  const pane=page.getByRole('region',{name:'Structure B'}).locator('[data-graph-canvas]');
  await page.getByRole('region',{name:'Structure B'}).getByRole('button',{name:'Fit B',exact:true}).click();
  const panBox=await pane.boundingBox();await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.down('Space');await page.mouse.move(panBox.x+50,panBox.y+50);await page.mouse.down();
  await page.waitForTimeout(50);const beforeRenders=await page.evaluate(()=>window.__curvatureStudio2dRenderCount);
  const beforePan=await snapshot();await page.mouse.move(panBox.x+90,panBox.y+75,{steps:20});await page.waitForTimeout(40);
  const panRenders=await page.evaluate(()=>window.__curvatureStudio2dRenderCount)-beforeRenders;
  assert.ok(panRenders<=1,`Comparison pan rebuilt React ${panRenders} times`);
  assert.deepEqual((await snapshot()).documents[0].camera,beforePan.documents[0].camera);
  await page.mouse.up();await page.keyboard.up('Space');await savedBoth();
  // Two-tab revision conflict: B's old snapshot must not overwrite A's commit.
  const second=await page.context().newPage();await second.goto(baseUrl);
  await second.waitForSelector('[data-document-id]');
  await second.waitForFunction(()=>document.querySelector('.save-status')?.textContent==='Both structures saved in browser');
  // Reassert this tab after the newly opened tab has saved its viewport normalization.
  await page.evaluate(()=>window.dispatchEvent(new Event('curvature-studio:resume-comparison')));await savedBoth();
  await page.getByRole('textbox',{name:'Project name',exact:true}).fill('First tab title');await savedBoth();
  await second.getByRole('textbox',{name:'Project name',exact:true}).fill('Second tab title');
  await second.getByRole('alert').filter({hasText:'Another tab changed the saved workspace'}).waitFor();
  const record=await page.evaluate(async()=>{const request=indexedDB.open('curvature-studio-workspaces',2);const db=await new Promise(r=>request.onsuccess=()=>r(request.result));return await new Promise(r=>{const q=db.transaction('workspaces').objectStore('workspaces').get('current');q.onsuccess=()=>r(JSON.parse(q.result.raw));});});
  assert.ok(record.documents.some(d=>d.project.metadata.title==='First tab title'));
  assert.ok(!record.documents.some(d=>d.project.metadata.title==='Second tab title'));
  await second.close();
  // Optional real WebGL branch. Do not call fallback a rendering pass.
  await page.evaluate(async()=>{const c=(await import('/src/comparison/store.ts')).useComparison;for(const d of c.getState().documents){d.studio.getState().setTool('select');d.studio.getState().setPanelVisible('histogram',false);d.studio.getState().setPanelVisible('hints',false);}c.setState({linked:true});});
  await button('3D').click();
  await page.waitForFunction(()=>!!document.querySelector('.webgl-fallback') || document.querySelectorAll('.comparison-canvas canvas').length===2);
  const webglAvailable=await page.evaluate(()=>!document.querySelector('.webgl-fallback'));
  if(webglAvailable) {
    await button('Fit both').click();await page.waitForTimeout(700);
    const cameras=()=>page.evaluate(async()=>{const c=(await import('/src/comparison/store.ts')).useComparison.getState();const m=await import('/src/state/viewMemory.ts');return c.documents.map(d=>m.getSavedCamera3d(d.studio));});
    const start=await page.getByRole('region',{name:'Structure A'}).locator('canvas').evaluate(canvas=>{const r=canvas.getBoundingClientRect();for(const y of [r.bottom-35,r.top+35])for(const x of [r.right-35,r.left+90])if([0,20,40].every(dx=>document.elementFromPoint(x-dx,y)===canvas))return {x,y};throw new Error('No clear 3D drag path');});
    const original=await cameras();await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-50,start.y-30,{steps:15});await page.mouse.up();await page.waitForTimeout(700);
    const rotated=await cameras();assert.notDeepEqual(rotated[0].position,original[0].position);assert.notDeepEqual(rotated[1].position,original[1].position);
    await page.getByRole('checkbox',{name:'Link rotation & zoom'}).uncheck();const independent=await cameras();await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-40,start.y-20,{steps:12});await page.mouse.up();await page.waitForTimeout(700);
    assert.deepEqual((await cameras())[1],independent[1]);
    assert.deepEqual((await snapshot()).documents.map(d=>d.vertices),[8,9]);
  } else {assert.notEqual(process.env.QA_REQUIRE_WEBGL,'1','WebGL is required for the paired 3D rotation test');await button('Continue in 2D').first().click();}

  writeFileSync(new URL('report.json',artifacts),JSON.stringify({checks:['independent-edit-undo','explicit-single-choice','hidden-document-retained','download-and-reload','linked-zoom','shared-histograms','split-keyboard','invalid-open','responsive','revision-conflict'],downloadBytes:bytes.length,panRenders,webglAvailable,paired3dRotation:webglAvailable?'passed':'not exercised (WebGL unavailable)',errors},null,2));
  console.log('Comparison QA passed',bytes.length,'bytes');
  assert.deepEqual(errors,[]);
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: new URL('failure.png', artifacts).pathname }); writeFileSync(new URL('failure.html', artifacts), await page.content()); }
  throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
