import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;

const { chromium } = await import('playwright');

const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const artifacts = new URL('./artifacts/', import.meta.url);
mkdirSync(artifacts, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function safeScreenshot(page, name) {
  try {
    await page.screenshot({ path: new URL(name, artifacts).pathname });
  } catch (error) {
    console.log(`SKIPPED: page screenshot ${name} (${error.message})`);
  }
}

async function resetPage(page) {
  // Clear after navigation, before app startup: pagehide may otherwise flush an old
  // pending autosave back into storage between clear() and reload().
  await page.evaluate(() => sessionStorage.setItem('qa:reset-on-load', '1'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.svg-canvas');
}

async function assertVertexNear(page, point, label) {
  await page.waitForFunction(
    ({ x, y }) =>
      [...document.querySelectorAll('[data-vertex-id]')].some((node) => {
        const cx = Number(node.getAttribute('cx'));
        const cy = Number(node.getAttribute('cy'));
        return Math.hypot(cx - x, cy - y) <= 25;
      }),
    point
  );
  const nearest = await page.evaluate(({ x, y }) => {
    const distances = [...document.querySelectorAll('[data-vertex-id]')].map((node) => {
      const cx = Number(node.getAttribute('cx'));
      const cy = Number(node.getAttribute('cy'));
      return Math.hypot(cx - x, cy - y);
    });
    return Math.min(...distances);
  }, point);
  assert(nearest <= 25, `${label}: nearest vertex was ${nearest.toFixed(1)} px away`);
}

async function assertBondNear(page, start, end, label) {
  await page.waitForFunction(
    ({ start, end }) =>
      [...document.querySelectorAll('[data-edge-line="bond"]')].some((line) => {
        const a = { x: Number(line.getAttribute('x1')), y: Number(line.getAttribute('y1')) };
        const b = { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) };
        const forward = Math.hypot(a.x - start.x, a.y - start.y) <= 25 && Math.hypot(b.x - end.x, b.y - end.y) <= 25;
        const reverse = Math.hypot(b.x - start.x, b.y - start.y) <= 25 && Math.hypot(a.x - end.x, a.y - end.y) <= 25;
        return forward || reverse;
      }),
    { start, end }
  );
  const nearest = await page.evaluate(({ start, end }) => {
    const distances = [...document.querySelectorAll('[data-edge-line="bond"]')].map((line) => {
      const a = { x: Number(line.getAttribute('x1')), y: Number(line.getAttribute('y1')) };
      const b = { x: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y2')) };
      const forward = Math.max(Math.hypot(a.x - start.x, a.y - start.y), Math.hypot(b.x - end.x, b.y - end.y));
      const reverse = Math.max(Math.hypot(b.x - start.x, b.y - start.y), Math.hypot(a.x - end.x, a.y - end.y));
      return Math.min(forward, reverse);
    });
    return Math.min(...distances);
  }, { start, end });
  assert(nearest <= 25, `${label}: nearest bond endpoint error was ${nearest.toFixed(1)} px`);
}

async function readDownloadText(download) {
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString('utf8');
  return text;
}

function assertExportedSvg(svg, label) {
  assert((svg.match(/<line/g) ?? []).length >= 12, `${label}: exported SVG has too few lines`);
  assert((svg.match(/<text/g) ?? []).length >= 12, `${label}: exported SVG has too few labels`);
  assert(svg.includes('viewBox='), `${label}: exported SVG missing viewBox`);
  assert(!svg.includes('var(--'), `${label}: exported SVG leaked CSS variables`);
}

function assertHistogramSvg(svg, label) {
  assert((svg.match(/<rect/g) ?? []).length >= 20, `${label}: histogram SVG has too few rects`);
  assert((svg.match(/<text/g) ?? []).length >= 1, `${label}: histogram SVG has no text`);
  assert(svg.includes('viewBox='), `${label}: histogram SVG missing viewBox`);
  assert(!svg.includes('var(--'), `${label}: histogram SVG leaked CSS variables`);
}

function assertValuesCsv(csv) {
  const lines = csv.trimEnd().split('\n');
  const header = 'edge_id, vertex_a, vertex_b, kind, quotient_edge, ollivier_num, ollivier_den, ollivier, v_inf, k_eff, converged, iterations, ollivier_evidence, effective_evidence, termination, rounding, variance_bound_exact_arithmetic, curvature_bound_exact_arithmetic';
  assert(lines[0] === header, 'values CSV header mismatch');
  const rows = lines.slice(1);
  assert(rows.length === 12, `values CSV row count mismatch: ${rows.length}`);
  for (const [index, row] of rows.entries()) {
    const cells = row.split(',').map((cell) => cell.trim());
    assert(cells.length === 18, `values CSV row ${index + 1} column count mismatch: ${cells.length}`);
    assert(cells.slice(12).join(',') === 'exact-rational,truncated-sum,estimated-tail-tolerance,unverified-floating-point,lower,upper', `values CSV evidence mismatch: ${cells.slice(12)}`);
    assert(cells[3] === 'bond', `values CSV row ${index + 1} kind mismatch`);
    assert(cells[5] === '1' && cells[6] === '3', `values CSV row ${index + 1} Ollivier fraction mismatch`);
    assert(Math.abs(Number(cells[9]) - 0.5440167) < 1e-6, `values CSV row ${index + 1} k_eff mismatch: ${cells[9]}`);
  }
}

const server = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
  cwd: new URL('..', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '0' },
  detached: true
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  await waitForServer(baseUrl);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.addInitScript(() => { if(sessionStorage.getItem('qa:reset-on-load') === '1') { localStorage.clear(); sessionStorage.removeItem('qa:reset-on-load'); } });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await resetPage(page);
  await safeScreenshot(page, '01-empty.png');

  assert(await page.getByText('Draw with').isVisible(), 'empty-state hint missing');
  assert(await page.evaluate(() => document.fonts.check('12px Inter')), 'Inter font did not load');

  await page.getByRole('button', { name: 'Menu' }).click();
  assert(await page.getByRole('button', { name: 'New project', exact: true }).isEnabled(), 'New project also starts a fresh identity on an empty canvas');
  assert(await page.getByRole('button', { name: 'Clear canvas', exact: true }).last().isDisabled(), 'Empty canvas should not be cleared again');
  await page.getByRole('button', { name: 'Menu' }).click();

  await page.mouse.click(640, 410);
  await assertVertexNear(page, { x: 640, y: 410 }, 'empty hint click');

  await resetPage(page);
  await page.mouse.move(300, 560);
  await page.mouse.wheel(0, -700);
  await page.mouse.click(960, 260);
  await assertVertexNear(page, { x: 960, y: 260 }, 'off-center wheel then click');

  await resetPage(page);
  await page.mouse.move(300, 560);
  await page.mouse.wheel(0, -700);
  const dragStart = { x: 880, y: 300 };
  const dragEnd = { x: 1040, y: 430 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 3 });
  await page.mouse.up();
  await assertBondNear(page, dragStart, dragEnd, 'off-center wheel then drag');

  await resetPage(page);
  await page.getByRole('button', { name: 'Cube' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-edge-line="bond"]').length >= 12);
  await page.waitForFunction(() => [...document.querySelectorAll('.edge-label')].length >= 12);
  await safeScreenshot(page, '02-cube.png');

  const geometry = await page.evaluate(() => {
    const vertices = new Map([...document.querySelectorAll('[data-vertex-id]')].map((node) => [node.getAttribute('data-vertex-id'), { x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }]));
    const lines = [...document.querySelectorAll('[data-edge-line="bond"]')].map((line) => ({
      x1: Number(line.getAttribute('x1')),
      y1: Number(line.getAttribute('y1')),
      x2: Number(line.getAttribute('x2')),
      y2: Number(line.getAttribute('y2'))
    }));
    return { vertexCount: vertices.size, lines };
  });
  assert(geometry.vertexCount === 8, `cube vertex count mismatch: ${geometry.vertexCount}`);
  assert(geometry.lines.length === 12, `cube line count mismatch: ${geometry.lines.length}`);
  for (let i = 0; i < geometry.lines.length; i += 1) {
    for (let j = i + 1; j < geometry.lines.length; j += 1) {
      const a = { x: geometry.lines[i].x1, y: geometry.lines[i].y1 };
      const b = { x: geometry.lines[i].x2, y: geometry.lines[i].y2 };
      const c = { x: geometry.lines[j].x1, y: geometry.lines[j].y1 };
      const d = { x: geometry.lines[j].x2, y: geometry.lines[j].y2 };
      const shared = (Math.hypot(a.x - c.x, a.y - c.y) < 1e-6) || (Math.hypot(a.x - d.x, a.y - d.y) < 1e-6) || (Math.hypot(b.x - c.x, b.y - c.y) < 1e-6) || (Math.hypot(b.x - d.x, b.y - d.y) < 1e-6);
      if (!shared) assert(!segmentsIntersect(a, b, c, d), `cube edges ${i} and ${j} cross`);
    }
  }

  await page.mouse.click(260, 200);
  await page.getByText('1 isolated vertex — curvature not defined there').waitFor();
  assert((await page.locator('[data-isolated-vertex-id]').count()) === 1, 'isolated vertex ring missing');
  await page.waitForTimeout(2000);
  assert(!(await page.locator('.computing-chip').isVisible().catch(() => false)), 'computing chip stuck after isolated vertex add');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await page.waitForFunction(() => !document.body.textContent?.includes('isolated vertex') && document.querySelectorAll('[data-isolated-vertex-id]').length === 0);

  await page.getByRole('button', { name: 'Metric' }).click();
  await page.getByRole('button', { name: /Ollivier/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.edge-label')].some((node) => node.textContent?.includes('+0.33')));
  await safeScreenshot(page, '03-ollivier.png');

  await page.getByRole('button', { name: 'Save & export' }).click();
  assert(!(await page.getByRole('button', { name: /^SVG \(vector\)/ }).isDisabled()), 'document SVG export row should be enabled after stamping a cube');
  assert(!(await page.getByRole('button', { name: /^PNG \((?:2×|figure size)\)/ }).isDisabled()), 'document PNG export row should be enabled after stamping a cube');
  assert(await page.getByRole('button', { name: /^Results table & downloads/ }).isEnabled(), 'Results export route missing');
  assert(!(await page.getByRole('button', { name: /^Histogram SVG/ }).isDisabled()), 'histogram SVG export row should be enabled after stamping a cube');
  assert(!(await page.getByRole('button', { name: /^Histogram PNG/ }).isDisabled()), 'histogram PNG export row should be enabled after stamping a cube');

  await page.getByRole('button', { name: /^Results table & downloads/ }).click();
  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  assertValuesCsv(await readDownloadText(await csvDownloadPromise));
  await page.getByRole('button', { name: 'Close results', exact: true }).click();

  const popoverSvgDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save & export' }).click();
  await page.getByRole('button', { name: /^SVG \(vector\)/ }).click();
  assertExportedSvg(await readDownloadText(await popoverSvgDownloadPromise), 'popover SVG');

  const histogramSvgDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save & export' }).click();
  await page.getByRole('button', { name: /^Histogram SVG/ }).click();
  assertHistogramSvg(await readDownloadText(await histogramSvgDownloadPromise), 'histogram SVG');

  const pngDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save & export' }).click();
  await page.getByRole('button', { name: /^PNG \((?:2×|figure size)\)/ }).click();
  const pngDownload = await pngDownloadPromise;
  const pngStream = await pngDownload.createReadStream();
  const pngChunks = [];
  for await (const chunk of pngStream) pngChunks.push(chunk);
  const png = Buffer.concat(pngChunks);
  assert(png[0] === 0x89 && png.toString('ascii', 1, 4) === 'PNG', 'exported PNG has invalid signature');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.getByRole('heading', { name: 'Templates' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.drawer'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save & export' }).click();
  await page.getByRole('button', { name: /^SVG \(vector\)/ }).click();
  assertExportedSvg(await readDownloadText(await downloadPromise), 'overflow SVG');

  // Round 10 selection-paint regression and per-view v2 style round trips.
  await page.getByRole('button', { name: 'Clear canvas' }).click();
  await page.getByRole('button', { name: 'Cube' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 8);
  await page.getByRole('button', { name: 'Display settings' }).click();
  const settingsPanel = page.getByRole('dialog', { name: 'Display settings' });
  assert(await settingsPanel.getByRole('button', { name: '2D', exact: true }).evaluate((node) => node.classList.contains('active')), 'style panel did not default to current 2D view');
  await page.getByRole('textbox', { name: 'Vertex fill hex' }).fill('#FF0000');
  await page.getByRole('textbox', { name: 'Vertex fill hex' }).press('Enter');
  await page.getByRole('slider', { name: 'Bond width' }).fill('3.5');
  assert(await page.evaluate(() => {
    const style = JSON.parse(localStorage.getItem('curvature-studio:style'));
    return style.view2d.bondWidth === 3.5 && style.view3d.bondWidth === 2;
  }), '2D bond width leaked into 3D style');
  await page.getByRole('button', { name: 'Close display settings' }).click();
  assert(await page.locator('[data-vertex-id]').evaluateAll((nodes) => nodes.length === 8 && nodes.every((node) => node.getAttribute('fill') === '#FF0000')), 'selected vertex paint is masked in 2D');
  assert(await page.locator('[data-vertex-selection-halo]').count() === 8, 'selected vertex halo rings are missing');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByText('Compatibility formats', { exact: true }).click();
  const styleDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export style' }).click();
  const styleText = await readDownloadText(await styleDownloadPromise);
  const exportedStyle = JSON.parse(styleText);
  assert(exportedStyle.version === 2 && exportedStyle.style.view2d.vertexFill.color === '#FF0000' && exportedStyle.style.view3d.vertexFill.color !== '#FF0000', 'style export is not a scoped v2 payload');
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('button', { name: 'Reset all' }).click();
  await page.getByRole('button', { name: 'Close display settings' }).click();
  await page.locator('[data-testid="style-file-input"]').setInputFiles({ name: 'curvature-style.json', mimeType: 'application/json', buffer: Buffer.from(styleText) });
  await page.getByText('Style imported').last().waitFor();
  assert(await page.evaluate(() => {
    const style = JSON.parse(localStorage.getItem('curvature-studio:style'));
    return style.view2d.vertexFill.color === '#FF0000' && style.view2d.bondWidth === 3.5 && style.view3d.bondWidth === 2;
  }), 'v2 style import did not restore scoped settings');

  const legacyStyle = {
    format: 'curvature-studio/style', version: 1,
    style: { labelScale: 1, vertexFill: { enabled: true, color: '#00AA55' }, vertexOutline: { enabled: true, color: '#FFFFFF' }, vertexSize: 4.5, vertexOutlineWidth: 1.5, verticesHidden: false, bondStyle: 'single', bondCasing: { enabled: false, color: '#FFFFFF' }, bondCasingWidth: 1.5, braceColor: '#2A2D31', braceStyle: 'double', bondWidth: 2, metricGradients: { keff: { type: 'preset', preset: 'studio' }, ollivier: { type: 'preset', preset: 'studio' } } },
    customGradients: []
  };
  await page.locator('[data-testid="style-file-input"]').setInputFiles({ name: 'legacy-style.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyStyle)) });
  await page.getByText('Style imported').last().waitFor();
  assert(await page.evaluate(() => {
    const style = JSON.parse(localStorage.getItem('curvature-studio:style'));
    return style.view2d.vertexFill.color === '#00AA55' && style.view3d.vertexFill.color === '#00AA55';
  }), 'v1 style import did not migrate to both views');

  // Round 9 full-session round trip, including a one-step document undo.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByText('Compatibility formats', { exact: true }).click();
  const sessionDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save session' }).click();
  const sessionText = await readDownloadText(await sessionDownloadPromise);
  await page.getByRole('button', { name: 'Clear canvas' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 0);
  await page.locator('[data-testid="session-file-input"]').setInputFiles({ name: 'curvature-session.json', mimeType: 'application/json', buffer: Buffer.from(sessionText) });
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 8 && document.querySelectorAll('[data-edge-line="bond"]').length === 12);
  await page.waitForFunction(() => document.querySelectorAll('.edge-label').length >= 12);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 0);

  // Round 9 polyhedron import, persistence, stamping, and deletion.
  const tetrahedron = { format: 'curvature-studio/polyhedron', version: 1, name: 'Smoke tetrahedron', vertices: [[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]], faces: [[0,1,2],[0,3,1],[0,2,3],[1,3,2]] };
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.locator('[data-testid="polyhedron-file-input"]').setInputFiles({ name: 'tetrahedron.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tetrahedron)) });
  await page.waitForFunction(() => document.querySelectorAll('[data-vertex-id]').length === 4);
  await page.getByText('Imported', { exact: true }).waitFor();
  await page.getByText('Smoke tetrahedron', { exact: true }).first().waitFor();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete Smoke tetrahedron' }).click();
  await page.waitForFunction(() => !document.body.textContent?.includes('Smoke tetrahedron'));

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Ortho' }).waitFor();
  await page.getByRole('button', { name: 'Ortho' }).click();
  await page.waitForFunction(() => localStorage.getItem('curvature-studio:projection') === 'orthographic');
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Ortho' }).waitFor();
  assert(await page.getByRole('button', { name: 'Ortho' }).evaluate((node) => node.classList.contains('active')), 'orthographic projection did not persist');
  await page.waitForFunction(() => document.body.textContent?.includes('3D view unavailable') || Boolean(document.querySelector('canvas')));
  const fallback = page.getByText('3D view unavailable');
  const canvas = page.locator('canvas');
  if (await fallback.isVisible().catch(() => false)) {
    console.log('SKIPPED: no WebGL; fallback panel verified');
  } else {
    await canvas.waitFor({ state: 'visible', timeout: 5000 });
    const nonblank = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl.length > 1000;
    });
    assert(nonblank, '3D canvas capture appears blank');
  }
  await safeScreenshot(page, '04-3d.png');

  await browser.close();
  console.log('qa:smoke passed');
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
}
