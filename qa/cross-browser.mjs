import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium, firefox, webkit } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5198';
const artifacts = new URL('./artifacts/cross-browser/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '5198', '--inspector-port', '0'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe', env: { ...process.env, WRANGLER_LOG_PATH: new URL('wrangler.log', artifacts).pathname } });
let output = '', browser, page, currentEntry;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, startedAt: new Date().toISOString(), cases: [] };
const button = name => page.getByRole('button', { name, exact: true });
const saved = () => page.getByText('Saved in browser', { exact: true }).waitFor();
async function download(locator, name) {
  const pending = page.waitForEvent('download'); await locator.click(); const file = await pending;
  assert.equal(await file.failure(), null); const bytes = readFileSync(await file.path());
  writeFileSync(new URL(name, artifacts), bytes); return bytes;
}
try {
  const deadline = Date.now() + 30000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(output || 'Wrangler did not start');
    await new Promise(r => setTimeout(r, 150));
  }
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    browser = await engine.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const entry = currentEntry = { name, version: browser.version(), errors: [], csp: [] };
    await context.exposeBinding('recordCsp', (_, data) => { entry.csp.push({ ...data, stage: entry.stage }); });
    await context.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.recordCsp({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber })));
    page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
    entry.stage = 'startup'; await page.goto(baseUrl); await button('Cube').click(); await saved();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Cross-browser 研究'); await page.keyboard.press('Tab'); await saved();
    entry.stage = 'results'; await button('Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor();
    assert.equal(await page.locator('.results-table tbody tr').count(), 12);
    const result = JSON.parse(await download(button('Download results JSON'), `${name}-results.json`));
    assert.equal(result.quotientBonds.length, 12);
    for (const value of result.quotientBonds) { assert.deepEqual(value.ollivierFrac, [1, 3]); assert(Math.abs(value.kEff - (1 - Math.sqrt(21 / 101))) < 1e-9); }
    await page.getByRole('searchbox', { name: 'Find an edge' }).fill('v1');
    assert.equal(await page.locator('.results-table tbody tr').count(), 3); await button('Close results').click();
    entry.stage = 'figure'; await button('Save & export').click(); await page.getByRole('button', { name: /^Figure setup \(2D\)/ }).click();
    await page.getByAltText('Figure export preview').evaluate(async img => { await img.decode(); if (!img.naturalWidth) throw new Error('No preview'); });
    entry.stage = 'png'; const png = await download(button('Download figure PNG'), `${name}-figure.png`);
    entry.figure = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i+3] && Math.min(data[i], data[i+1], data[i+2]) < 230) ink++;
      return { width: image.width, height: image.height, ink };
    }, `data:image/png;base64,${png.toString('base64')}`);
    assert(entry.figure.ink > 100); await button('Close Figure setup (2D)').click();
    entry.stage = 'save'; const project = JSON.parse(await download(button('Save project'), `${name}-project.json`));
    entry.stage = 'reload'; await page.reload(); await saved(); assert.equal(await page.getByRole('textbox', { name: 'Project name', exact: true }).inputValue(), project.metadata.title);
    entry.stage = 'open'; await page.getByTestId('project-file-input').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await saved(); const reopened = JSON.parse(await download(button('Save project'), `${name}-reopened.json`));
    assert.deepEqual(reopened.session.doc, project.session.doc);
    entry.stage = 'narrow'; await page.setViewportSize({ width: 390, height: 844 });
    await button('Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor(); await button('Locate edge e1').click();
    assert.equal(await button('Close results').count(), 0);
    entry.stage = '3d'; await button('3D').click();
    await page.waitForFunction(() => window.__curvatureStudioRenderStats?.()?.frames > 0 || !!document.querySelector('.webgl-fallback'));
    entry.threeD = await page.evaluate(() => window.__curvatureStudioRenderStats?.()?.frames > 0 ? 'rendered' : 'WebGL unavailable: fallback verified');
    // WebKit's Playwright screenshot helper injects an inline style, creating CSP violations.
    // Verify exported PNG pixels above; keep UI screenshots for failure diagnostics only.
    entry.stage = '2d'; await button('2D').click(); await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 8);
    assert.deepEqual(entry.errors, []); assert.deepEqual(entry.csp, []);
    report.cases.push(entry); console.log(`${name}: passed (${entry.threeD})`);
    await context.close(); await browser.close(); browser = null;
  }
  report.finishedAt = new Date().toISOString(); writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ caret: 'initial', path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  writeFileSync(new URL('failure.json', artifacts), JSON.stringify({ ...report, currentEntry, error: String(error) }, null, 2)); throw error;
} finally { await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
