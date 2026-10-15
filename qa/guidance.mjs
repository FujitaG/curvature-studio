import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.env.HOME}/.cache/ms-playwright`;
if (process.env.PLAYWRIGHT_BROWSERS_PATH === '/ms-playwright') process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5192';
const artifacts = new URL('./artifacts/guidance/', import.meta.url);
mkdirSync(artifacts, { recursive: true }); rmSync(new URL('report.json', artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, viewports: [], preferences: false, errors: [] };
const button = name => page.getByRole('button', { name, exact: true });
const saved = () => page.getByText('Saved in browser', { exact: true }).waitFor();
const reachable = async locator => assert(await locator.evaluate(el => {
  const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && (el === hit || el.contains(hit));
}), `${await locator.getAttribute('aria-label') ?? await locator.innerText()} is covered or off-screen`);
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(output || 'Preview did not start');
    await new Promise(r => setTimeout(r, 150));
  }
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1280,900], [768,844], [390,844], [320,844], [844,390]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(baseUrl); await button('Cube').waitFor(); await page.waitForTimeout(300);
    const guide = page.getByRole('region', { name: 'Interaction guide', exact: true });
    assert.equal(await page.locator('dialog[open]').count(), 0, 'No modal on arrival');
    assert(await guide.getByRole('status').isVisible());
    assert(await guide.getByRole('group', { name: 'Quick shortcuts' }).isVisible());
    for (const name of ['Cube', 'K₄', 'Collapse interaction guide', 'Hide interaction guide', 'Open full guide']) await reachable(button(name));
    await reachable(page.getByRole('button', { name: /Bond — B/ }));
    assert(await button('Expand histogram').isVisible(), 'Empty histogram starts compact');
    const first = { width, height, guide: await guide.boundingBox(), start: await button('Cube').boundingBox() };
    await page.screenshot({ path: new URL(`arrival-${width}.png`, artifacts).pathname });
    await button('Open full guide').click(); await page.getByRole('dialog', { name: 'Quick guide' }).waitFor();
    await page.keyboard.press('Escape'); assert(await button('Open full guide').evaluate(el => el === document.activeElement));
    await button('Cube').click(); await saved(); await button('Fit view').click(); await page.waitForTimeout(350);
    assert(await button('Collapse histogram').isVisible(), 'Distribution expands when a graph exists');
    const visible = await page.locator('[data-vertex-id]').evaluateAll(vertices => vertices.map(v => {
      const r = v.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit?.closest('[data-graph-canvas]');
    }));
    assert.equal(visible.length, 8); assert(visible.every(Boolean), `Fit vertices covered at ${width}`);
    await reachable(button('Hide histogram')); await reachable(button('Hide interaction guide'));
    await page.screenshot({ path: new URL(`cube-${width}.png`, artifacts).pathname });
    report.viewports.push(first);
    if (width === 1280) {
      await button('Collapse interaction guide').click(); await saved(); await page.reload();
      await button('Expand interaction guide').waitFor(); await button('Expand interaction guide').click();
      await button('Hide interaction guide').click(); await saved(); await page.reload(); await saved();
      assert.equal(await guide.count(), 0, 'Respect a returning user’s hidden guide');
      await button('Panels').click(); await page.getByRole('checkbox', { name: 'Interaction guide', exact: true }).check(); await page.keyboard.press('Escape');
      await button('Collapse interaction guide').waitFor();
      await button('Panels').click(); await page.getByRole('checkbox', { name: 'Keyboard shortcuts in guide', exact: true }).uncheck(); await page.keyboard.press('Escape');
      assert.equal(await guide.getByRole('group', { name: 'Quick shortcuts' }).count(), 0);
      await button('Panels').click(); await button('Restore default panels').click(); await button('Close Panels').click();
      assert(await guide.getByRole('group', { name: 'Quick shortcuts' }).isVisible());
      await button('Collapse interaction guide').waitFor(); report.preferences = true;
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: new URL('failure.png', artifacts).pathname });
  throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
