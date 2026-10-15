import { stripVTControlCharacters } from 'node:util';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5178';
const artifacts = new URL('./artifacts/performance/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
let output = '', ready = !server, browser, page;
server?.stdout.on('data', (chunk) => { output = (output + chunk).slice(-4000); if (stripVTControlCharacters(output).includes('Local:')) ready = true; });
server?.stderr.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
const errors = [];
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if (ready && (await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('Test server did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Explore curvature.' }).waitFor();
  await page.evaluate(async () => {
    const { useStudioStore: studio } = await import('/src/state/store.ts');
    // Same 1000-vertex input as the pre-change measurement; isolate layout cost.
    const vertices = new Map(Array.from({ length: 1000 }, (_, i) => [i + 1, { id: i + 1, x: 64 * Math.cos(i), y: 64 * Math.sin(i) }]));
    studio.setState({ doc: { vertices, edges: new Map() }, computationPaused: true, computing: false });
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 1000);
  const original = await page.evaluate(async () => JSON.stringify((await import('/src/project/workspace.ts')).captureProject().session.doc));
  const startCallMs = await page.evaluate(async () => {
    const { useStudioStore: studio } = await import('/src/state/store.ts');
    const start = performance.now(); studio.getState().relax3dLayout(); return performance.now() - start;
  });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await waitForBrowser(page, async () => !(await import('/src/state/store.ts')).useStudioStore.getState().relax3dRunning);
  assert(await page.evaluate(async () => JSON.stringify((await import('/src/project/workspace.ts')).captureProject().session.doc)) === original, 'Stop changed the saved positions');

  await page.evaluate(async () => {
    const { useStudioStore: studio } = await import('/src/state/store.ts');
    const started = performance.now(); let last = started, maxGapMs = 0, heartbeats = 0;
    window.__qaLayoutMetrics = null;
    const interval = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last); last = now; heartbeats++; }, 16);
    const unsubscribe = studio.subscribe((next) => {
      if (!next.relax3dRunning && next.relax3dProgress === 1) {
        clearInterval(interval); unsubscribe();
        window.__qaLayoutMetrics = { elapsedMs: performance.now() - started, maxGapMs, heartbeats };
      }
    });
    studio.getState().relax3dLayout();
  });
  // Real keyboard input must continue to work while the worker calculates.
  await page.getByRole('textbox', { name: 'Project name' }).fill('Responsive during layout');
  await page.waitForFunction(() => window.__qaLayoutMetrics !== null, null, { timeout: 60000 });
  const measurement = await page.evaluate(() => window.__qaLayoutMetrics);
  assert(measurement.heartbeats >= 2, 'Main thread did not run during background layout');
  assert.equal(await page.getByRole('textbox', { name: 'Project name' }).inputValue(), 'Responsive during layout');
  assert(await page.evaluate(async () => {
    const { captureProject } = await import('/src/project/workspace.ts');
    const { parseProjectJson } = await import('/src/project/format.ts');
    const project = captureProject(); parseProjectJson(project);
    return project.session.doc.vertices.length === 1000 && project.session.doc.vertices.every((v) => v.p3.every(Number.isFinite));
  }), 'Completed layout was not a valid saveable project');
  await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().undo());
  assert(await page.evaluate(async () => JSON.stringify((await import('/src/project/workspace.ts')).captureProject().session.doc)) === original, 'Undo did not restore the original layout');
  await page.evaluate(async () => {
    const { useStudioStore: studio } = await import('/src/state/store.ts');
    studio.getState().relax3dLayout();
    studio.getState().moveVertices([1], 10, 5);
  });
  assert(await page.evaluate(async () => !(await import('/src/state/store.ts')).useStudioStore.getState().relax3dRunning), 'Editing did not cancel stale layout work');
  // Let the preceding edit's calculation state settle before measuring only panning.
  await waitForBrowser(page, async () => !(await import('/src/state/store.ts')).useStudioStore.getState().computing);

  // Panning keeps the live camera saveable while avoiding React/DOM tree rebuilds.
  await page.evaluate(() => document.activeElement?.blur());
  const cameraBefore = await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().camera2d);
  await page.keyboard.down('Space');
  await page.mouse.move(900, 650); await page.mouse.down();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => {
    const layer = document.querySelector('[data-graph-layer]');
    const circle = document.querySelector('[data-vertex-id="1"]');
    const before = circle.getBoundingClientRect();
    let coordinateWrites = 0, groupTransforms = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.target === layer && record.attributeName === 'transform') groupTransforms++;
        else coordinateWrites++;
      }
    });
    observer.observe(layer, { attributes: true, subtree: true, attributeFilter: ['cx', 'cy', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'transform'] });
    window.__qaFinishPan = () => {
      observer.disconnect();
      const after = circle.getBoundingClientRect();
      return { coordinateWrites, groupTransforms, dx: after.x - before.x, dy: after.y - before.y };
    };
  });
  const rendersBefore = await page.evaluate(() => window.__curvatureStudio2dRenderCount);
  await page.mouse.move(970, 700, { steps: 40 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const panReactRenders = await page.evaluate(() => window.__curvatureStudio2dRenderCount) - rendersBefore;
  assert(panReactRenders <= 1, `Panning rebuilt React ${panReactRenders} times`);
  const panDomUpdates = await page.evaluate(() => window.__qaFinishPan());
  assert.equal(panDomUpdates.coordinateWrites, 0, 'Pan rewrote individual graph coordinates');
  assert(panDomUpdates.groupTransforms > 0, 'Pan did not update the graph transform');
  assert(Math.abs(panDomUpdates.dx - 70) < 0.01 && Math.abs(panDomUpdates.dy - 50) < 0.01, 'Group transform did not move the visible graph');
  await page.mouse.up(); await page.keyboard.up('Space');
  const cameraAfter = await page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject().session.camera2d);
  assert(Math.abs(cameraAfter.tx - cameraBefore.tx - 70) < 0.01 && Math.abs(cameraAfter.ty - cameraBefore.ty - 50) < 0.01, 'Saved camera lost the final pan');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert(await page.evaluate(async () => {
    const { doc, camera2d: camera } = (await import('/src/state/store.ts')).useStudioStore.getState();
    const vertex = doc.vertices.get(1), circle = document.querySelector('[data-vertex-id="1"]');
    return Math.abs(Number(circle.getAttribute('cx')) - (vertex.x * camera.scale + camera.tx)) < 0.01 && Math.abs(Number(circle.getAttribute('cy')) - (vertex.y * camera.scale + camera.ty)) < 0.01;
  }), 'Visible vertices disagree with the saved camera');

  // Complete worker results seed the next job without putting caches in project files.
  await page.evaluate(async () => {
    const OriginalWorker = window.Worker;
    window.__qaMathCacheJobs = [];
    window.Worker = class extends OriginalWorker {
      postMessage(message, ...rest) {
        if (message.type === 'compute') window.__qaMathCacheJobs.push(message.cache?.effective.length ?? 0);
        return super.postMessage(message, ...rest);
      }
    };
    const { useStudioStore: studio } = await import('/src/state/store.ts');
    const { templates } = await import('/src/data/templates.ts');
    const cube = templates.find(entry => entry.id === 'cube');
    const vertices = new Map(cube.vertices3d.map((p3, i) => [i + 1, { id: i + 1, x: p3[0] * 64, y: p3[1] * 64, p3 }]));
    const edges = new Map(cube.edges.map(([a, b], i) => [i + 1, { id: i + 1, a: a + 1, b: b + 1, kind: 'bond' }]));
    studio.getState().replaceDoc({ vertices, edges }); studio.getState().retryComputation();
  });
  await waitForBrowser(page, async () => !(await import('/src/state/store.ts')).useStudioStore.getState().computing);
  await page.evaluate(async () => {
    const { useStudioStore: studio } = await import('/src/state/store.ts');
    const previous = studio.getState().doc;
    const vertices = new Map(previous.vertices), edges = new Map(previous.edges);
    previous.vertices.forEach(v => vertices.set(v.id + 8, { ...v, id: v.id + 8, x: v.x + 250 }));
    previous.edges.forEach(e => edges.set(e.id + 12, { ...e, id: e.id + 12, a: e.a + 8, b: e.b + 8 }));
    studio.getState().replaceDoc({ vertices, edges });
  });
  await waitForBrowser(page, async () => !(await import('/src/state/store.ts')).useStudioStore.getState().computing);
  const componentCacheInputs = await page.evaluate(() => window.__qaMathCacheJobs);
  assert(componentCacheInputs.at(-1) > 0, 'No completed components were reused by the next worker');
  assert(await page.evaluate(async () => {
    const { results } = (await import('/src/state/store.ts')).useStudioStore.getState();
    return results.values.length === 24 && results.values.every(value => value.ollivierFrac[0] === 1 && value.ollivierFrac[1] === 3 && Math.abs(value.vInf - 101 / 40) < 1e-9);
  }), 'Reused results were assigned to the wrong edges');
  // Exercise the unified IDB writer with a large single project while input continues.
  await page.evaluate(async () => {
    window.__saveStart = performance.now(); window.__saveTicks = [window.__saveStart];
    window.__saveTimer = setInterval(() => window.__saveTicks.push(performance.now()), 10);
    (await import('/src/project/store.ts')).useProjectStore.setState({ extensions: { payload: 'x'.repeat(2 * 1024 * 1024) } });
  });
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Autosave input probe');
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  const autosave = await page.evaluate(async () => {
    clearInterval(window.__saveTimer); const ticks = window.__saveTicks;
    const record = await (await import('/src/storage/current.ts')).currentDatabase.read(); const project = JSON.parse(record.raw);
    return { elapsedMs: performance.now() - window.__saveStart, maxEventGapMs: Math.max(0, ...ticks.slice(1).map((t,i) => t-ticks[i])), bytes: new Blob([record.raw]).size, title: project.metadata.title, payload: project.extensions.payload.length };
  });
  assert.equal(autosave.title, 'Autosave input probe'); assert.equal(autosave.payload, 2 * 1024 * 1024);
  assert(autosave.maxEventGapMs < 1000, 'Large-project autosave blocked the UI for at least one second');
  assert.deepEqual(errors, []);
  const report = { autosave, browser: browser.version(), vertices: 1000, startCallMs, ...measurement, panReactRenders, panDomUpdates, componentCacheInputs, checks: ['Stop preserves positions', 'Typing during calculation', 'Save format round trip', 'Undo restores positions', 'Edit cancels stale work', 'Pan moves the visible graph with one group transform and no individual coordinate writes', 'Worker reuses completed components'], webglAvailable: await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2')) };
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
    try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  }
}
