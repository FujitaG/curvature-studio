import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5194';
const artifacts = new URL('./artifacts/threshold3d/', import.meta.url);
mkdirSync(artifacts, { recursive: true }); rmSync(new URL('report.json', artifacts), { force: true });
// UI + downloaded files only: the same check runs against the deployed app.
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5194', '--strictPort'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe' });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, browser: '', cases: [], paired: [], errors: [] };
const button = name => page.getByRole('button', { name, exact: true });
const settle = async () => {
  await page.waitForFunction(() => { const s = window.__curvatureStudioRenderStats?.(); return s?.frames > 0 && !s.preview; });
  await page.waitForTimeout(150);
};
const download = async (locator, filename) => {
  const event = page.waitForEvent('download'); await locator.click(); const file = await event;
  assert.equal(await file.failure(), null);
  const bytes = readFileSync(await file.path()); writeFileSync(new URL(filename, artifacts), bytes); return bytes;
};
const colors = async bytes => page.evaluate(async base64 => {
  const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const targets = { high: [180,4,38], low: [59,76,192], selection: [74,111,227] };
  const counts = { high: 0, low: 0, selection: 0 };
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 240) continue;
    for (const [key, rgb] of Object.entries(targets)) if (rgb.every((v, j) => Math.abs(v - pixels[i+j]) <= 3)) counts[key]++;
  }
  return counts;
}, bytes.toString('base64'));

try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(output || 'Preview did not start');
    await new Promise(r => setTimeout(r, 150));
  }
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' }); report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(baseUrl); await button('Cube').click();
  await button('Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor();
  const before = JSON.parse(await download(button('Download results JSON'), 'results-before.json'));
  await button('Close results').click();
  await button('3D').click(); await settle();
  // Labels cannot satisfy the pixel assertions by themselves. Keep the whole
  // template selected, which formerly covered every edge with opaque blue.
  await button('Panels').click(); await page.getByRole('checkbox', { name: 'Edge labels', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const hist = page.getByRole('region', { name: 'Histogram', exact: true });
  await hist.locator('summary').click();
  const edit = async (name, value) => { const input = hist.getByRole('textbox', { name, exact: true }); await input.fill(value); await input.press('Enter'); await settle(); };
  for (const metric of ['Effective curvature', 'Ollivier–Ricci curvature']) {
    await button('Metric').click(); await page.locator('.metric-menu button').filter({ hasText: metric }).click();
    await hist.getByRole('button', { name: 'Use threshold colors', exact: true }).click();
    await edit('Transition width', '0');
    for (const projection of ['Persp', 'Ortho']) for (const style of ['single', 'double', 'dashed']) {
      await button(projection).click();
      await button('Display settings').click();
      await page.getByRole('combobox', { name: 'Bond style', exact: true }).selectOption(style);
      await page.keyboard.press('Escape'); await button('Fit view').click(); await settle();
      const initialRebuilds = await page.evaluate(() => window.__curvatureStudioRenderStats().rebuilds);
      for (const [value, expected] of [['0','high'], ['1','low']]) {
        await edit('Color threshold', value);
        const filename = `${metric.startsWith('Effective') ? 'keff' : 'ollivier'}-${projection}-${style}-${expected}`;
        // Capture the graph bounds: floating UI is composited over the canvas,
        // and the correctly colored histogram must not mask a broken graph.
        const clip = await page.evaluate(() => {
          const points = window.__curvatureStudioRenderStats(true).projectedVertices;
          const rect = document.querySelector('.canvas-layer canvas').getBoundingClientRect();
          const x = Math.max(0, rect.x + Math.min(...points.map(p => p.x)) - 24);
          const y = Math.max(0, rect.y + Math.min(...points.map(p => p.y)) - 24);
          const right = Math.min(innerWidth, rect.x + Math.max(...points.map(p => p.x)) + 24);
          const bottom = Math.min(innerHeight, rect.y + Math.max(...points.map(p => p.y)) + 24);
          const histogram = document.querySelector('.histogram').getBoundingClientRect();
          if (!(right < histogram.left || x > histogram.right || bottom < histogram.top || y > histogram.bottom)) throw new Error('Histogram overlaps graph test region');
          return { x, y, width: right-x, height: bottom-y };
        });
        const screen = await page.screenshot({ clip, path: new URL(`${filename}-screen.png`, artifacts).pathname });
        const screenColors = await colors(screen);
        assert(screenColors[expected] > 150, `Visible ${filename}: ${JSON.stringify(screenColors)}`);
        assert(screenColors.selection > 150, `Selection disappeared: ${filename}`);
        await button('Save & export').click();
        const png = await download(page.getByRole('button', { name: /^PNG \(2×\)/ }), `${filename}.png`);
        const pngColors = await colors(png);
        assert(pngColors[expected] > 300, `Export ${filename}: ${JSON.stringify(pngColors)}`);
        assert(pngColors.selection > 300, `Export selection disappeared: ${filename}`);
        await button('Save & export').click();
        const svg = (await download(page.getByRole('button', { name: /^SVG \(vector\)/ }), `${filename}.svg`)).toString();
        assert.equal((svg.match(new RegExp(`stroke="${expected === 'high' ? '#B40426' : '#3B4CC0'}"`, 'g')) ?? []).length, style === 'double' ? 24 : 12);
        assert.equal(await page.evaluate(() => window.__curvatureStudioRenderStats().rebuilds), initialRebuilds, 'Threshold must not rebuild scene geometry');
        report.cases.push({ metric, projection, style, value, screenColors, pngColors });
      }
    }
  }
  await button('Results').click();
  const after = JSON.parse(await download(button('Download results JSON'), 'results-after.json'));
  assert.deepEqual(after.quotientBonds, before.quotientBonds, 'Color controls changed calculation values');
  await button('Close results').click();
  await button('Compare').click(); await settle();
  for (const side of ['A', 'B']) {
    const canvas = page.getByRole('region', { name: `Structure ${side}`, exact: true }).locator('canvas');
    await canvas.focus(); await canvas.press('ControlOrMeta+A'); await settle();
  }
  await button('Fit both').click(); await settle();
  for (const [value, expected] of [['0','high'], ['1','low']]) {
    // Change the shared threshold once; both scenes must update.
    await edit('Color threshold', value);
    for (const side of ['A','B']) {
      const pane = page.getByRole('region', { name: `Structure ${side}`, exact: true });
      await pane.locator('canvas').focus(); await settle();
      const filename = `paired-${side}-${expected}`;
      const screen = await pane.locator('.comparison-canvas').screenshot({ mask: [hist], maskColor: '#FFFFFF', path: new URL(`${filename}-screen.png`, artifacts).pathname });
      const screenColors = await colors(screen);
      assert(screenColors[expected] > 150, `${filename}: ${JSON.stringify(screenColors)}`);
      await button('Save & export').click();
      const png = await download(page.getByRole('button', { name: /^PNG \(2×\)/ }), `${filename}.png`);
      const pngColors = await colors(png);
      assert(pngColors[expected] > 300, `${filename} export: ${JSON.stringify(pngColors)}`);
      report.paired.push({ side, value, screenColors, pngColors });
    }
  }
  assert.deepEqual(report.errors, []);
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ baseUrl, cases: report.cases.length, paired: report.paired.length, errors: report.errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('failure.png', artifacts).pathname });
  throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
