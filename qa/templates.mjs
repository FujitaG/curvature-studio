// Exercise the production catalog through actual template buttons, calculation,
// downloads and WebGL. Geometric correctness is checked separately by unit tests.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium, expect } = await import('playwright/test');
const catalog = JSON.parse(readFileSync(new URL('../src/data/templates.json', import.meta.url)));
const artifacts = new URL('./artifacts/templates/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
for (const name of ['report.json', 'failure.json']) rmSync(new URL(name, artifacts), { force: true });
const baseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:5202';
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5202', '--strictPort'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe' });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, startedAt: new Date().toISOString(), cases: [], errors: [] };
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Preview did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  page.on('pageerror', e => report.errors.push(e.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const download = async (locator, name) => {
    const pending = page.waitForEvent('download'); await locator.click(); const file = await pending;
    assert.equal(await file.failure(), null); const bytes = readFileSync(await file.path());
    writeFileSync(new URL(name, artifacts), bytes); return bytes;
  };
  await page.goto(baseUrl); await button('Cube').click();
  await button('Panels').click();
  const panels = page.getByRole('dialog', { name: 'Panels', exact: true });
  for (const name of ['Histogram', 'Inspector', 'Interaction guide']) await panels.getByRole('checkbox', { name, exact: true }).uncheck();
  await button('Close Panels').click();
  for (const t of catalog) {
    await button('Templates').click();
    const drawer = page.getByRole('region', { name: 'Templates', exact: true });
    await drawer.getByRole('combobox', { name: 'Placement' }).selectOption('replace');
    await drawer.getByRole('searchbox', { name: 'Search templates' }).fill(t.id);
    await drawer.locator(`[data-template-id="${t.id}"]`).getByRole('button').click();
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await button('Fit view').click();
    await expect(page.locator('[data-vertex-id]')).toHaveCount(t.vertices3d.length);
    await button('Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor();
    const result = JSON.parse(await download(button('Download results JSON'), `${t.id}-results.json`));
    assert.equal(result.doc.vertices.length, t.vertices3d.length);
    assert.equal(result.doc.edges.length, t.edges.length);
    assert.equal(result.quotientBonds.length, t.edges.length);
    assert.equal(result.summary.notConverged, 0);
    assert(result.quotientBonds.every(v => Number.isFinite(v.kEff) && Number.isFinite(v.ollivier)));
    const ids = new Map(result.doc.vertices.map((v, i) => [v.id, i]));
    assert.deepEqual(result.doc.edges.map(e => [ids.get(e.a), ids.get(e.b)]), t.edges);
    assert.deepEqual(result.doc.vertices.map(v => v.p3), t.vertices3d);
    await button('Close results').click();
    await button('Save & export').click();
    const svg = (await download(page.getByRole('button', { name: /^SVG \(vector\)/ }), `${t.id}-2d.svg`)).toString();
    const circleCount = await page.evaluate(source => new DOMParser().parseFromString(source, 'image/svg+xml').querySelectorAll('circle').length, svg);
    assert.equal(circleCount, t.vertices3d.length);
    await page.screenshot({ path: new URL(`${t.id}-2d.png`, artifacts).pathname });
    await button('3D').click();
    await page.waitForFunction(() => window.__curvatureStudioRenderStats?.()?.frames > 0 || !!document.querySelector('.webgl-fallback'));
    // This suite must exercise the new embeddings; fallback is not a pass.
    assert.equal(await page.locator('.webgl-fallback').count(), 0, 'Real WebGL required for template geometry');
    await button('Fit view').click();
    await page.evaluate(() => { window.__templateCamera = null; });
    await page.waitForFunction(() => {
      const stats = window.__curvatureStudioRenderStats?.(true);
      if (!stats || stats.preview) return false;
      const key = JSON.stringify(stats.camera), now = performance.now();
      if (window.__templateCamera?.key !== key) window.__templateCamera = { key, since: now };
      return now - window.__templateCamera.since > 120;
    });
    const projected = await page.evaluate(() => window.__curvatureStudioRenderStats(true).projectedVertices);
    assert.equal(projected.length, t.vertices3d.length);
    assert(projected.every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && v.x > 0 && v.x < 1440 && v.y > 0 && v.y < 1000 && Math.abs(v.z) < 1));
    await button('Save & export').click();
    const png = await download(page.getByRole('button', { name: /^PNG \(2×\)/ }), `${t.id}-3d.png`);
    const pixels = await page.evaluate(async url => {
      const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      let ink = 0; const colors = new Set();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && Math.min(data[i], data[i + 1], data[i + 2]) < 220) ink += 1;
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
      }
      return { ink, colors: colors.size, width: img.width, height: img.height };
    }, `data:image/png;base64,${png.toString('base64')}`);
    assert(pixels.ink > 100 && pixels.colors > 10, `${t.id}: empty rendering`);
    report.cases.push({ id: t.id, vertices: projected.length, edges: result.doc.edges.length, pixels });
    console.log(`${t.id}: template, Worker, SVG and WebGL PNG passed`);
    await button('2D').click();
  }
  assert.deepEqual(report.errors, []);
  report.finishedAt = new Date().toISOString();
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  await page?.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  writeFileSync(new URL('failure.json', artifacts), JSON.stringify({ ...report, error: String(error) }, null, 2)); throw error;
} finally { await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
