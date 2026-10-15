import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const { version } = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const baseUrl = 'http://127.0.0.1:5190';
const artifacts = new URL('./artifacts/foundation/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force:true });
const server = spawn('npm', ['run','dev','--','--host','127.0.0.1','--port','5190','--strictPort'], { cwd:new URL('..',import.meta.url),stdio:'pipe',detached:true });
let output='',browser;
server.stdout.on('data',c=>output=(output+c).slice(-4000)); server.stderr.on('data',c=>output=(output+c).slice(-4000));
try {
  const deadline=Date.now()+20000;
  while(true) { if(server.exitCode!==null)throw new Error(output);try{if((await fetch(baseUrl)).ok)break;}catch{}if(Date.now()>deadline)throw new Error(output);await new Promise(r=>setTimeout(r,100)); }
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseUrl);
  const button=name=>page.getByRole('button',{name,exact:true});
  await button('Cube').click(); await button('Results').click();
  await page.getByText('Calculation complete.',{exact:true}).waitFor();
  await page.locator('#results-panel').getByRole('button',{name:/Calculation details/}).click();
  const dialog=page.getByRole('dialog',{name:'Calculation details',exact:true});
  await dialog.waitFor(); assert.match(await dialog.innerText(),/upper-side estimate.*not a certified interval/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#results-panel').getByRole('button',{name:/Calculation details/}).evaluate(e=>e===document.activeElement),true);
  const download=async(name,file)=>{const p=page.waitForEvent('download');await button(name).click();let body=Buffer.alloc(0);for await(const chunk of await(await p).createReadStream())body=Buffer.concat([body,chunk]);writeFileSync(new URL(file,artifacts),body);return body;};
  const result=JSON.parse((await download('Download results JSON','results.json')).toString());
  assert.equal(result.applicationVersion,version); assert.equal(result.sampleUnit,'quotient-bond');
  assert(result.quotientBonds.every(v=>v.evidence.ollivier.kind==='exact-rational' && v.evidence.effective.kind==='truncated-sum' && v.evidence.effective.certified===false));
  assert(result.quotientBonds.every(v=>Math.abs(v.kEff-(1-Math.sqrt(21/101)))<1e-9));
  const csv=(await download('Download CSV','results.csv')).toString().trimEnd().split('\n');
  assert(csv.every(line=>line.split(',').length===18)); assert(csv[1].includes('exact-rational, truncated-sum, estimated-tail-tolerance, unverified-floating-point, lower, upper'));
  await button('Close results').click();
  for(const [width,height] of [[1280,900],[390,844],[320,844],[844,390]]) {
    await page.setViewportSize({width,height}); await button('Panels').click();
    await page.getByRole('dialog',{name:'Panels',exact:true}).getByRole('button',{name:'Calculation details',exact:true}).click(); await dialog.waitFor();
    assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
    await page.screenshot({path:new URL(`details-${width}.png`,artifacts).pathname});
    await page.keyboard.press('Escape');assert.equal(await button('Panels').evaluate(e=>e===document.activeElement),true);
  }
  const pair=JSON.parse(readFileSync(new URL('../examples/cube-comparison.curvature-workspace.json',import.meta.url),'utf8'));
  pair.documents[0].project.metadata.title='Foundation A';pair.documents[1].project.metadata.title='Foundation B';
  await page.setViewportSize({width:1084,height:817});
  await page.getByTestId('project-file-input').setInputFiles({name:'pair.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pair))});
  await waitForBrowser(page,async()=>{const c=(await import('/src/comparison/store.ts')).useComparison.getState();return c.documents.length===2 && c.documents.every(d=>!!d.studio.getState().results&&!d.studio.getState().computing);});
  for(const key of ['Home','End']) {
    await page.getByRole('separator',{name:'Resize structure A'}).press(key);
    await page.waitForTimeout(100);
    const controls=await page.locator('.comparison-pane-header .calculation-summary').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect(),p=e.closest('.comparison-pane').getBoundingClientRect();return {label:e.textContent,name:e.getAttribute('aria-label'),height:r.height,width:r.width,inside:r.left>=p.left&&r.right<=p.right};}));
    assert(controls.every(c=>c.name.includes(c.label)&&c.height>=32&&c.width>=24&&c.inside),JSON.stringify(controls));
  }
  await button('Reset split').click();
  for(const side of ['A','B']) {
    await page.getByRole('region',{name:`Structure ${side}`,exact:true}).getByRole('button',{name:new RegExp(`Calculation details for ${side}$`)}).click();
    await dialog.waitFor();assert.match(await dialog.locator('.calculation-project').innerText(),new RegExp(`Foundation ${side}`));
    await page.keyboard.press('Escape');
  }
  // Details are session-only, and must not alter a persisted calculation or view.
  const before=await page.evaluate(async()=>(await import('/src/comparison/persistence.ts')).captureComparison());
  await button('Panels').click();await page.getByRole('dialog',{name:'Panels',exact:true}).getByRole('button',{name:'Calculation details',exact:true}).click();await dialog.waitFor();
  const after=await page.evaluate(async()=>(await import('/src/comparison/persistence.ts')).captureComparison());for(const w of [before,after]) for(const d of w.documents) delete d.project.metadata.updatedAt;
  assert.deepEqual(after,before);
  await waitForBrowser(page,async()=>(await import('/src/comparison/store.ts')).useComparison.getState().saveStatus==='saved');
  await page.reload();await page.locator('.comparison-pane').first().waitFor();assert.equal(await dialog.count(),0);
  // Exercise the actual hook with a corrupt reply from its CURRENT worker job.
  const broken=await browser.newPage();
  await broken.route('**/src/math/worker.ts*',route=>route.fulfill({contentType:'application/javascript',body:'self.onmessage = ({data:m}) => self.postMessage({type:"progress",jobId:m.jobId,inputKey:"wrong-input",fraction:.5});'}));
  await broken.goto(baseUrl);await broken.getByRole('button',{name:'Cube',exact:true}).click();
  await waitForBrowser(broken,async()=>{const s=(await import('/src/state/store.ts')).useStudioStore.getState();return !s.computing&&s.computationError?.includes('different input');});
  await broken.close();
  const wrongJob=await browser.newPage();
  await wrongJob.route('**/src/math/worker.ts*',route=>route.fulfill({contentType:'application/javascript',body:'self.onmessage = ({data:m}) => self.postMessage({type:"progress",jobId:m.jobId+1,inputKey:m.inputKey,fraction:.5});'}));
  await wrongJob.goto(baseUrl);await wrongJob.getByRole('button',{name:'Cube',exact:true}).click();
  await waitForBrowser(wrongJob,async()=>{const s=(await import('/src/state/store.ts')).useStudioStore.getState();return !s.computing&&s.computationError?.includes('unexpected job identity');});
  await wrongJob.close();
  // Reserved scaffolding is not eagerly or lazily bundled in production.
  const assets=new URL('../dist/assets/',import.meta.url);
  const js=readdirSync(assets).filter(f=>f.endsWith('.js')).map(f=>readFileSync(new URL(f,assets),'utf8')).join('\n');
  assert(readFileSync(new URL('../src/math/future/weighted.ts',import.meta.url),'utf8').includes('is reserved but not implemented'));
  for(const marker of ['is reserved but not implemented', 'reserved-not-implemented'])assert(!js.includes(marker));
  assert.deepEqual(errors,[]);
  writeFileSync(new URL('report.json',artifacts),JSON.stringify({version,checks:['Metric-specific evidence, real JSON/CSV downloads','Responsive details and keyboard focus','Active A/B ownership, no persistence mutation','Current-job mismatch stops with error','Reserved solvers excluded from production'],errors},null,2));
  console.log('Foundation QA passed');
} finally { await browser?.close();try{process.kill(-server.pid,'SIGTERM');}catch{} }
