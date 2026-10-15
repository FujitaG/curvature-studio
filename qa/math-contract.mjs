// Production build + real Worker + UI/import/download paths. No application imports.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium, expect } = await import('playwright/test');
const cases = JSON.parse(readFileSync(new URL('./fixtures/paper-values.json', import.meta.url)));
const example = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url)));
const baseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:5201';
const artifacts = new URL('./artifacts/math-contract/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
for (const name of ['report.json', 'failure.json']) rmSync(new URL(name, artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5201', '--strictPort'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe' });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, startedAt: new Date().toISOString(), cases: [], errors: [] };
const button = name => page.getByRole('button', { name, exact: true });
// Canvas labels use bare zero for Ollivier; paper SVG uses configured decimals.
const label = (metric, value) => metric === 'ollivier' && value === 0 ? '0' : metric === 'ollivier' && value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
const effective = v => 1 - Math.sqrt(1 - 2 / v);
function close(actual, expected, context) { assert(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9, `${context}: ${actual} vs ${expected}`); }
async function download(locator, name) {
  const pending = page.waitForEvent('download'); await locator.click(); const file = await pending;
  assert.equal(await file.failure(), null); const bytes = readFileSync(await file.path());
  writeFileSync(new URL(name, artifacts), bytes); return bytes;
}
async function svgLabels(svg) {
  return page.evaluate(source => [...new DOMParser().parseFromString(source, 'image/svg+xml').querySelectorAll('text')].map(el => el.textContent), svg);
}
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Preview did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  // Observe actual text painted into 3D label textures; do not replace drawing.
  await context.addInitScript(() => {
    window.__paperGlyphs = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      window.__paperGlyphs.push(String(args[0]));
      return Reflect.apply(original, this, args);
    };
  });
  page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(baseUrl);
  // Reuse one page so each import must invalidate the preceding graph's result.
  for (const [caseIndex, fixture] of cases.entries()) {
    const project = structuredClone(example), prefix = String(caseIndex + 1);
    project.metadata.id = `paper-contract-${caseIndex}`; project.metadata.title = fixture.name;
    project.session.doc.vertices = Array.from({ length: fixture.vertexCount }, (_, i) => {
      const angle = 2 * Math.PI * i / fixture.vertexCount;
      return { id: 101 + 7 * i, x: 150 * Math.cos(angle), y: 150 * Math.sin(angle), p3: [Math.cos(angle), Math.sin(angle), 0.25 * Math.cos(2 * angle)], baked3d: true };
    });
    project.session.doc.edges = fixture.edges;
    project.session.panels = { histogram: false, inspector: false, legend: false, hints: false };
    project.resultsDisplay.precision = 8;
    await page.getByTestId('project-file-input').setInputFiles({ name: `${prefix}.curvature.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(fixture.name);
    await button('Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor();
    const result = JSON.parse(await download(button('Download results JSON'), `${prefix}-results.json`));
    const csv = (await download(button('Download CSV'), `${prefix}-results.csv`)).toString().trim().split('\n').slice(1).map(line => line.split(', '));
    assert.equal(result.project.title, fixture.name);
    assert.deepEqual(result.doc.edges, fixture.edges);
    assert.equal(result.calculation.laziness, 0.5);
    assert.equal(result.summary.notConverged, 0);
    for (const check of fixture.checks) {
      const edge = result.edges.find(e => e.id === check.id);
      const value = result.quotientBonds.find(e => e.index === edge.quotient);
      const variance = check.variance[0] / check.variance[1], k = effective(variance), o = check.ollivier[0] / check.ollivier[1];
      close(value.vInf, variance, fixture.name); close(value.kEff, k, fixture.name);
      assert.deepEqual(value.ollivierFrac, check.ollivier);
      assert.equal(value.evidence.effective.certified, false);
      const row = page.locator('.results-table tbody tr').filter({ has: button(`Locate edge e${check.id}`) });
      await expect(row.locator('td').nth(0)).toHaveText(`${o.toFixed(8)}${check.ollivier.join('/')}`);
      await expect(row.locator('td').nth(1)).toHaveText(k.toFixed(8));
      const record = csv.find(c => Number(c[0]) === check.id);
      close(Number(record[8]), variance, `${fixture.name} CSV V`); close(Number(record[9]), k, `${fixture.name} CSV effective`);
      assert.equal(Number(record[5]) / Number(record[6]), o);
    }
    for (const edge of fixture.edges.filter(e => e.kind === 'brace')) {
      const row = page.locator('.results-table tbody tr').filter({ has: button(`Locate edge e${edge.id}`) });
      await expect(row.locator('td').nth(1)).toHaveText('—');
      await expect(row.locator('td').nth(2)).toHaveText('Rigid tie');
    }
    await button('Close results').click(); await button('Fit view').click();
    const entry = { name: fixture.name, checkedEdges: fixture.checks.length, views: [] };
    for (const view of ['2D', '3D']) {
      if (view === '3D') {
        await page.evaluate(() => { window.__paperGlyphs = []; });
        await button('3D').click();
        await page.waitForFunction(() => window.__curvatureStudioRenderStats?.()?.frames > 0 || !!document.querySelector('.webgl-fallback'));
        if (await page.locator('.webgl-fallback').count()) {
          assert.notEqual(process.env.QA_REQUIRE_WEBGL, '1', 'Real WebGL required for paper label checks');
          entry.views.push({ view, skipped: 'WebGL unavailable' }); await button('Continue in 2D').click(); break;
        }
        await button('Fit view').click();
        await page.evaluate(() => { window.__paperCamera = null; });
        await page.waitForFunction(() => {
          const stats = window.__curvatureStudioRenderStats?.(true);
          if (!stats || stats.preview) return false;
          const key = JSON.stringify(stats.camera), now = performance.now();
          if (window.__paperCamera?.key !== key) window.__paperCamera = { key, since: now };
          return now - window.__paperCamera.since > 120;
        });
      }
      for (const metric of ['keff', 'ollivier']) {
        await button('Metric').click();
        await page.locator('.metric-menu').getByRole('button', { name: metric === 'keff' ? /Effective curvature/ : /Ollivier–Ricci curvature/ }).click();
        const expectedLabels = fixture.checks.map(check => label(metric, metric === 'keff' ? effective(check.variance[0] / check.variance[1]) : check.ollivier[0] / check.ollivier[1]));
        if (view === '2D') {
          for (const [i, check] of fixture.checks.entries()) await expect(page.locator(`[data-label-id="${check.id}"]`)).toHaveText(expectedLabels[i]);
          for (const edge of fixture.edges.filter(e => e.kind === 'brace')) assert.equal(await page.locator(`[data-label-id="${edge.id}"]`).count(), 0);
        } else {
          await page.waitForFunction(wanted => wanted.every(text => window.__paperGlyphs.includes(text)), [...new Set(expectedLabels)]);
        }
        await button('Save & export').click();
        const svg = (await download(page.getByRole('button', { name: /^SVG \(vector\)/ }), `${prefix}-${view}-${metric}.svg`)).toString();
        const texts = await svgLabels(svg);
        const exportLabels = view === '2D' ? expectedLabels.map(text => text === '0' ? '0.00' : text) : expectedLabels;
        for (const expected of new Set(exportLabels)) assert(texts.includes(expected), `${fixture.name} ${view} ${metric}: missing SVG label ${expected}`);
        const expectedCount = fixture.edges.filter(e => e.kind === 'bond').length;
        assert.equal(texts.length, expectedCount, 'Each visible Bond has one SVG label; Braces have none');
        if (fixture.checks.length === expectedCount) assert.deepEqual([...texts].sort(), [...exportLabels].sort(), 'SVG label values and multiplicities');
        // The bridge has different values from its clique edges. Check the
        // 3D SVG label at EACH checked edge's projected midpoint, not merely
        // whether the right number occurs somewhere in the figure.
        if (view === '3D') {
          const geometry = await page.evaluate(source => {
            const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
            return { vertices: window.__curvatureStudioRenderStats(true).projectedVertices,
              circles: [...doc.querySelectorAll('circle')].map(el => ({ x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) })),
              texts: [...doc.querySelectorAll('text')].map(el => ({ x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')), text: el.textContent })) };
          }, svg);
          const first = geometry.vertices.find(v => v.id === project.session.doc.vertices[0].id);
          const ox = geometry.circles[0].x - first.x, oy = geometry.circles[0].y - first.y;
          for (const [i, check] of fixture.checks.entries()) {
            const edge = fixture.edges.find(e => e.id === check.id);
            const a = geometry.vertices.find(v => v.id === edge.a), b = geometry.vertices.find(v => v.id === edge.b);
            const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
            let nx = -dy / length, ny = dx / length;
            if (ny > 0) { nx = -nx; ny = -ny; }
            const x = (a.x + b.x) / 2 + nx * 9 + ox, y = (a.y + b.y) / 2 + ny * 9 + oy;
            assert(geometry.texts.some(t => Math.hypot(t.x - x, t.y - y) < 0.03 && t.text === expectedLabels[i]), `${fixture.name} e${edge.id}: wrong 3D SVG label or placement`);
          }
        }
        entry.views.push({ view, metric, labels: 'passed', svg: 'passed' });
      }
      if (view === '3D') await button('2D').click();
    }
    report.cases.push(entry); console.log(`${fixture.name}: numerical results, table, labels and downloads passed`);
  }
  assert.deepEqual(report.errors, []);
  report.finishedAt = new Date().toISOString();
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  await page?.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  writeFileSync(new URL('failure.json', artifacts), JSON.stringify({ ...report, error: String(error) }, null, 2)); throw error;
} finally { await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
