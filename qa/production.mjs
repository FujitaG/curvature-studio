import { stripVTControlCharacters } from 'node:util';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:5179';
const artifacts = new URL('./artifacts/production/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5179', '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true
});
let serverOutput = '', browser;
server?.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-4000); });
server?.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-4000); });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(`Preview exited: ${serverOutput}`);
    try { if ((!server || stripVTControlCharacters(serverOutput).includes('Local:')) && (await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Preview did not start: ${serverOutput}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const requests = new Set(), failures = [];
  page.on('request', request => { if (request.url().startsWith(baseUrl)) requests.add(new URL(request.url()).pathname); });
  page.on('response', response => { if (response.url().startsWith(baseUrl) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Explore curvature.' }).waitFor();
  const initialJavaScript = [...requests].filter(path => path.endsWith('.js'));
  assert(initialJavaScript.some(path => /\/index-/.test(path)), 'Production entry was not loaded');
  assert(!initialJavaScript.some(path => /\/(TemplateDrawer|DisplaySettingsPanel|View3D)-/.test(path)), 'Optional features loaded eagerly');

  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.getByText('Calculation complete.', { exact: true }).waitFor();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download results JSON', exact: true }).click();
  let bytes = '';
  for await (const chunk of await (await downloaded).createReadStream()) bytes += chunk.toString('utf8');
  const result = JSON.parse(bytes);
  assert.equal(result.quotientBonds.length, 12);
  assert(result.quotientBonds.every(value => Math.abs(value.kEff - (1 - Math.sqrt(21 / 101))) < 1e-9));
  assert(result.quotientBonds.every(value => value.ollivierFrac[0] === 1 && value.ollivierFrac[1] === 3));
  await page.getByRole('button', { name: 'Close results', exact: true }).click();

  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('icosidodecahedron');
  assert(await page.locator('.template-card').count() > 0, 'Full catalog unavailable');
  await page.getByRole('region', { name: 'Templates' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Display settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Display settings', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close display settings', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.__curvatureStudioCapture3d || !!document.querySelector('.webgl-fallback'));
  const webglAvailable = await page.evaluate(() => !!window.__curvatureStudioCapture3d);
  if (process.env.QA_REQUIRE_WEBGL === '1') assert(webglAvailable, 'Real WebGL is required');
  if (!webglAvailable) await page.getByRole('button', { name: 'Continue in 2D', exact: true }).click();
  const deferredJavaScript = [...requests].filter(path => path.endsWith('.js') && !initialJavaScript.includes(path));
  for (const feature of ['TemplateDrawer', 'DisplaySettingsPanel', 'View3D']) assert(deferredJavaScript.some(path => path.includes(`/${feature}-`)), `${feature} chunk was not requested`);
  assert.deepEqual(failures, []);
  const report = { baseUrl, initialJavaScript, deferredJavaScript, webglAvailable, checks: ['Built assets and Worker load', 'Cube results export', 'Optional features load on demand', 'No asset errors'] };
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log('qa:production passed', JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
