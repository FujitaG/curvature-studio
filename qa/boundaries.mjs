import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { waitForBrowser } from './wait.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5181';
const artifacts = new URL('./artifacts/boundaries/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true
});
let output = '', browser;
server?.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
server?.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((!server || stripVTControlCharacters(output).includes('Local:')) && (await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Open project', exact: true }).waitFor();
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  const capture = () => page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject());
  const open = async (input, vertices) => {
    await page.getByTestId('project-file-input').setInputFiles({ name: 'boundary.curvature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
    await waitForBrowser(page, async count => (await import('/src/state/store.ts')).useStudioStore.getState().doc.vertices.size === count, vertices);
    await saved();
  };
  const reload = async vertices => {
    await page.reload(); await saved();
    await waitForBrowser(page, async count => (await import('/src/state/store.ts')).useStudioStore.getState().doc.vertices.size === count, vertices);
    assert.equal(await page.getByRole('button', { name: 'Download recovery file' }).count(), 0);
  };
  const download = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    const file = await pending, chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    return { bytes, input: JSON.parse(bytes.toString('utf8')) };
  };
  const high = Number.MAX_SAFE_INTEGER - 1;
  await open({ format: 'curvature-studio/doc', version: 1, vertices: [{ id: high, x: 0, y: 0 }], edges: [] }, 1);
  await page.evaluate(async () => {
    const state = (await import('/src/state/store.ts')).useStudioStore.getState();
    for (let i = 0; i < 3; i++) state.addVertex(50 * (i + 1), 50);
  });
  await saved();
  const ids = (await capture()).session.doc.vertices.map(v => v.id);
  assert.equal(new Set(ids).size, 4); assert(ids.includes(high)); assert(ids.every(Number.isSafeInteger));
  await reload(4);
  await open((await download()).input, 4);

  for (const sign of [-1, 1]) {
    await open({ format: 'curvature-studio/doc', version: 1, vertices: [{ id: 1, x: sign * 1e6, y: 0 }], edges: [] }, 1);
    assert(Math.abs((await capture()).session.camera2d.tx) > 1e6);
    await reload(1);
    await page.mouse.move(500, 450); await page.mouse.wheel(0, 120);
    await saved(); await open((await download()).input, 1); await reload(1);
  }
  const example = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
  await open({ ...example, extensions: { values: Array(1000000).fill(0), note: '日本語は保存されます' } }, 8);
  const large = await download();
  assert(large.bytes.length < 8 * 1024 * 1024);
  assert.equal(large.input.extensions.values.length, 1000000);
  assert(large.input.extensions.values.every(value => value === 0));
  assert.equal(large.input.extensions.note, '日本語は保存されます');
  await open(large.input, 8); await reload(8);
  await open(example, 8);

  // Camera repair must recover the graph without exposing the generic corruption UI.
  await open({ ...example, session: { ...example.session, camera2d: { tx: 1e300, ty: 0, scale: 1 } } }, 8);
  await page.getByText('The saved 2D view was invalid and has been fitted to the graph. Your graph is intact.', { exact: true }).waitFor();
  await reload(8);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.__curvatureStudioRenderStats || !!document.querySelector('.webgl-fallback'));
  const webglAvailable = await page.evaluate(() => !!window.__curvatureStudioRenderStats);
  // The toolbar still renders in the 3D fallback, so width checks do not need WebGL.
  for (const [width, height] of [[390, 844], [320, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(120);
    const controls = await page.locator('.topbar-center button').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return { text: node.textContent, x: box.x, right: box.right, y: box.y, bottom: box.bottom };
    }));
    assert(controls.every(box => box.x >= 0 && box.right <= width && box.y >= 0 && box.bottom <= height), `Clipped 3D controls: ${JSON.stringify(controls)}`);
    // Allow future longer labels: wrapping must keep the complete control group inside.
    if (width === 390) {
      await page.locator('.projection-toggle button').evaluateAll(nodes => nodes.forEach((node, i) => { node.textContent = i ? 'Orthographic view' : 'Perspective view'; }));
      await page.waitForTimeout(120);
      assert(await page.locator('.topbar-center button').evaluateAll(nodes => nodes.every(node => { const box = node.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth; })));
      await page.locator('.projection-toggle button').evaluateAll(nodes => nodes.forEach((node, i) => { node.textContent = i ? 'Ortho' : 'Persp'; }));
    }
    await page.screenshot({ path: new URL(`toolbar-${width}x${height}.png`, artifacts).pathname });
  }
  for (const view of webglAvailable ? ['3D', '2D'] : ['2D']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.locator('.view-pane.active [data-graph-canvas]').waitFor();
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    const edge = page.getByRole('button', { name: 'Locate edge e1', exact: true });
    await edge.focus(); await edge.press('Enter');
    await page.getByRole('button', { name: 'Close results', exact: true }).waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => document.activeElement?.matches('.view-pane.active [data-graph-canvas]')));
    assert.deepEqual(await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().selection), [{ kind: 'edge', id: 1 }]);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.locator('#results-panel').evaluate(node => node.scrollTop = node.scrollHeight);
  const close = await page.getByRole('button', { name: 'Close results', exact: true }).boundingBox();
  assert(close.y >= 0 && close.y + close.height <= 390, 'Close results was scrolled out of the short viewport');
  assert.equal(await page.locator('.tool-hint:visible').count(), 0);
  assert.deepEqual(errors, []);
  const report = { browser: browser.version(), retainedIds: ids, compactDownloadBytes: large.bytes.length, webglAvailable,
    checks: ['High IDs → edit → download/open → reload', 'Coordinate limits → Fit → zoom → save/reload', 'Million-value extensions preserved in actual download', 'Camera-only recovery', '3D toolbar at 320/390px and short height', 'Locate closes panel and focuses graph', 'Short-screen close button stays visible'],
    ...(webglAvailable ? {} : { skipped: 'Live 3D locate test: no WebGL. 3D branch covered by component regression test.' }) };
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
}
