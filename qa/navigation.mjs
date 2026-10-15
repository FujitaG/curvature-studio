import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5188';
const artifacts = new URL('./artifacts/navigation/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
rmSync(new URL('report.json', artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5188', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
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
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const report = { browser: browser.version(), webglAvailable: false, cases: [], roundTrips: [], errors };
  const cube = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
  const pair = JSON.parse(readFileSync(new URL('../examples/cube-comparison.curvature-workspace.json', import.meta.url), 'utf8'));
  for (const d of pair.documents) {
    d.project = structuredClone(cube);
    d.project.metadata.id = `navigation-${d.side}`;
    d.project.metadata.title = `Cube ${d.side}`;
    d.project.metadata.notes = `構造 ${d.side} — "保存"\n🙂`;
    d.project.session.panels = { histogram: true, inspector: true, legend: true, hints: true };
    d.project.session.histogramCollapsed = false;
    delete d.project.session.camera3d;
    d.camera2dMode = 'fit';
  }
  pair.mode = 'compare'; pair.view = '2d'; pair.activeId = pair.documents[1].id; pair.ratio = 50; pair.linked = true;
  await page.goto(baseUrl);
  const button = name => page.getByRole('button', { name, exact: true });
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Both structures saved in browser');
  const open = async input => {
    await page.getByTestId('project-file-input').setInputFiles({ name: 'two-cubes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
    await waitForBrowser(page, async () => {
      const c = (await import('/src/comparison/store.ts')).useComparison.getState();
      return c.documents.length === 2 && c.documents.every(d => !!d.studio.getState().results && !d.studio.getState().computing);
    });
    await saved();
  };
  const snapshot = () => page.evaluate(async () => {
    const c = (await import('/src/comparison/store.ts')).useComparison.getState();
    const memory = await import('/src/state/viewMemory.ts');
    return c.documents.map(d => {
      const s = d.studio.getState();
      return { side: d.side, camera: s.camera2d, camera3d: s.view === '3d' ? memory.getSavedCamera3d(d.studio) : null, doc: JSON.stringify([...s.doc.vertices.values(), ...s.doc.edges.values()]), results: JSON.stringify(s.results.values) };
    });
  });
  const settle = async view => {
    await page.waitForTimeout(500);
    if (view !== '2D') await page.waitForFunction(() => {
      const stats = window.__curvatureStudioRenderStats?.();
      return stats?.frames > 0 && stats.preview === false;
    });
    await saved();
  };
  const edgePoints = (side, view) => page.evaluate(async ({ side, view }) => {
    const c = (await import('/src/comparison/store.ts')).useComparison.getState();
    const d = c.documents.find(d => d.side === side), e = d.studio.getState().doc.edges.get(1);
    const root = document.querySelector(`[data-document-id="${d.id}"]`);
    const canvas = root.querySelector('[data-graph-canvas]'), bounds = canvas.getBoundingClientRect();
    const points = view === '2D' ? [e.a, e.b].map(id => {
      const r = root.querySelector(`[data-vertex-id="${id}"]`).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }) : (await import('/src/view3d/sceneApis.ts')).sceneApis.get(d.studio).stats(true).projectedVertices
      .filter(p => p.id === e.a || p.id === e.b).map(p => ({ x: p.x + bounds.x, y: p.y + bounds.y }));
    if (points.length !== 2) throw new Error('Expected two endpoints');
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    points.push({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
    return { distance, points: points.map(p => ({ ...p, clear: document.elementFromPoint(p.x, p.y)?.closest('[data-document-id]') === root &&
      !!document.elementFromPoint(p.x, p.y)?.closest('[data-graph-canvas]') })) };
  }, { side, view });
  await open(pair);
  for (const view of ['2D', 'Persp', 'Ortho']) {
    if (view === 'Persp') {
      await button('3D').click();
      await page.waitForFunction(() => !!window.__curvatureStudioRenderStats?.() || !!document.querySelector('.webgl-fallback'));
      report.webglAvailable = await page.evaluate(() => !!window.__curvatureStudioRenderStats?.());
      if (!report.webglAvailable) {
        assert.notEqual(process.env.QA_REQUIRE_WEBGL, '1', 'WebGL required for comparison Locate regression');
        break;
      }
    }
    for (const [width, height] of [[1084, 817], [1280, 900]]) for (const ratio of [50, 25, 75]) for (const side of ['B', 'A']) {
      await page.setViewportSize({ width, height });
      const input = structuredClone(pair);
      input.ratio = ratio; input.view = view === '2D' ? '2d' : '3d';
      input.projection = view === 'Ortho' ? 'orthographic' : 'perspective';
      input.documents.forEach(d => { d.project.session.view = input.view; d.project.session.projection = input.projection; });
      input.activeId = input.documents.find(d => d.side === side).id;
      await open(input); await button('Fit both').click(); await settle(view);
      const before = await snapshot();
      const beforeEdge = await edgePoints(side, view);
      await button('Results').click(); await settle(view);
      assert.deepEqual(await snapshot(), before, 'Opening Results changed a camera or graph');
      const method = report.cases.length % 3 ? 'click' : 'Enter';
      const locate = button('Locate edge e1');
      if (method === 'Enter') { await locate.focus(); await locate.press('Enter'); } else await locate.click();
      await settle(view);
      assert.equal(await page.locator('#results-panel, .inspector').count(), 0, 'Locate left a covering panel open');
      assert(await page.evaluate(() => document.activeElement?.matches('[data-graph-canvas]')), 'Canvas did not receive focus');
      const afterEdge = await edgePoints(side, view);
      assert(afterEdge.distance >= 48, `Edge collapsed: ${JSON.stringify({ view, width, ratio, side, beforeEdge, afterEdge })}`);
      assert(afterEdge.points.every(p => p.clear), `Located edge is obscured: ${JSON.stringify({ view, width, ratio, side, afterEdge })}`);
      const after = await snapshot();
      before.forEach((d, i) => {
        assert.equal(after[i].doc, d.doc); assert.equal(after[i].results, d.results);
        if (d.side !== side) {
          assert.deepEqual(after[i].camera, d.camera, 'Locate changed the peer 2D camera');
          assert.deepEqual(after[i].camera3d, d.camera3d, 'Locate changed the peer 3D camera');
        }
      });
      await button('Selection details').click(); await button('Close inspector').click(); await settle(view);
      const closedEdge = await edgePoints(side, view);
      assert(closedEdge.distance >= 48 && closedEdge.points.every(p => p.clear), 'Closing details lost the edge');
      if (view === '2D') assert.deepEqual((await snapshot()).map(d => d.camera), after.map(d => d.camera), 'Closing a panel moved a manual camera');
      report.cases.push({ view, width, height, ratio, side, method, beforeLength: beforeEdge.distance, afterLength: afterEdge.distance, closedLength: closedEdge.distance });
      if (ratio === 50) await page.screenshot({ path: new URL(`locate-${view}-${side}-${width}.png`, artifacts).pathname });
    }
  }
  // W01/W02/W05: the same edited data is downloaded, reopened and reloaded.
  const download = async label => {
    const event = page.waitForEvent('download'); await button('Save comparison (A + B)').click();
    const file = await event; assert.equal(await file.failure(), null);
    const bytes = readFileSync(await file.path()); writeFileSync(new URL(`${label}.json`, artifacts), bytes);
    return JSON.parse(bytes.toString('utf8'));
  };
  for (const omitted of [false, true]) {
    const input = structuredClone(pair);
    if (omitted) input.documents.forEach(d => d.project.session.doc.edges.forEach(e => delete e.weight));
    await open(input);
    await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().convertEdge(1, 'brace'));
    await button('Undo').click(); await button('Redo').click();
    for (const side of ['A', 'B']) {
      if (await button('Single view').count()) {
        await button('Single view').click(); await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^Show ${side} ·`) }).click();
      } else await page.getByRole('button', { name: new RegExp(`^Show ${side} ·`) }).click();
      await saved();
      const label = `${omitted ? 'omitted' : 'explicit'}-single-${side}`;
      const exported = await download(label);
      assert.equal(exported.mode, 'single');
      for (const d of exported.documents) {
        assert(d.project.session.doc.edges.every(e => e.weight === 1));
        assert.equal(d.project.metadata.notes, input.documents.find(o => o.side === d.side).project.metadata.notes);
        assert.equal(d.project.session.doc.edges.find(e => e.id === 1).kind, d.side === 'B' ? 'brace' : 'bond');
      }
      await open(exported); await page.reload(); await saved();
      const reopened = await page.evaluate(async () => (await import('/src/comparison/persistence.ts')).captureComparison());
      for (const d of reopened.documents) {
        const expected = exported.documents.find(e => e.side === d.side);
        assert.deepEqual(d.project.session.doc, expected.project.session.doc);
        const { updatedAt: _actualTime, ...actualMetadata } = d.project.metadata;
        const { updatedAt: _expectedTime, ...expectedMetadata } = expected.project.metadata;
        assert.deepEqual(actualMetadata, expectedMetadata);
      }
      assert.equal(reopened.activeId, exported.activeId);
      report.roundTrips.push(label);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
