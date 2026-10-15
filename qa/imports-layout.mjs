import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = 'http://127.0.0.1:5187';
const artifacts = new URL('./artifacts/imports-layout/', import.meta.url); mkdirSync(artifacts,{recursive:true});
rmSync(new URL('report.json',artifacts),{force:true});
const server = spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5187','--strictPort'],{cwd:new URL('..',import.meta.url),stdio:'pipe',detached:true});
let output='',browser,page;const report={startedAt:new Date().toISOString(),errors:[],imports:[],layouts:[],webglChecks:[]};
server.stdout.on('data',b=>output=(output+b).slice(-4000));server.stderr.on('data',b=>output=(output+b).slice(-4000));
const cube=JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json',import.meta.url),'utf8'));
const comparison=JSON.parse(readFileSync(new URL('../examples/cube-comparison.curvature-workspace.json',import.meta.url),'utf8'));
const button=name=>page.getByRole('button',{name,exact:true});
const upload=(input,content,name='bad.json')=>input.setInputFiles({name,mimeType:'application/json',buffer:Buffer.isBuffer(content)?content:Buffer.from(typeof content==='string'?content:JSON.stringify(content))});
const projectInput=()=>page.getByTestId('project-file-input');
const settle=async()=>{await page.waitForFunction(()=>document.querySelector('[data-testid="project-file-input"]').value==='');await page.waitForFunction(()=>!document.querySelector('.computing-chip'));};
const download=async()=>{
 await page.waitForTimeout(650); // Avoid Chromium automatic-download rate limiting in this stress test.
 const [d]=await Promise.all([page.waitForEvent('download'), page.getByRole('button',{name:/^Save (project|comparison \(A \+ B\))$/}).click()]);assert.equal(await d.failure(),null);return JSON.parse(readFileSync(await d.path(),'utf8'));
};
const clean=value=>{const x=structuredClone(value);if(x.metadata)delete x.metadata.updatedAt;if(x.documents)x.documents.forEach(d=>delete d.project.metadata.updatedAt);return x;};
const histories=()=>page.evaluate(async()=>{
 const c=(await import('/src/comparison/store.ts')).useComparison.getState();
 const single=(await import('/src/state/store.ts')).useStudioStore;
 return (c.documents.length?c.documents.map(d=>d.studio):[single]).map(store=>{const s=store.getState();return JSON.stringify({past:s.historyPast,future:s.historyFuture,selection:s.selection,values:s.results?.values},(_,v)=>v instanceof Map?[...v]:v);});
});
const screenshot=name=>page.screenshot({path:new URL(name+'.png',artifacts).pathname});
async function rejected(input,content,expected,name='bad.json',{persist=false,menu=false}={}){
 console.log("Rejecting",name);
 const templateInput = await input.getAttribute("data-testid") === "polyhedron-file-input";
 const before=clean(await download()),history=await histories();
 if(templateInput && !await page.getByRole("region",{name:"Templates",exact:true}).isVisible()) await button("Templates").click();
 if(menu){await button('Menu').click();await page.locator('.compatibility-menu summary').filter({hasText:/^Compatibility formats$/}).click();}
 await upload(input,content,name);
 const alert=page.locator('.file-error').filter({hasText:name});await alert.waitFor();
 const text=await alert.innerText();assert.match(text,expected);assert.match(text,/Your current work has not been changed/);assert(!/Cannot read properties|Unexpected token|TypeError|SyntaxError/.test(text));
 if(persist){await page.waitForTimeout(4500);assert(await alert.isVisible());await screenshot('error-'+report.imports.length);}
 assert.deepEqual(clean(await download()),before,`Saved content changed after ${name}`);assert.deepEqual(await histories(),history,`History/selection/results changed after ${name}`);
 report.imports.push({name,message:text,persistent:persist,savedContentUnchanged:true,historySelectionResultsUnchanged:true});
 if(templateInput && !await page.getByRole('region',{name:'Templates',exact:true}).isVisible())await button('Templates').click();
 await alert.getByRole('button',{name:'Dismiss',exact:true}).click();await alert.waitFor({state:'hidden'});
}
async function checkButtons(selector,label){
 const findings=await page.locator(selector).evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().width>0).flatMap(el=>{
   const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const t=range.getBoundingClientRect();
   const name=el.getAttribute('aria-label')||el.textContent;
   const faults=[];
   if(r.left<-.5||r.right>innerWidth+.5)faults.push('outside viewport');
   if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)faults.push('content overflow');
   if(t.height>0&&(t.top<r.top-1.5||t.bottom>r.bottom+1.5))faults.push('label outside button');
   const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   if(!hit||!el.contains(hit))faults.push('center obscured');
   return faults.length?[{name,faults,box:{x:r.x,y:r.y,w:r.width,h:r.height},text:{x:t.x,y:t.y,w:t.width,h:t.height}}]:[];
 }));
 assert.deepEqual(findings,[],label);return {label,passed:true};
}
try{
 const end=Date.now()+20000;while(true){if(server.exitCode!==null)throw new Error(output);try{if((await fetch(baseUrl)).ok)break;}catch{}if(Date.now()>end)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(baseUrl);
 await upload(projectInput(),cube,'cube.json');await settle();
 await button('Results').click();await button('Locate edge e1').click();await button('Close results').click();
 await button('Convert to Brace').click();await settle();await button('Undo').click();await settle();
 // Keep both Undo and Redo, annotations, and non-default appearance while rejecting files.
 await page.getByRole('textbox',{name:'Project name',exact:true}).fill('Import QA — 保持');
 await button('Notes').click();await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Must retain notes, geometry, styles and history.');await page.keyboard.press('Escape');
 const cases=[['empty.json','',/empty/],['syntax.json','{"metadata":',/not valid JSON/],['null.json','null',/JSON object/],['array.json','[]',/JSON object/],['html.json','<!doctype html>',/not valid JSON/],['binary.json',Buffer.from([0,255,137,80]),/not valid JSON/],['unknown.json',{},/not a supported/],['version.json',{...cube,version:99},/Project version 99/],['wrong-style.json',{format:'curvature-studio/style'},/Import style/],['wrong-polyhedron.json',{format:'curvature-studio/polyhedron'},/Templates → Import polyhedron/]];
 for(const [name,content,expect] of cases)await rejected(projectInput(),content,expect,name,{persist:name==='syntax.json'});
 for(const [name,mutate,expect] of [
  ['vertex-coordinate',x=>x.session.doc.vertices[0].x='bad',/vertices\[0\]/],
  ['vertex-zero-id',x=>x.session.doc.vertices[0].id=0,/positive integer/],
  ['duplicate-vertex',x=>x.session.doc.vertices.push(x.session.doc.vertices[0]),/Duplicate vertex id/],
  ['edge-endpoint',x=>x.session.doc.edges[0].a=999999,/edges\[0\]/],
  ['edge-role',x=>x.session.doc.edges[0].kind='base',/Use bond or brace/],
  ['edge-weight',x=>x.session.doc.edges[0].weight=2,/Edge 1:.*weight/],
  ['calculation',x=>x.calculation.laziness=.25,/calculation/i],
  ['too-many-vertices',x=>x.session.doc.vertices=Array(1001).fill(x.session.doc.vertices[0]),/1,000 vertices/]
 ]){const value=structuredClone(cube);mutate(value);await rejected(projectInput(),value,expect,name+'.json');}
 await rejected(projectInput(),' '.repeat(8*1048576)+JSON.stringify(cube),/exceeds 8 MiB/,'large-project.json');
 await rejected(projectInput(),Buffer.alloc(20*1048576+1,32),/exceeds 20 MiB/,'large-comparison.json');
 // Every compatibility import has a readable, persistent rejection outside its menu.
 for(const [testid,name,expect] of [['document-file-input','document',/not valid JSON/],['style-file-input','style',/not valid JSON/],['session-file-input','session',/not valid JSON/]]){
   await rejected(page.getByTestId(testid),'{',expect,name+'.json',{persist:true,menu:true});
 }
 await rejected(page.getByTestId('style-file-input'),{format:'curvature-studio/style',version:2,style:[],customGradients:[]},/Style file/,'style-array.json');
 await button('Templates').click();
 await rejected(page.getByTestId('polyhedron-file-input'),'{',/not valid JSON/,'broken-poly.json',{persist:true});
 await rejected(page.getByTestId('polyhedron-file-input'),cube,/Use Open project/,'project-as-poly.json');
 await rejected(page.getByTestId('polyhedron-file-input'),'solid mesh\nendsolid mesh',/Unsupported polyhedron text/,'mesh.stl');
 const txt='V0 = (0,0,0)\nV1 = (1,0,0)\nV2 = (0,1,0)\nFaces:\n{0,1,2}\n{0,broken,2}';
 await rejected(page.getByTestId('polyhedron-file-input'),txt,/Invalid face on line 6/,'damaged.txt');
 await page.getByRole('region',{name:'Templates',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
 await button('Redo').click();await settle();assert(await button('Convert to Bond').isVisible());await button('Undo').click();await settle();
 // Corrected input clears errors; a UTF-8 BOM is accepted.
 await upload(projectInput(),'\uFEFF'+JSON.stringify(cube),'corrected.json');await settle();assert.equal(await page.locator('.file-error').count(),0);
 // Compare preserves both sides, even when the invalid structure is hidden.
 await upload(projectInput(),comparison,'comparison.json');await settle();
 for(const side of ['A','B']){
   const broken=structuredClone(comparison);broken.mode='single';broken.activeId=broken.documents.find(d=>d.side!==side).id;broken.documents.find(d=>d.side===side).project.session.doc.edges[0].weight=2;
   await rejected(projectInput(),broken,new RegExp('Structure '+side+':.*weight'),'hidden-'+side+'.json');
 }
 await rejected(page.getByLabel('Open project B',{exact:true}),'null',/JSON object/,'bad-B.json',{persist:true});
 await rejected(page.getByLabel('Open project A',{exact:true}),comparison,/open both structures/,'workspace-in-A.json');
 // Return to an independent single context for responsive layout assertions.
 await page.close();page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(baseUrl);
 await upload(projectInput(),cube,'cube.json');await settle();
 await button('Results').click();await button('Locate edge e1').click();await button('Close results').click();
 for(const [width,height] of [[1440,960],[1280,900],[1181,900],[1180,900],[1100,900],[1024,768],[950,900],[901,900],[900,900],[768,844],[390,844],[320,844],[844,390]]){
   console.log("Layout",width,height);
   await page.setViewportSize({width,height});await page.waitForTimeout(250);
   if(await button('Selection details').isVisible())await button('Selection details').click();
   for(const role of ['Brace','Bond']){
     const action=button('Convert to '+role);await action.scrollIntoViewIfNeeded();
     report.layouts.push(await checkButtons('.inspector-actions button',`${width}x${height} convert to ${role}`));
     await action.click();await settle();
   }
   await screenshot(`inspector-${width}x${height}`);
   report.layouts.push(await checkButtons('.topbar-left button, .topbar-center button, .topbar-right > .tooltip-anchor > button',`${width}x${height} header`));
   for(const name of ['Metric','Panels','Save & export','Menu']){
     await button(name).click();
     const selector=name==='Metric'?'.metric-menu .menu-item':name==='Save & export'?'.export-popover .menu-item':name==='Menu'?'.overflow-menu > .menu-item':'.panels-popover .button';
     const controls=page.locator(selector);
     for(let i=0;i<await controls.count();i++){
       await controls.nth(i).scrollIntoViewIfNeeded();
       const single=await controls.nth(i).evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1,text:el.textContent}));assert(!single.overflow,`${width} ${name} ${JSON.stringify(single)}`);
     }
     await screenshot(`menu-${name.replace(/\W+/g,'-')}-${width}x${height}`);
     await page.keyboard.press('Escape');
   }
   if([1280,1181,901,390,320,844].includes(width)){
     await button('3D').click();
     await page.waitForFunction(()=>!!window.__curvatureStudioRenderStats?.() || !!document.querySelector('.webgl-fallback'));
     const available=await page.evaluate(()=>!!window.__curvatureStudioRenderStats?.());
     report.webglChecks.push({width,height,available});
     if(!available)assert.notEqual(process.env.QA_REQUIRE_WEBGL,'1','WebGL required for imports/layout 3D checks');
     await page.waitForTimeout(200); // The projection toolbar is tested even on the explicit fallback path.
     report.layouts.push(await checkButtons('.topbar-left button, .topbar-center button, .topbar-right > .tooltip-anchor > button', width+'x'+height+' 3D header'));
     await screenshot('header-3d-'+width+'x'+height);await button('2D').click();await page.locator('.svg-canvas').waitFor();
   }
 }
 for(const [width,height] of [[1280,900],[390,844],[320,844],[844,390]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(200);
   await rejected(projectInput(),'{',/not valid JSON/,'invalid-長いファイル名-'+width+'-'.repeat(80)+'.json',{persist:true});
 }
 report.finishedAt=new Date().toISOString();assert.deepEqual(report.errors,[]);writeFileSync(new URL('report.json',artifacts),JSON.stringify(report,null,2));console.log(`qa:imports-layout passed: ${report.imports.length} rejected files, ${report.layouts.length} layout checks, ${await browser.version()}`);
}catch(error){if(page)await screenshot('failure').catch(()=>{});writeFileSync(new URL('failure.json',artifacts),JSON.stringify({...report,failure:String(error)},null,2));throw error;}
finally{await browser?.close();if(server.exitCode===null)process.kill(-server.pid,'SIGTERM');}
