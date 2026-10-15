import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:5191';
const artifacts = new URL('./artifacts/hosting/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force: true });
// HTTP-only assertions and UI operations work on the deployed build too.
// Never import /src modules or read the user's browser profile.
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '5191', '--inspector-port', '0'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: fileURLToPath(new URL('wrangler.log', artifacts)) } });
let output = '', browser, frameServer;
const diagnosticPages = [];
server?.stdout.on('data', c => { output = (output + c).slice(-6000); });
server?.stderr.on('data', c => { output = (output + c).slice(-6000); });
const cube = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
const pair = JSON.parse(readFileSync(new URL('../examples/cube-comparison.curvature-workspace.json', import.meta.url), 'utf8'));
for (const d of pair.documents) {
  d.project = structuredClone(cube); d.project.metadata.id = `hosting-${d.side}`;
  d.project.metadata.title = `Hosting ${d.side} — 試験`; d.project.metadata.notes = `Notes ${d.side} 😀`;
  d.project.extensions = { 'org.example': { side: d.side } };
  delete d.project.session.camera3d;
}
const report = { baseUrl, browser: '', checks: [], threeD: [], recovery: [], securityHeaders: {}, cspViolations: [], securityProbes: [], errors: [] };
async function appContext(options) {
  const context = await browser.newContext(options);
  await context.exposeBinding('recordCspViolation', (_, value) => report.cspViolations.push(value));
  await context.addInitScript(() => document.addEventListener('securitypolicyviolation', e => {
    window.recordCspViolation({ directive: e.effectiveDirective, blockedURI: e.blockedURI, disposition: e.disposition });
  }));
  return context;
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const saved = page => page.waitForFunction(() => /^(Both structures saved in browser|Saved in browser)$/.test(document.querySelector('.save-status')?.textContent ?? ''));
const open = async (page, value) => {
  await page.getByTestId('project-file-input').setInputFiles({ name: 'hosting-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
  await saved(page);
};
const download = async (page, locator, filename) => {
  const event = page.waitForEvent('download'); await locator.click(); const file = await event;
  assert.equal(await file.failure(), null);
  const bytes = readFileSync(await file.path()); writeFileSync(new URL(filename, artifacts), bytes); return bytes;
};
const settle3d = async page => {
  await page.waitForFunction(() => { const s = window.__curvatureStudioRenderStats?.(); return s?.frames > 0 && !s.preview; });
  await page.waitForTimeout(350); await saved(page);
};
try {
  const deadline = Date.now() + 30000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Hosting server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const html = await fetch(baseUrl), text = await html.text();
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.headers.get('cache-control'), /(?:no-cache|must-revalidate)/);
  for (const [header, expected] of Object.entries({
    'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()'
  })) { assert.equal(html.headers.get(header), expected); report.securityHeaders[header] = expected; }
  const csp = html.headers.get('content-security-policy'); assert(csp, 'Enforced CSP required');
  const directives = Object.fromEntries(csp.split(';').map(v => v.trim().split(/\s+/)).filter(v => v[0]).map(([key, ...values]) => [key, values.join(' ')]));
  for (const [key, value] of Object.entries({ 'default-src': "'none'", 'script-src': "'self'", 'script-src-attr': "'none'", 'worker-src': "'self'", 'object-src': "'none'", 'base-uri': "'none'", 'form-action': "'none'", 'frame-ancestors': "'none'" })) assert.equal(directives[key], value);
  report.securityHeaders['content-security-policy'] = csp;
  const entry = text.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]; assert(entry);
  const js = await fetch(new URL(entry, baseUrl)); assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(js.headers.get('cache-control'), /max-age=31536000.*immutable/);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(js.headers.get('content-security-policy'), csp);
  const missing = await fetch(`${baseUrl}/assets/absent-test-chunk.js`);
  assert.equal(missing.status, 404, 'Missing JS must not be replaced with HTML');
  report.checks.push('HTML revalidates; hashed JS is immutable with correct MIME; missing JS is 404');
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' }); report.browser = browser.version();
  const context = await appContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  diagnosticPages.push(page);
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Explore curvature.' }).waitFor();
  await button(page, 'Cube').click(); await saved(page);
  await button(page, 'Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor();
  const results = JSON.parse(await download(page, button(page, 'Download results JSON'), 'cube-results.json'));
  assert.equal(results.quotientBonds.length, 12);
  for (const edge of results.quotientBonds) { assert.deepEqual(edge.ollivierFrac, [1,3]); assert(Math.abs(edge.kEff - (1 - Math.sqrt(21/101))) < 1e-9); }
  await button(page, 'Close results').click();
  await button(page, 'Guide').click();
  await page.getByRole('heading', { name: 'Move to another browser or site address' }).waitFor();
  await page.keyboard.press('Escape');
  const project = JSON.parse(await download(page, button(page, 'Save project'), 'single.json'));
  await page.reload(); await saved(page);
  const afterReload = JSON.parse(await download(page, button(page, 'Save project'), 'single-reloaded.json'));
  assert.deepEqual(afterReload.session.doc, project.session.doc);
  report.checks.push('Browser Worker Cube values; real project download/reload; migration guide');

  // data: SVG preview and blob: rasterization must work under the real response CSP.
  await button(page, 'Save & export').click();
  await page.getByRole('button', { name: /^Figure setup \(2D\)/ }).click();
  await page.getByAltText('Figure export preview').evaluate(async image => { await image.decode(); if (!image.naturalWidth) throw new Error('Blank preview'); });
  const figure = await download(page, button(page, 'Download figure PNG'), 'figure-2d.png');
  const figurePixels = await page.evaluate(async url => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i+3] && Math.min(data[i], data[i+1], data[i+2]) < 230) ink++;
    return { width: image.width, height: image.height, ink };
  }, `data:image/png;base64,${figure.toString('base64')}`);
  assert(figurePixels.ink > 100); report.figure2d = figurePixels;
  await button(page, 'Close Figure setup (2D)').click();

  for (const projection of ['perspective', 'orthographic']) for (const side of ['A','B']) {
    const input = structuredClone(pair); input.view = '3d'; input.mode = 'compare'; input.projection = projection;
    input.activeId = input.documents.find(d => d.side === side).id;
    for (const d of input.documents) { d.project.session.view = '3d'; d.project.session.projection = projection; }
    await open(page, input); await settle3d(page); await button(page, 'Fit both').click(); await settle3d(page);
    const before = JSON.parse(await download(page, button(page, 'Save comparison (A + B)'), `${projection}-${side}-before.json`));
    await open(page, before); await settle3d(page); // same IDs; no page reload or 2D toggle
    await button(page, 'Results').click(); await button(page, 'Locate edge e1').click(); await settle3d(page);
    const camera = await page.evaluate(() => JSON.parse(JSON.stringify(window.__curvatureStudioRenderStats(true).camera)));
    const after = JSON.parse(await download(page, button(page, 'Save comparison (A + B)'), `${projection}-${side}-after.json`));
    assert.deepEqual(after.documents.find(d => d.side === side).project.session.camera3d, camera);
    for (const d of after.documents) {
      assert.deepEqual(d.project.session.doc, before.documents.find(o => o.side === d.side).project.session.doc);
      assert(d.project.session.doc.edges.every(e => e.weight === 1));
    }
    await button(page, 'Save & export').click();
    const svg = await download(page, page.getByRole('button', { name: /^SVG \(vector\)/ }), `${projection}-${side}.svg`);
    assert.equal((svg.toString().match(/<circle /g) ?? []).length, 8);
    await button(page, 'Save & export').click();
    const png = await download(page, page.getByRole('button', { name: /^PNG \(2×\)/ }), `${projection}-${side}.png`);
    const pixels = await page.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode();
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(image,0,0);
      const data = ctx.getImageData(0,0,c.width,c.height).data; let ink = 0;
      for (let i=0;i<data.length;i+=4) if (data[i+3] && Math.min(data[i],data[i+1],data[i+2]) < 230) ink++;
      return { width:c.width,height:c.height,ink };
    }, `data:image/png;base64,${png.toString('base64')}`);
    assert(pixels.ink > 100, 'Blank 3D PNG'); report.threeD.push({ projection, side, pixels });
  }
  await context.close();
  report.checks.push('Real WebGL: same-ID A/B reopen, Locate, saved camera, SVG and nonblank PNG in both projections');

  // A real failing dynamic import, not just a dispatched test event.
  for (const paired of [false,true]) {
    const c = await appContext({ viewport: { width: paired ? 390 : 1280, height: 844 } });
    const p = await c.newPage(); const expectedErrors = []; p.on('pageerror', e => expectedErrors.push(e.message));
    diagnosticPages.push(p);
    await p.goto(baseUrl);
    const input = paired ? structuredClone(pair) : structuredClone(cube);
    if (paired) { input.mode = 'single'; input.view = '2d'; input.activeId = input.documents[0].id; }
    await open(p,input);
    const name = `Recent edit ${paired ? 'pair' : 'single'} 日本語`;
    await p.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    // Block the serializer too: emergency recovery must need no fresh Worker asset.
    await p.route('**/assets/serialize.worker-*.js', route => route.abort());
    await p.route('**/assets/DisplaySettingsPanel-*.js', route => route.fulfill({ status:404, contentType:'text/plain',body:'Test: old chunk unavailable' }));
    await button(p, 'Display settings').click();
    await p.getByRole('heading', { name:'A feature could not be loaded' }).waitFor();
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'recovery-heading');
    const raw = await download(p,button(p,'Download recovery file'),`recovery-${paired}.json`), file = JSON.parse(raw);
    const captured = paired ? file.documents.find(d => d.id === file.activeId).project : file;
    assert.equal(captured.metadata.title,name); assert.deepEqual(captured.session.doc,cube.session.doc);
    if (paired) {
      assert.equal(file.mode,'single'); assert.equal(file.documents.length,2);
      assert.deepEqual(file.documents[1].project.session.doc,input.documents[1].project.session.doc);
      assert.equal(file.documents[1].project.metadata.notes,input.documents[1].project.metadata.notes);
    }
    await p.screenshot({ path:new URL(`recovery-${paired}.png`,artifacts).pathname });
    await p.waitForTimeout(500); assert(await button(p,'Download recovery file').isVisible(), 'App must not reload automatically');
    await p.unrouteAll(); await button(p,'Reload app').click();
    await p.getByTestId('project-file-input').waitFor({ state:'attached' }); await open(p,file);
    assert.equal(await p.getByRole('textbox',{name:'Project name',exact:true}).inputValue(),name);
    if (paired) {
      const restored = JSON.parse(await download(p,button(p,'Save comparison (A + B)'), 'recovery-pair-reopened.json'));
      assert.deepEqual(restored.documents.map(d=>d.project.session.doc),file.documents.map(d=>d.project.session.doc));
    }
    assert(expectedErrors.every(message=>/import|module|fetch|load/i.test(message)), JSON.stringify(expectedErrors));
    report.recovery.push({ paired, expectedErrors, bytes:raw.length }); await c.close();
  }
  report.checks.push('Failed lazy imports preserve single and hidden-B projects without a serializer Worker; real recovery file reopens');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.cspViolations, [], 'Normal operations must not violate CSP');
  // Separate negative controls: header strings alone do not prove browser enforcement.
  const probeContext = await browser.newContext();
  const probe = await probeContext.newPage();
  await probe.goto(baseUrl); await probe.getByRole('heading', { name: 'Explore curvature.' }).waitFor();
  // DevTools evaluation itself bypasses eval CSP. Execute that probe as a normal
  // same-origin script (served only to this isolated browser by Playwright).
  await probe.route(`${baseUrl}/qa-csp-eval-probe.js`, route => route.fulfill({ contentType: 'text/javascript', body: "try { window.eval('window.evalProbeExecuted = true'); } catch {} window.evalProbeDone = true;" }));
  await probe.evaluate(() => {
    window.securityProbe = { violations: [] };
    document.addEventListener('securitypolicyviolation', e => window.securityProbe.violations.push(e.effectiveDirective));
    const script = document.createElement('script'); script.textContent = 'window.inlineProbeExecuted = true'; document.body.append(script);
    const btn = document.createElement('button'); btn.setAttribute('onclick', 'window.handlerProbeExecuted = true'); document.body.append(btn); btn.click();
    const evalProbe = document.createElement('script'); evalProbe.src = '/qa-csp-eval-probe.js'; document.body.append(evalProbe);
  });
  await probe.waitForFunction(() => window.evalProbeDone && window.securityProbe.violations.length >= 3);
  const blocked = await probe.evaluate(() => ({ ...window.securityProbe, executed: !!(window.inlineProbeExecuted || window.handlerProbeExecuted || window.evalProbeExecuted) }));
  assert.equal(blocked.executed, false); assert(blocked.violations.includes('script-src-elem')); assert(blocked.violations.includes('script-src-attr'));
  report.securityProbes.push({ inlineScriptAndHandlerAndEval: blocked });
  // Serve a real loopback parent: synthetic route.fulfill documents can be
  // stopped by Chromium Local Network Access before frame-ancestors is tested.
  frameServer = createServer((_, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<iframe src="${baseUrl}/"></iframe>`);
  });
  await new Promise(resolve => frameServer.listen(0, '127.0.0.1', resolve));
  const parent = await probeContext.newPage(); const frameErrors = [];
  parent.on('console', m => { if (/frame-ancestors|X-Frame-Options/i.test(m.text())) frameErrors.push(m.text()); });
  await parent.goto(`http://127.0.0.1:${frameServer.address().port}`);
  const frameDeadline = Date.now() + 10000;
  while (!frameErrors.length && Date.now() < frameDeadline) await parent.waitForTimeout(100);
  assert(frameErrors.length, 'Browser must reject cross-origin framing');
  assert.equal(await parent.frameLocator('iframe').locator('#root').count(), 0);
  report.securityProbes.push({ crossOriginFrameBlocked: true });
  await probeContext.close();
  writeFileSync(new URL('report.json',artifacts),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  const page = diagnosticPages.findLast(p => !p.isClosed());
  if (page) {
    await page.screenshot({path:new URL('failure.png',artifacts).pathname}).catch(()=>{});
    report.failure = await page.evaluate(() => ({ body:document.body.innerText, canvases:document.querySelectorAll('canvas').length, stats:window.__curvatureStudioRenderStats?.() })).catch(()=>null);
  }
  writeFileSync(new URL('failure.json',artifacts),JSON.stringify({ ...report, error:String(error) },null,2));
  throw error;
} finally {
  await browser?.close();
  if (frameServer) { frameServer.closeAllConnections(); await new Promise(resolve => frameServer.close(resolve)); }
  if (server?.pid) try { process.kill(-server.pid,'SIGTERM'); } catch {}
}
