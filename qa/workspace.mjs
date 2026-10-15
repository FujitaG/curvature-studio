import { stripVTControlCharacters } from 'node:util';
import { waitForBrowser } from './wait.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
// Container images sometimes set a non-existent shared path.
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5176';
const artifacts = new URL('./artifacts/workspace/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true
});
let serverReady = !server;
let serverOutput = '';
server?.stdout.on('data', (chunk) => { serverOutput = (serverOutput + chunk).slice(-4000); if (stripVTControlCharacters(serverOutput).includes('Local:')) serverReady = true; });
server?.stderr.on('data', (chunk) => { serverOutput = (serverOutput + chunk).slice(-4000); });
let browser;
let page;
const errors = [];
const readDownload = async (download) => {
  let text = '';
  for await (const chunk of await download.createReadStream()) text += chunk.toString('utf8');
  return text;
};
const download = async (label) => {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  return readDownload(await promise);
};
const openProject = (input) => page.getByTestId('project-file-input').setInputFiles({ name: 'test.curvature.json', mimeType: 'application/json', buffer: Buffer.from(typeof input === 'string' ? input : JSON.stringify(input)) });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(`Test server exited: ${serverOutput}`);
    try { if (serverReady && (await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('Local test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Explore curvature.' }).waitFor();
  await page.screenshot({ path: new URL('01-empty.png', artifacts).pathname });
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Cube study 日本語');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('A reproducible comparison\nSource: built-in cube');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => !!document.activeElement.closest('dialog')), 'Dialog focus escaped');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.getByText('Calculation complete.', { exact: true }).waitFor();
  assert.equal(await page.locator('.results-table tbody tr').count(), 12);
  await page.getByRole('searchbox', { name: 'Find an edge' }).fill('v1');
  assert.equal(await page.locator('.results-table tbody tr').count(), 3);
  await page.getByRole('searchbox', { name: 'Find an edge' }).fill('');
  await page.getByRole('button', { name: 'Locate edge e1', exact: true }).click();
  assert.equal(await page.locator('.results-table tr.selected').count(), 1);
  await page.getByLabel('Decimals', { exact: true }).selectOption('8');
  const report = JSON.parse(await download('Download results JSON'));
  assert.equal(report.quotientBonds.length, 12);
  assert(Math.abs(report.quotientBonds[0].kEff - (1 - Math.sqrt(21 / 101))) < 1e-9);
  assert.deepEqual(report.quotientBonds[0].ollivierFrac, [1, 3]);
  assert.equal(report.calculation.laziness, 0.5);
  await page.screenshot({ path: new URL('02-results.png', artifacts).pathname });
  const saved = JSON.parse(await download('Save project'));
  assert.equal(saved.metadata.title, 'Cube study 日本語');
  assert(saved.session.doc.vertices.every((vertex) => vertex.baked3d === true));
  assert.equal(saved.resultsDisplay.precision, 8);
  await page.getByRole('button', { name: 'Close results', exact: true }).click();
  await page.getByRole('button', { name: 'Clear canvas', exact: true }).click();
  await openProject(saved);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 8);
  await openProject({ ...saved, version: 99 });
  await page.getByRole('alert').filter({ hasText: 'Project version 99' }).waitFor();
  assert.equal(await page.locator('[data-vertex-id]').count(), 8, 'Invalid import changed graph');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 8);
  assert.equal(await page.getByRole('textbox', { name: 'Project name' }).inputValue(), saved.metadata.title);
  const restored = JSON.parse(await download('Save project'));
  assert.equal(restored.metadata.notes, saved.metadata.notes);
  assert.deepEqual(restored.session.doc, saved.session.doc);
  // The same topology with different edge IDs must recompute its ID maps.
  const renumbered = structuredClone(saved);
  renumbered.session.doc.edges.forEach((edge) => edge.id += 100);
  renumbered.extensions = { 'org.example.annotations': { labels: ['retain me'] } };
  await openProject(renumbered);
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.getByText('Calculation complete.', { exact: true }).waitFor();
  const csv = await download('Download CSV');
  assert(csv.includes('\n101, ')); assert(!/NaN|Infinity/.test(csv));
  const retained = JSON.parse(await download('Save project'));
  assert.deepEqual(retained.extensions, renumbered.extensions);
  await page.getByRole('button', { name: 'Close results', exact: true }).click();
  // Native dialog traps focus, closes on Escape, and leaves graph selection alone.
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await page.getByRole('dialog', { name: 'Quick guide' }).waitFor();
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => !!document.activeElement.closest('dialog'))); }
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Guide', exact: true }).evaluate((button) => button === document.activeElement), true);
  // Exercise the live 3D camera where WebGL exists; otherwise verify the recovery action.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.__curvatureStudioCapture3d || !!document.querySelector('.webgl-fallback'));
  if (await page.evaluate(() => !!window.__curvatureStudioCapture3d)) {
    const cameraProject = JSON.parse(await download('Save project'));
    cameraProject.session.camera3d.position = [2, 3, 7];
    cameraProject.session.camera3d.target = [0, 0, 0];
    await openProject(cameraProject);
    await waitForBrowser(page, async () => {
      const memory = await import('/src/state/viewMemory.ts');
      const camera = memory.getSavedCamera3d();
      return camera && Math.abs(camera.position[0] - 2) < 1e-6 && Math.abs(camera.position[2] - 7) < 1e-6;
    });
    await page.screenshot({ path: new URL('03-3d.png', artifacts).pathname });
    await page.getByRole('button', { name: '2D', exact: true }).click();
    console.log('3D: live scene and imported camera verified');
  } else {
    await page.getByRole('button', { name: 'Continue in 2D', exact: true }).click();
    await page.waitForSelector('.svg-canvas');
    console.log('3D: WebGL unavailable; fallback and Continue in 2D verified. Live camera check skipped.');
  }
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['Save project', 'Open project', 'Results', 'Guide']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width, `${name} is clipped at ${width}px`);
    }
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Close results', exact: true }).isVisible());
    await page.screenshot({ path: new URL(`04-results-${width}.png`, artifacts).pathname });
    await page.getByRole('button', { name: 'Close results', exact: true }).click();
  }
  // A failed or stopped worker must leave editing and retry available; partial CSV stays disabled.
  const computePage = await (await browser.newContext()).newPage();
  await computePage.route('**/src/math/worker.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => { throw new Error("Injected failure"); };' }));
  await computePage.goto(baseUrl);
  await computePage.getByRole('button', { name: 'Cube', exact: true }).click();
  await computePage.getByText('Calculation failed', { exact: true }).waitFor();
  await computePage.getByRole('button', { name: 'Results', exact: true }).click();
  assert(await computePage.getByRole('button', { name: 'Download CSV', exact: true }).isDisabled());
  await computePage.unroute('**/src/math/worker.ts*');
  await computePage.getByRole('button', { name: 'Retry calculation', exact: true }).click();
  await computePage.getByText('Calculation complete.', { exact: true }).waitFor();
  await computePage.getByRole('button', { name: 'Close results', exact: true }).click();
  await computePage.route('**/src/math/worker.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {};' }));
  await computePage.getByRole('button', { name: 'Clear canvas', exact: true }).click();
  await computePage.getByRole('button', { name: 'K₄', exact: true }).click();
  await computePage.getByRole('button', { name: 'Stop', exact: true }).click();
  await computePage.getByText('Calculation stopped', { exact: true }).waitFor();
  await computePage.unroute('**/src/math/worker.ts*');
  await computePage.getByRole('button', { name: 'Retry', exact: true }).click();
  await computePage.getByRole('button', { name: 'Results', exact: true }).click();
  await computePage.getByText('Calculation complete.', { exact: true }).waitFor();
  // Storage failure is visible without disabling the editor or portable save.
  const isolated = await browser.newContext();
  const unavailable = await isolated.newPage();
  await unavailable.addInitScript(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await unavailable.goto(baseUrl);
  await unavailable.getByRole('button', { name: 'Cube', exact: true }).click();
  await unavailable.getByRole('alert').filter({ hasText: 'Browser autosave' }).waitFor();
  assert.equal(await unavailable.locator('[data-vertex-id]').count(), 8);
  const recoveryContext = await browser.newContext();
  const recovery = await recoveryContext.newPage();
  await recovery.addInitScript(() => { localStorage.setItem('curvature-studio:project:v1', '{damaged original'); });
  await recovery.goto(baseUrl);
  await recovery.getByRole('button', { name: 'Download recovery file', exact: true }).waitFor();
  assert.equal(await recovery.evaluate(() => localStorage.getItem('curvature-studio:project:v1')), '{damaged original');
  assert.deepEqual(errors, [], 'Uncaught browser errors');
  console.log('qa:workspace passed — project round-trip, exports, ID remapping, recovery, keyboard, 3D path, 320/390/768/1440px');
} catch (error) {
  if (page) await page.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
}
