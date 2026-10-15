import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5196';
const artifacts = new URL('./artifacts/results-scroll/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
for (const name of ['report.json', 'failure.png']) rmSync(new URL(name, artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5196', '--strictPort'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe' });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, startedAt: new Date().toISOString(), cases: [], errors: [] };
const button = name => page.getByRole('button', { name, exact: true });
function fixture(large) {
  const project = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url)));
  const vertices = [], edges = [];
  // Disconnected complete graphs exercise 3,000 *valued* rows without a costly large-component solve.
  const sizes = large ? [...Array(66).fill(10), 6, 6] : Array(4).fill(10);
  sizes.forEach((size, group) => {
    const start = vertices.length + 1;
    for (let i = 0; i < size; i++) vertices.push({ id: start + i, x: (group % 10) * 200 + Math.cos(i * 2 * Math.PI / size) * 60, y: Math.floor(group / 10) * 200 + Math.sin(i * 2 * Math.PI / size) * 60 });
    for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) edges.push({ id: edges.length + 1, a: start + a, b: start + b, kind: 'bond', weight: 1 });
  });
  project.session.doc.vertices = vertices; project.session.doc.edges = edges;
  project.metadata.title = `Continuous results ${edges.length}`;
  return project;
}
async function scrollEnd() {
  const wrap = page.locator('.results-table-wrap');
  await wrap.scrollIntoViewIfNeeded(); await wrap.focus(); await page.keyboard.press('Control+End');
  await page.waitForFunction(() => { const e = document.querySelector('.results-table-wrap'); return e.scrollTop + e.clientHeight >= e.scrollHeight - 2; });
  const bounds = await wrap.evaluate(e => {
    const r = e.getBoundingClientRect(), h = e.querySelector('thead').getBoundingClientRect(), last = e.querySelector('tbody tr:last-child').getBoundingClientRect();
    return { scrollTop: e.scrollTop, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight, sticky: Math.abs(h.top - r.top) < 3, lastVisible: last.bottom <= r.bottom + 1 && last.top >= h.bottom };
  });
  assert(bounds.scrollHeight > bounds.clientHeight); assert(bounds.sticky, 'Column headings must remain visible'); assert(bounds.lastVisible, 'Last row must be reachable');
  return bounds;
}
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(output || 'Preview did not start');
    await new Promise(r => setTimeout(r, 150));
  }
  browser = await chromium.launch({ headless: true }); report.browser = browser.version();
  for (const [width, height, large] of [[1280,900,true], [390,844,false], [320,844,false], [844,390,false]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(baseUrl);
    const project = fixture(large), count = project.session.doc.edges.length;
    await page.getByTestId('project-file-input').setInputFiles({ name: 'results.curvature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    const start = Date.now(); await button('Results').click();
    await page.getByText('Calculation complete.', { exact: true }).waitFor();
    await page.waitForFunction(n => document.querySelectorAll('.results-table tbody tr').length === n, count);
    const readyMs = Date.now() - start;
    assert.equal(await button('Next').count(), 0); assert.equal(await button('Previous').count(), 0);
    assert.equal(await page.locator('.results-count').textContent(), `${count} edges`);
    await button('Edge').click();
    const scroll = await scrollEnd();
    assert.equal(await page.locator('.results-table tbody tr').last().getByRole('button').getAttribute('aria-label'), `Locate edge e${count}`);
    await page.screenshot({ path: new URL(`${width}x${height}-last-row.png`, artifacts).pathname });
    const search = page.getByRole('searchbox', { name: 'Find an edge' });
    const searchStart = Date.now(); await search.fill(`e${count}`);
    await page.waitForFunction(() => document.querySelectorAll('.results-table tbody tr').length === 1);
    const searchMs = Date.now() - searchStart;
    assert.equal(await page.locator('.results-count').textContent(), `1 of ${count} edges`);
    assert.equal(await page.locator('.results-table-wrap').evaluate(e => e.scrollTop), 0);
    await search.fill('no-such-edge'); await page.getByText('No edges match these filters.').waitFor();
    await search.fill(''); await page.getByLabel('Show edges', { exact: true }).selectOption('attention');
    assert.equal(await page.locator('.results-table tbody tr').count(), 0);
    await page.getByLabel('Show edges', { exact: true }).selectOption('valued');
    assert.equal(await page.locator('.results-table tbody tr').count(), count);
    await button('Edge ↑').click();
    assert.equal(await page.locator('.results-table tbody tr').first().getByRole('button').getAttribute('aria-label'), `Locate edge e${count}`);
    assert.equal(await page.locator('.results-table-wrap').evaluate(e => e.scrollTop), 0);
    // Exports retain the whole document even when only a single filtered row is visible.
    await search.fill(`e${count}`);
    const pending = page.waitForEvent('download'); await button('Download results JSON').click();
    const downloaded = await pending; let body = ''; for await (const c of await downloaded.createReadStream()) body += c.toString();
    const data = JSON.parse(body); assert.equal(data.edges.length, count);
    await button(`Locate edge e${count}`).click();
    if (await button('Close results').isVisible()) await button('Close results').click();
    if (await button('Selection details').isVisible()) await button('Selection details').click();
    await page.getByText(`Bond e${count}`, { exact: true }).waitFor();
    report.cases.push({ width, height, count, readyMs, searchMs, scroll, exportedEdges: data.edges.length });
    await context.close();
  }
  assert.deepEqual(report.errors, []); report.finishedAt = new Date().toISOString();
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('failure.png', artifacts).pathname }); throw error;
} finally { await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
