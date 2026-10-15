import { stripVTControlCharacters } from 'node:util';
import { waitForBrowser } from './wait.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5177';
const artifacts = new URL('./artifacts/usability/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
let serverReady = !server;
let serverOutput = '';
server?.stdout.on('data', (chunk) => { serverOutput = (serverOutput + chunk).slice(-4000); if (stripVTControlCharacters(serverOutput).includes('Local:')) serverReady = true; });
server?.stderr.on('data', (chunk) => { serverOutput = (serverOutput + chunk).slice(-4000); });
let browser, page;
const errors = [];
const project = () => page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject());
const camera = () => page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { camera: s.camera2d, viewport: s.viewport2d, mode: s.camera2dMode }; });
const vertices = (n) => page.waitForFunction((count) => document.querySelectorAll('[data-vertex-id]').length === count, n);
const button = (name) => page.getByRole('button', { name, exact: true });
const typeValue = async (input, value) => {
  await input.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  for (const key of value) await page.keyboard.type(key);
};
const waitResize = async (width, height = 844) => {
  await page.setViewportSize({ width, height });
  await waitForBrowser(page, async () => {
    const s = (await import('/src/state/store.ts')).useStudioStore.getState();
    const { readGraphViewport } = await import('/src/state/viewport.ts');
    return JSON.stringify(s.viewport2d) === JSON.stringify(readGraphViewport());
  });
  await page.waitForTimeout(100); // Let ResizeObserver settle the wrapped project bar.
};
const visibleGraph = async (width, height) => {
  const boxes = await page.locator('[data-vertex-id]').evaluateAll((items) => items.map((item) => { const b = item.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; }));
  assert(boxes.length, 'No graph to verify');
  assert(await page.locator('[data-vertex-selection-halo]').evaluateAll((rings) => rings.every((ring) => {
    const vertex = document.querySelector(`[data-vertex-id="${ring.getAttribute('data-vertex-selection-halo')}"]`);
    return Math.abs(Number(ring.getAttribute('cx')) - Number(vertex.getAttribute('cx'))) < 0.01 && Math.abs(Number(ring.getAttribute('cy')) - Number(vertex.getAttribute('cy'))) < 0.01;
  })), 'Selection rings drifted away from vertices');
  assert(boxes.every((b) => b.x >= 0 && b.y >= 0 && b.right <= width && b.bottom <= height), `Clipped graph at ${width}px: ${JSON.stringify(boxes)}`);
};
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(`Test server exited: ${serverOutput}`);
    try { if (serverReady && (await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('Test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ja-JP' });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await button('Templates').click();
  const search = page.getByRole('searchbox', { name: 'Search templates' });
  await search.fill('cycle');
  const size = page.getByRole('textbox', { name: 'Cycle size', exact: true });
  await typeValue(size, '12');
  assert.equal(await size.inputValue(), '12', 'Typing 1 then 2 was rewritten');
  await size.press('Enter');
  await vertices(0); // Enter validates; only the explicit placement button adds a graph.
  await button('Add Cycle 12').click();
  await vertices(12);
  await page.getByRole('combobox', { name: 'Placement' }).selectOption('replace');
  for (const n of [3, 12, 128]) {
    await typeValue(size, String(n));
    await size.press('Tab');
    await button(`Replace with Cycle ${n}`).click();
    await vertices(n);
  }
  for (const invalid of ['', '2', '129', '3.5', 'oops']) {
    await typeValue(size, invalid); await size.press('Enter');
    assert.equal(await size.inputValue(), invalid, 'Invalid draft was silently replaced');
    assert.equal(await size.getAttribute('aria-invalid'), 'true');
    await page.getByText('Enter a whole number from 3 to 128.', { exact: true }).waitFor();
    await vertices(128);
    await page.locator('.template-card .template-item').click();
    await vertices(128);
  }
  await typeValue(size, '12'); await size.press('Tab'); await button('Replace with Cycle 12').click(); await vertices(12);
  for (const label of ['Prism', 'Antiprism']) {
    await search.fill(label === 'Prism' ? 'prism-param' : 'antiprism-param');
    const input = page.getByRole('textbox', { name: `${label} size`, exact: true });
    await typeValue(input, '12'); await input.press('Enter');
    assert.equal(await input.inputValue(), '12');
    await button(`Replace with ${label} 12`).click(); await vertices(24);
    await typeValue(input, '64'); await input.press('Tab');
    await button(`Replace with ${label} 64`).click(); await vertices(128);
    await typeValue(input, '65'); await input.press('Enter');
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
  }
  await search.fill('Cube');
  await button('Replace with Cube').click(); await vertices(8);
  const cube = await project();
  await page.getByRole('combobox', { name: 'Placement' }).selectOption('add');
  await search.fill('k4'); await button('Add K4').click(); await vertices(12);
  const combined = await project();
  const added = combined.session.doc.vertices.filter((v) => !cube.session.doc.vertices.some((old) => old.id === v.id));
  assert(Math.min(...added.map((v) => v.x)) > Math.max(...cube.session.doc.vertices.map((v) => v.x)) + 64);
  assert.deepEqual(combined.session.doc.vertices.slice(0, 8), cube.session.doc.vertices);
  await search.fill('');
  await page.getByTestId('recent-templates').waitFor();
  await page.locator('.drawer-header').getByRole('button', { name: 'Close', exact: true }).click();
  await button('Fit view').click();
  for (const width of [390, 320]) {
    await waitResize(width); await visibleGraph(width, 844);
    assert.equal((await camera()).mode, 'fit');
    await page.screenshot({ path: new URL(`fit-${width}.png`, artifacts).pathname });
  }
  await waitResize(1440, 960); await button('Fit view').click();
  await page.mouse.move(700, 430); await page.mouse.wheel(0, -180);
  await waitForBrowser(page, async () => (await import('/src/state/store.ts')).useStudioStore.getState().camera2dMode === 'manual');
  const before = await camera();
  const worldCentre = ({ camera: c, viewport: v }) => [(v.x + v.width / 2 - c.tx) / c.scale, (v.y + v.height / 2 - c.ty) / c.scale];
  await waitResize(390);
  const after = await camera();
  assert.equal(after.camera.scale, before.camera.scale, 'Resize changed manual zoom');
  assert(worldCentre(after).every((n, i) => Math.abs(n - worldCentre(before)[i]) < 1e-6), 'Manual world centre moved');
  await waitResize(1440, 960);
  await page.getByRole('textbox', { name: 'Project name' }).fill('Keep project 日本語');
  await button('Notes').click(); await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Preserve these notes\nSecond line'); await page.keyboard.press('Escape');
  const original = await project();
  await button('Clear canvas').click(); await vertices(0);
  assert.deepEqual((await project()).metadata.id, original.metadata.id);
  assert.equal((await project()).metadata.notes, original.metadata.notes);
  await button('Undo').click(); await vertices(12);
  await button('Menu').click(); await button('New project').click(); await vertices(0);
  const fresh = await project();
  assert.notEqual(fresh.metadata.id, original.metadata.id); assert.equal(fresh.metadata.title, 'Untitled project'); assert.equal(fresh.metadata.notes, '');
  await button('Undo new project').click(); await vertices(12);
  assert.equal((await project()).metadata.id, original.metadata.id); assert.equal((await project()).metadata.notes, original.metadata.notes);
  assert.deepEqual((await project()).session.doc, original.session.doc);
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  // English UI must ignore a legacy Japanese preference and preserve project data.
  await page.evaluate(() => localStorage.setItem('curvature-studio:language', 'ja'));
  await page.reload(); await button('Save project').waitFor(); await vertices(12);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await button('Menu').click();
  assert.equal(await page.getByRole('combobox', { name: 'Language / 言語' }).count(), 0);
  await button('Menu').click();
  assert.equal((await project()).metadata.title, original.metadata.title);
  await button('Guide').click(); await page.getByText('Bond and Brace', { exact: true }).waitFor();
  await button('Add Bond / Brace example').click(); await vertices(15);
  assert.equal((await project()).session.doc.edges.at(-1).kind, 'brace');
  await button('Display settings').click();
  const hex = page.getByRole('textbox', { name: 'Vertex fill hex', exact: true });
  await hex.fill('#FF0000'); await hex.press('Enter');
  await typeValue(hex, 'oops'); await hex.press('Tab');
  assert.equal(await hex.inputValue(), 'OOPS'); assert.equal(await hex.getAttribute('aria-invalid'), 'true');
  assert.equal((await project()).session.style.view2d.vertexFill.color, '#FF0000');
  await page.getByRole('alert').filter({ hasText: '#RRGGBB' }).waitFor();
  for (const width of [390, 320]) {
    await waitResize(width);
    const box = await hex.boundingBox(); assert(box.width >= 90 && box.x >= 0 && box.x + box.width <= width, 'Hex input clipped');
    await hex.evaluate((node) => node.closest('.display-settings-panel').scrollTo(0, 3000));
    const close = await button('Close display settings').boundingBox(); assert(close.y >= 0 && close.y + close.height <= 844, 'Panel close control scrolled out');
    await hex.scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL(`colors-en-${width}.png`, artifacts).pathname });
  }
  await hex.fill('#00AA55'); await hex.press('Enter'); assert.equal(await hex.getAttribute('aria-invalid'), 'false');
  await button('Close display settings').click();
  await button('Save & export').click();
  for (const title of ['Keep your work', 'Analyze results', `Export figure · ${(await project()).metadata.title}`]) await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.getByRole('button', { name: /^Results table & downloads/ }).click();
  await button('Close results').waitFor();
  await page.screenshot({ path: new URL('results-en-320.png', artifacts).pathname });
  await button('Close results').click();
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  await page.reload(); await button('Save project').waitFor(); await vertices(15);
  assert.equal((await project()).metadata.title, original.metadata.title);
  // New 3D cameras are oblique; imported cameras retain their saved orientation.
  const sceneContext = await browser.newContext({ viewport: { width: 1280, height: 960 }, locale: 'en-US' });
  const scenePage = await sceneContext.newPage();
  scenePage.on('pageerror', error => errors.push(error.message));
  await scenePage.goto(baseUrl); await scenePage.getByRole('button', { name: 'Cube', exact: true }).click();
  await scenePage.getByRole('button', { name: '3D', exact: true }).click();
  await scenePage.waitForFunction(() => !!window.__curvatureStudioRenderStats?.() || !!document.querySelector('.webgl-fallback'));
  const webglAvailable = await scenePage.evaluate(() => !!window.__curvatureStudioRenderStats?.());
  if (webglAvailable) {
    await scenePage.getByRole('button', { name: 'Select — V', exact: true }).click();
    await scenePage.getByRole('button', { name: 'Collapse interaction guide', exact: true }).waitFor();
    await scenePage.getByRole('region', { name: 'Interaction guide', exact: true }).getByText('Select: drag vertices to move them. Drag empty space to rotate.', { exact: true }).waitFor();
    const saved = await scenePage.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject());
    const c = saved.session.camera3d;
    assert(Math.abs(c.position[0] - c.target[0]) > 0.1 && Math.abs(c.position[1] - c.target[1]) > 0.1, 'Initial camera is frontal');
    await scenePage.screenshot({ path: new URL('cube-3d.png', artifacts).pathname });
    saved.session.camera3d.position = [2, 3, 7]; saved.session.camera3d.target = [0, 0, 0];
    await scenePage.getByTestId('project-file-input').setInputFiles({ name: 'camera.curvature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await waitForBrowser(scenePage, async () => Math.abs((await import('/src/state/viewMemory.ts')).getSavedCamera3d().position[0] - 2) < 1e-6);
    await scenePage.getByRole('button', { name: 'Hide interaction guide', exact: true }).click();
    await scenePage.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
    await scenePage.reload();
    await waitForBrowser(scenePage, async () => !!window.__curvatureStudioRenderStats?.() && Math.abs((await import('/src/state/viewMemory.ts')).getSavedCamera3d().position[0] - 2) < 1e-6);
    assert.equal(await scenePage.locator('.interaction-guide').count(), 0);
    await scenePage.getByRole('button', { name: 'Panels', exact: true }).click();
    await scenePage.getByRole('checkbox', { name: 'Interaction guide', exact: true }).check();
    await scenePage.keyboard.press('Escape');
    await scenePage.getByRole('region', { name: 'Interaction guide', exact: true }).waitFor();
    console.log('3D: current guide, hide/restore, oblique initial view, and saved camera across reload verified');
  } else {
    assert.notEqual(process.env.QA_REQUIRE_WEBGL, '1', 'WebGL required for the usability camera checks');
    console.log('3D: no WebGL in this environment; live camera tests skipped');
  }
  const fallbackContext = await browser.newContext({ locale: 'en-US' });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args); };
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  });
  await fallbackPage.goto(baseUrl); await fallbackPage.getByRole('button', { name: 'Cube', exact: true }).click();
  await fallbackPage.getByRole('button', { name: 'Clear canvas', exact: true }).click();
  await fallbackPage.getByText('Canvas cleared — press ⌘Z to restore', { exact: true }).waitFor();
  await fallbackPage.getByRole('button', { name: 'Undo', exact: true }).click();
  await fallbackPage.getByRole('button', { name: '3D', exact: true }).click();
  await fallbackPage.getByRole('button', { name: 'Continue in 2D', exact: true }).click();
  await fallbackPage.locator('.svg-canvas').waitFor();
  assert.deepEqual(errors, [], 'Uncaught browser errors');
  writeFileSync(new URL('report.json', artifacts), JSON.stringify({ browser: browser.version(), webglAvailable,
    guideAndCamera: webglAvailable ? 'passed' : 'not exercised (WebGL unavailable)', forcedFallback: 'passed', errors }, null, 2));
  console.log('qa:usability passed — real keystrokes, resize visibility, manual zoom, new/clear/Undo, placement/search, English-only UI with legacy Japanese preferences, invalid colors, narrow panels, export navigation, and forced WebGL fallback');
} catch (error) {
  await page?.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
}
