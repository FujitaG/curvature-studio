import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const sameCamera = (actual, expected) => {
  if (typeof expected === 'number') assert(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)));
  else if (expected && typeof expected === 'object') for (const [key, value] of Object.entries(expected)) sameCamera(actual[key], value);
  else assert.equal(actual, expected);
};
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5189';
const artifacts = new URL('./artifacts/reopen3d/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5189', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  page = await browser.newPage({ viewport: { width: 1084, height: 817 } });
  const errors = [], downloads = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('download', d => downloads.push(d.suggestedFilename()));
  const report = { browser: browser.version(), webglRequired: true, cases: [], errors };
  await page.goto(baseUrl);
  const button = name => page.getByRole('button', { name, exact: true });
  const pair = JSON.parse(readFileSync(new URL('../examples/cube-comparison.curvature-workspace.json', import.meta.url), 'utf8'));
  const cube = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
  for (const d of pair.documents) {
    d.project = structuredClone(cube); d.project.metadata.id = `reopen-${d.side}`;
    d.project.metadata.title = `Cube ${d.side} — 再読込`;
    d.project.session.panels = { histogram: true, inspector: true, legend: true, hints: true };
    d.project.session.histogramCollapsed = false;
    delete d.project.session.camera3d; d.camera2dMode = 'fit';
  }
  pair.view = '3d'; pair.mode = 'compare'; pair.ratio = 50; pair.linked = true;
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Both structures saved in browser');
  const settle = async () => {
    await waitForBrowser(page, async () => {
      const c = (await import('/src/comparison/store.ts')).useComparison.getState();
      const { sceneApis } = await import('/src/view3d/sceneApis.ts');
      if (document.querySelector('.webgl-fallback')) throw new Error('This suite requires real WebGL; no fallback is accepted.');
      return c.documents.length === 2 && sceneApis.size === 2 && c.documents.every(d => {
        const s = sceneApis.get(d.studio)?.stats();
        return s?.frames > 0 && !s.preview && d.studio.getState().results && !d.studio.getState().computing;
      });
    });
    await page.waitForTimeout(600); await saved();
  };
  const open = async value => {
    await page.getByTestId('project-file-input').setInputFiles({ name: 'same-ids.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
    await settle();
  };
  const cameras = () => page.evaluate(async () => {
    const { useComparison } = await import('/src/comparison/store.ts');
    const { sceneApis } = await import('/src/view3d/sceneApis.ts');
    const { getSavedCamera3d } = await import('/src/state/viewMemory.ts');
    return useComparison.getState().documents.map(d => ({ id: d.id, side: d.side, saved: JSON.parse(JSON.stringify(getSavedCamera3d(d.studio))), rendered: JSON.parse(JSON.stringify(sceneApis.get(d.studio).stats(true).camera)) }));
  });
  const verifyCameras = async () => {
    const values = await cameras();
    for (const d of values) assert.deepEqual(d.rendered, d.saved, `Displayed and saved camera differ for ${d.side}`);
    return values;
  };
  const download = async (name, filename, menu = false) => {
    if (menu) await button('Save & export').click();
    const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: !menu }).click();
    const file = await event; assert.equal(await file.failure(), null);
    const bytes = readFileSync(await file.path()); writeFileSync(new URL(filename, artifacts), bytes); return bytes;
  };
  for (const projection of ['perspective', 'orthographic']) for (const side of ['A', 'B']) {
    pair.projection = projection; pair.activeId = pair.documents.find(d => d.side === side).id;
    for (const d of pair.documents) { d.project.session.view = '3d'; d.project.session.projection = projection; }
    await open(pair); await button('Fit both').click(); await settle();
    const label = `${projection}-${side}`;
    // No reload or 2D toggle between these actual downloads and reopens.
    for (let cycle = 0; cycle < 2; cycle++) {
      const initial = await verifyCameras();
      const file = JSON.parse(await download('Save comparison (A + B)', `${label}-${cycle}-before.json`));
      for (const d of file.documents) assert.deepEqual(d.project.session.camera3d, initial.find(c => c.side === d.side).rendered);
      await open(file); assert.deepEqual((await cameras()).map(d => d.id), file.documents.map(d => d.id));
      for (const d of await verifyCameras()) sameCamera(d.rendered, file.documents.find(o => o.side === d.side).project.session.camera3d);
      await button('Fit both').click(); await settle();
      const beforeLocate = await cameras();
      await button('Results').click();
      const locate = button('Locate edge e1'); await locate.focus(); await locate.press('Enter'); await settle();
      assert(await page.evaluate(() => document.activeElement?.matches('[data-graph-canvas]')));
      const located = await verifyCameras();
      assert.notDeepEqual(located.find(d => d.side === side).rendered, beforeLocate.find(d => d.side === side).rendered);
      assert.deepEqual(located.find(d => d.side !== side).rendered, beforeLocate.find(d => d.side !== side).rendered);
      const start = await page.evaluate(() => {
        const canvas = document.querySelector('.comparison-pane.editing canvas'), r = canvas.getBoundingClientRect();
        for (let y = r.top + 20; y < r.bottom - 20; y += 20) for (let x = r.left + 20; x < r.right - 20; x += 20)
          if (document.elementFromPoint(x, y) === canvas) return { x, y };
        throw new Error('No unobscured wheel target');
      });
      await page.mouse.move(start.x, start.y); await page.mouse.wheel(0, 90); await settle();
      const zoomed = await verifyCameras();
      // Linked gestures must reach both current stores after replacement.
      for (const d of zoomed) assert.notDeepEqual(d.rendered, located.find(o => o.side === d.side).rendered);
      await button('Save & export').click();
      assert.match(await page.locator('.export-popover').innerText(), new RegExp(`Export figure · ${side} — Cube ${side}`));
      await button('Save & export').click();
      const svg = await download(/^SVG \(vector\)/, `${label}-${cycle}.svg`, true);
      assert.equal((svg.toString().match(/<circle /g) ?? []).length, 8);
      const png = await download(/^PNG \(2×\)/, `${label}-${cycle}.png`, true);
      const pixels = await page.evaluate(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
        const bytes = ctx.getImageData(0, 0, c.width, c.height).data, colors = new Set(); let ink = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i + 3] && Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) < 230) ink++;
          colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]},${bytes[i + 3]}`);
        }
        return { width: c.width, height: c.height, ink, colors: colors.size };
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert(pixels.ink > 100 && pixels.colors > 10, `Blank output: ${JSON.stringify(pixels)}`);
      const after = JSON.parse(await download('Save comparison (A + B)', `${label}-${cycle}-after.json`));
      for (const d of after.documents) {
        assert.deepEqual(d.project.session.doc, file.documents.find(o => o.side === d.side).project.session.doc);
        assert.deepEqual(d.project.session.camera3d, zoomed.find(o => o.side === d.side).rendered);
      }
      await page.screenshot({ path: new URL(`${label}-${cycle}.png-screen.png`, artifacts).pathname });
      report.cases.push({ projection, side, cycle, pixels, cameras: zoomed });
    }
  }
  // Simulate a missing registration while leaving a visible canvas: no fallback download.
  await page.evaluate(async () => {
    const { sceneApis } = await import('/src/view3d/sceneApis.ts');
    const { getActiveStudioStore } = await import('/src/state/store.ts');
    const store = getActiveStudioStore(); window.__qaRestoreScene = () => sceneApis.set(store, scene);
    const scene = sceneApis.get(store); sceneApis.delete(store);
  });
  const count = downloads.length;
  for (const format of [/^SVG \(vector\)/, /^PNG \(2×\)/]) {
    await button('Save & export').click(); await page.getByRole('button', { name: format }).click();
    await page.getByRole('alert').filter({ hasText: 'Could not export figure' }).waitFor();
    await page.waitForTimeout(4500);
    assert.equal(downloads.length, count, 'Missing scene produced a download');
    assert.match(await page.getByRole('alert').innerText(), /No image was saved/);
    await button('Dismiss').click();
  }
  await page.evaluate(() => { window.__qaRestoreScene(); delete window.__qaRestoreScene; });
  await download(/^PNG \(2×\)/, 'recovered.png', true);
  report.missingSceneRejected = true; report.webglAvailable = true;
  report.webglRenderer = await page.evaluate(() => {
    const gl = document.querySelector('.comparison-pane.editing canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  assert.deepEqual(errors, []);
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {}); throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
