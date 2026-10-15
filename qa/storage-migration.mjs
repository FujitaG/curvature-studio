import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
// Optional legacy integration check; the old build is not redistributed here.
const baseline=process.env.QA_BASELINE_DIST;
assert(baseline, 'qa:storage-migration requires QA_BASELINE_DIST pointing to an independently supplied 0.5.7 (d054305) dist directory. See CONTRIBUTING.md.');
assert(existsSync(resolve(baseline,'index.html')), 'QA_BASELINE_DIST must contain the 0.5.7 baseline index.html.');
const base='http://127.0.0.1:5198', artifacts=new URL('./artifacts/storage-migration/',import.meta.url);
mkdirSync(artifacts,{recursive:true});
const server=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5198','--strictPort'],{cwd:new URL('..',import.meta.url),stdio:'pipe',detached:true});
let log='',browser;server.stdout.on('data',c=>log+=c);server.stderr.on('data',c=>log+=c);
const results=[];
try{
  const deadline=Date.now()+20000;while(true){try{if((await fetch(base)).ok)break;}catch{}if(Date.now()>deadline)throw Error(log);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});
  for(const kind of ['project','comparison']){
    const context=await browser.newContext(),old=await context.newPage();
    await old.route(`${base}/**`,async route=>{
      const pathname=new URL(route.request().url()).pathname;
      const file=resolve(baseline,pathname==='/'?'index.html':pathname.slice(1));
      if(!file.startsWith(resolve(baseline)+'/')||!existsSync(file)){await route.fulfill({status:404,body:''});return;}
      const type={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'}[extname(file)]??'application/octet-stream';
      await route.fulfill({contentType:type,body:readFileSync(file)});
    });
    await old.goto(base);await old.getByRole('button',{name:'Cube',exact:true}).click();
    await old.getByRole('textbox',{name:'Project name',exact:true}).fill('Legacy work 日本語');
    await old.waitForFunction(()=>document.querySelector('.save-status')?.textContent==='Saved in browser');
    if(kind==='comparison'){
      await old.getByRole('button',{name:'Compare',exact:true}).click();await old.getByRole('textbox',{name:'Project name',exact:true}).fill('Legacy B');
      await old.waitForFunction(()=>document.querySelector('.save-status')?.textContent==='Both structures saved in browser');
    }
    const page=await context.newPage();await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('.save-status')?.textContent?.toLowerCase().includes('saved in browser'));
    const record=await page.evaluate(async()=>await (await import('/src/storage/current.ts')).currentDatabase.read());
    assert.equal(record.kind,kind);const parsed=JSON.parse(record.raw);
    if(kind==='project')assert.equal(parsed.metadata.title,'Legacy work 日本語');else assert.equal(parsed.documents.length,2);
    const before=record.generation;
    await old.getByRole('textbox',{name:'Project name',exact:true}).fill('Old tab edited after migration');
    if(kind==='project'){
      await old.waitForFunction(()=>document.querySelector('.save-status')?.textContent==='Saved in browser');
      await page.getByText(/An older tab changed legacy autosave/).waitFor();
      const fresh=await page.evaluate(async()=>await (await import('/src/storage/current.ts')).currentDatabase.read());
      assert.equal(fresh.generation,before);assert.equal(JSON.parse(fresh.raw).metadata.title,'Legacy work 日本語');
      await page.reload();await page.getByText(/An older tab changed legacy autosave/).waitFor();
      assert.equal(await page.getByRole('textbox',{name:'Project name',exact:true}).inputValue(),'Legacy work 日本語');
    }else{
      await old.getByRole('alert').filter({hasText:'Autosave failed'}).waitFor();
      const fresh=await page.evaluate(async()=>await (await import('/src/storage/current.ts')).currentDatabase.read());
      assert.equal(fresh.generation,before);assert(!fresh.raw.includes('Old tab edited after migration'));
    }
    results.push({kind,actualBaseline:'d054305 / 0.5.7',migration:'passed',oldTab:'fenced or offered as recovery'});await context.close();
  }
  writeFileSync(new URL('report.json',artifacts),JSON.stringify({results},null,2));console.log('qa:storage-migration passed',results);
}finally{await browser?.close();if(server.pid)try{process.kill(-server.pid,'SIGTERM');}catch{}}
