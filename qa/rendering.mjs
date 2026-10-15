import { stripVTControlCharacters } from 'node:util';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5180';
const artifacts = new URL('./artifacts/rendering/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true
});
let output = '', ready = !server, browser;
server?.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); if (stripVTControlCharacters(output).includes('Local:')) ready = true; });
server?.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if (ready && (await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('Test server did not start');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  // Do not force software rendering: this suite is also a reproducible Mac/GPU check.
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Explore curvature.' }).waitFor();
  await page.evaluate(() => localStorage.setItem('curvature-studio:orbit-hint-seen', 'true'));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.__curvatureStudioRenderStats || !!document.querySelector('.webgl-fallback'));
  const available = await page.evaluate(() => !!window.__curvatureStudioRenderStats);
  const report = { browser: browser.version(), webglAvailable: available, scenes: [] };
  if (!available) {
    assert.notEqual(process.env.QA_REQUIRE_WEBGL, '1', 'WebGL required but unavailable; run on a machine with a graphics driver');
    await page.getByRole('button', { name: 'Continue in 2D', exact: true }).click();
    report.skipped = 'Live 3D checks skipped: WebGL unavailable. 2D recovery verified; no GPU speed claim.';
  } else {
    const stats = () => page.evaluate(() => window.__curvatureStudioRenderStats());
    const settle = async () => {
      await page.evaluate(() => { window.__qaIdle = null; });
      await page.waitForFunction(() => {
        const stats = window.__curvatureStudioRenderStats(), now = performance.now();
        const previous = window.__qaIdle;
        window.__qaIdle = { frames: stats.frames, since: previous?.frames === stats.frames ? previous.since : now };
        return !stats.preview && now - window.__qaIdle.since > 180;
      });
    };
    for (const cubes of [1, 20, 125]) {
      await page.evaluate(async count => {
        const { useStudioStore: studio } = await import('/src/state/store.ts');
        const { templates } = await import('/src/data/templates.ts');
        const { computeMetrics } = await import('/src/math/index.ts');
        const cube = templates.find(value => value.id === 'cube');
        const vertices = Array.from({ length: count }, (_, cell) => cube.vertices3d.map((p, i) => ({
          id: cell * 8 + i + 1, x: p[0] * 64, y: p[1] * 64,
          p3: [p[0] + cell % 5 * 3, p[1] + Math.floor(cell / 5) * 3, p[2]]
        }))).flat();
        const edges = Array.from({ length: count }, (_, cell) => cube.edges.map(([a, b], i) => ({
          id: cell * 12 + i + 1, a: cell * 8 + a + 1, b: cell * 8 + b + 1, kind: 'bond'
        }))).flat();
        studio.setState({ computationPaused: true, computing: false, tool: 'select', labelsVisible: true,
          doc: { vertices: new Map(vertices.map(v => [v.id, v])), edges: new Map(edges.map(e => [e.id, e])) },
          results: computeMetrics(vertices, edges), selection: [{ kind: 'edge', id: 1 }]
        });
      }, cubes);
      await page.getByRole('button', { name: 'Fit view', exact: true }).click();
      await settle();
      await page.waitForTimeout(250);
      const before = await stats();
      const cameraBefore = await page.evaluate(async () => (await import('/src/state/viewMemory.ts')).getSavedCamera3d());
      const graphBefore = await page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject().session.doc);
      const canvas = page.locator('.canvas-layer canvas');
      const box = await canvas.boundingBox();
      // Verify the whole drag path hits the actual canvas, not a histogram/inspector.
      const start = await canvas.evaluate(node => {
        const box = node.getBoundingClientRect();
        for (const fx of [0.94, 0.1, 0.85, 0.5]) for (const fy of [0.7, 0.4, 0.85, 0.55]) {
          const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
          if (Array.from({ length: 61 }, (_, i) => document.elementFromPoint(point.x - i, point.y - i / 2) === node).every(Boolean)) return point;
        }
        throw new Error('No unobscured canvas drag path is available');
      });
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.waitForFunction(() => window.__curvatureStudioRenderStats().preview);
      const afterDown = await stats();
      for (let i = 1; i <= 60; i++) {
        await page.mouse.move(start.x - i, start.y - i / 2);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      }
      const moving = await stats();
      assert(moving.preview, 'Rotation did not enter interaction mode');
      assert.notDeepEqual(await page.evaluate(async () => (await import('/src/state/viewMemory.ts')).getSavedCamera3d().position), cameraBefore.position, 'Drag did not rotate the camera');
      assert.deepEqual(await page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject().session.doc), graphBefore, 'Rotation changed graph coordinates');
      assert.equal(moving.raycasts, afterDown.raycasts, 'Hover raycasting ran during rotation');
      if (cubes > 1) assert(moving.labels.visited <= 1, 'Unfocused labels were processed during rotation');
      assert.equal(moving.rebuilds, before.rebuilds, 'Rotation rebuilt scene geometry');
      await page.mouse.up(); await settle();
      await page.waitForTimeout(250);
      const resting = await stats();
      assert.equal(resting.quality, 0); assert.equal(resting.pixelRatio, before.pixelRatio);
      assert.equal(resting.simplifiedMeshes, 0);
      await page.waitForTimeout(250);
      assert.equal((await stats()).frames, resting.frames, 'Idle scene kept rendering');
      const pngUrl = await page.evaluate(() => window.__curvatureStudioCapture3d());
      const png = Buffer.from(pngUrl.split(',')[1], 'base64');
      assert.equal(png.readUInt32BE(16), box.width * 2); assert.equal(png.readUInt32BE(20), box.height * 2);
      const { navigationFrameIntervals, ...movingCounters } = moving;
      const intervals = [...navigationFrameIntervals].sort((a, b) => a - b);
      report.scenes.push({ vertices: cubes * 8, edges: cubes * 12, dragStart: start, before, moving: movingCounters, resting,
        // Last 120 app navigation intervals include damping/fit; diagnostic, not a GPU benchmark.
        recentNavigationIntervalsMs: { samples: intervals.length, median: intervals[Math.floor(intervals.length / 2)], p95: intervals[Math.floor(intervals.length * 0.95)] }
      });
      await page.screenshot({ path: new URL(`rest-${cubes * 8}.png`, artifacts).pathname });
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
}
