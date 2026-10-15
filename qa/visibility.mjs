import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5182';
const artifacts = new URL('./artifacts/visibility/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5182', '--strictPort'], {
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
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  const example = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  const open = async input => {
    await page.getByTestId('project-file-input').setInputFiles({ name: 'visibility.curvature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
    await saved();
  };
  const menu = async () => {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.locator('.view-menu > summary').click();
  };
  const closeMenu = () => page.getByRole('button', { name: 'Menu', exact: true }).click();
  const settle = async view => {
    await page.waitForTimeout(450);
    if (view === '3D') await page.waitForFunction(() => {
      const stats = window.__curvatureStudioRenderStats?.();
      return !!document.querySelector('.view-pane.active canvas[data-graph-canvas]') && stats?.frames > 0 && stats.preview === false;
    });
    else await page.waitForFunction(() => !!document.querySelector('.view-pane.active svg[data-graph-canvas]') && !window.__curvatureStudioRenderStats?.());
    await saved();
  };
  await open(example);
  await page.getByRole('button', { name: 'Hide histogram', exact: true }).click();
  assert.equal(await page.locator('.histogram').count(), 0);
  await menu();
  assert.equal(await page.getByRole('checkbox', { name: 'Histogram', exact: true }).isChecked(), false);
  await page.getByRole('checkbox', { name: 'Keyboard shortcuts in guide', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Inspector', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Interaction guide', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Edge labels', exact: true }).uncheck();
  await closeMenu(); await saved();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const download = await downloadEvent, chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const hiddenProject = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.deepEqual(hiddenProject.session.panels, { histogram: false, inspector: false, legend: false, hints: false });
  await page.reload(); await saved();
  assert.equal(await page.locator('.histogram, .interaction-guide').count(), 0);
  assert.deepEqual(await page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject().session.camera2d), hiddenProject.session.camera2d, 'Reload drifted the saved camera');
  await open(example);
  assert.equal(await page.locator('.histogram').count(), 1);
  await open(hiddenProject);
  assert.equal(await page.locator('.histogram, .interaction-guide').count(), 0);
  await menu(); await page.getByRole('checkbox', { name: 'Histogram', exact: true }).check(); await closeMenu();
  assert.equal(await page.locator('.histogram').count(), 1);
  await open(example);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.__curvatureStudioRenderStats?.() || !!document.querySelector('.webgl-fallback'));
  const webglAvailable = await page.evaluate(() => !!window.__curvatureStudioRenderStats?.());
  if (!webglAvailable) assert.notEqual(process.env.QA_REQUIRE_WEBGL, '1', 'WebGL required but unavailable');
  const report = { browser: browser.version(), webglAvailable, panelRoundTrip: true, located: [], scenes: [] };
  const unobscured = async points => page.evaluate(points => points.map(p => {
    const hit = document.elementFromPoint(p.x, p.y);
    return { ...p, clear: !!hit?.closest('[data-graph-canvas]'), hit: hit?.className?.baseVal ?? hit?.className };
  }), points);
  for (const view of webglAvailable ? ['2D', '3D'] : ['2D']) for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.locator('.view-pane.active [data-graph-canvas]').waitFor();
    await settle(view);
    const cameraBeforeResults = await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().camera2d);
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await settle(view);
    assert.deepEqual(await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().camera2d), cameraBeforeResults, 'Opening results changed the saved graph view');
    const link = page.getByRole('button', { name: 'Locate edge e1', exact: true });
    await link.focus(); await link.press('Enter'); await settle(view);
    assert.equal(await page.locator('#results-panel, .inspector').count(), 0);
    assert(await page.evaluate(() => document.activeElement?.matches('[data-graph-canvas]')));
    const ids = [example.session.doc.edges[0].a, example.session.doc.edges[0].b];
    const points = view === '3D'
      ? (await page.evaluate(() => window.__curvatureStudioRenderStats(true).projectedVertices)).filter(p => ids.includes(p.id))
      : await page.evaluate(ids => ids.map(id => {
        const circle = document.querySelector(`[data-vertex-id="${id}"]`), r = circle.getBoundingClientRect();
        return { id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }), ids);
    points.push({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
    const hits = await unobscured(points);
    assert(hits.every(p => p.clear), `Located edge is obscured: ${JSON.stringify(hits)}`);
    await page.screenshot({ path: new URL(`locate-${view}-${width}.png`, artifacts).pathname });
    await page.getByRole('button', { name: 'Selection details', exact: true }).click();
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await menu(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.overflow-menu').count(), 0);
    assert.deepEqual(await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().selection), [{ kind: 'edge', id: 1 }]);
    report.located.push({ view, width, height, points: hits });
  }

  if (webglAvailable) for (const [width, height] of [[320, 844], [390, 844], [1280, 900], [844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const scale of [0.1, 1, 10, 100]) for (const projection of ['Persp', 'Ortho']) {
      const input = structuredClone(example);
      input.session.view = '3d'; input.session.projection = projection === 'Persp' ? 'perspective' : 'orthographic';
      delete input.session.camera3d;
      input.session.doc.vertices.forEach(v => { v.p3 = v.p3.map(value => value * scale); });
      await open(input);
      await page.getByRole('button', { name: projection, exact: true }).click();
      await page.getByRole('button', { name: 'Fit view', exact: true }).click(); await settle('3D');
      const stats = await page.evaluate(() => window.__curvatureStudioRenderStats(true));
      assert.equal(stats.fog, false);
      const r = stats.viewport;
      assert(stats.projectedVertices.every(p => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height && Math.abs(p.z) < 1), `Clipped ${projection} ${width} scale=${scale}: ${JSON.stringify(stats)}`);
      const hits = await unobscured(stats.projectedVertices);
      assert(hits.every(p => p.clear), `Fit is behind a panel: ${JSON.stringify(hits)}`);
      // Verify rendered pixels too: valid projections alone missed the distance-fog regression.
      const inkPixels = await page.evaluate(async () => {
        const img = new Image(); img.src = window.__curvatureStudioCapture3d(); await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 90) count++;
        return count;
      });
      assert(inkPixels > 100, `Blank 3D graph: ${projection} ${width} scale=${scale}`);
      const actual = await page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject().session.doc);
      assert.deepEqual(actual, input.session.doc, 'Fit changed graph data');
      report.scenes.push({ width, height, projection, scale, viewport: r, inkPixels, unitScale: stats.unitScale });
      if (scale === 10 || width === 320 && scale === 1) await page.screenshot({ path: new URL(`fit-${projection}-${width}-${scale}.png`, artifacts).pathname });
    }
  }
  if (!webglAvailable) report.skipped = 'Live 3D framing/locate and pixel checks require WebGL; 2D and panel persistence verified.';
  assert.deepEqual(errors, []);
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
}
