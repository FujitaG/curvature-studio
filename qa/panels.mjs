import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5185';
const artifacts = new URL('./artifacts/panels/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5185', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
let output = '', browser;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    if (server && server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(baseUrl)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseUrl);
  const button = name => page.getByRole('button', { name, exact: true });
  const type = async (locator, value) => { await locator.click(); await locator.press('ControlOrMeta+A'); await locator.press('Backspace'); await locator.pressSequentially(value); };
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved in browser');
  const capture = () => page.evaluate(async () => (await import('/src/project/workspace.ts')).captureProject());
  const open = async project => {
    await page.getByTestId('project-file-input').setInputFiles({ name: 'figure.curvature.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelector('[data-testid="project-file-input"]').value === '');
    await waitForBrowser(page, async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return !!s.results && !s.computing; });
    await saved();
  };
  const download = async locator => {
    const event = page.waitForEvent('download'); await locator.click();
    const file = await event; assert.equal(await file.failure(), null); return readFileSync(await file.path());
  };
  const base = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
  await open(base);
  const original = await page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { doc: (await import('/src/project/workspace.ts')).captureProject().session.doc, values: s.results.values, key: s.results.key }; });
  const hist = page.getByRole('region', { name: 'Histogram', exact: true });
  await hist.locator('summary').click();
  assert.equal((await capture()).session.style.shared.metricGradients.keff.type, 'preset');
  await hist.getByRole('button', { name: 'Use threshold colors', exact: true }).click();
  const threshold = hist.getByRole('slider', { name: 'Adjust color threshold', exact: true });
  await threshold.focus(); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  assert.equal(Number(await threshold.inputValue()), .55); assert(await threshold.evaluate(el => el === document.activeElement));
  const marker = await hist.locator('.hist-threshold-marker line').last().getAttribute('x1');
  await threshold.press('ArrowRight'); assert.notEqual(await hist.locator('.hist-threshold-marker line').last().getAttribute('x1'), marker);
  // Actual continuous pointer drag on the range changes colors without dragging the panel.
  const hb = await hist.boundingBox(), slider = await threshold.boundingBox();
  await page.mouse.move(slider.x + slider.width * .55, slider.y + slider.height / 2); await page.mouse.down();
  await page.mouse.move(slider.x + slider.width * .8, slider.y + slider.height / 2, { steps: 12 }); await page.mouse.up();
  assert(Number(await threshold.inputValue()) > .7); assert.deepEqual(await hist.boundingBox(), hb);
  await hist.getByRole('slider', { name: 'Adjust transition width' }).focus(); await page.keyboard.press('Home');
  assert.equal(Number(await hist.getByRole('slider', { name: 'Adjust transition width' }).inputValue()), 0);
  await hist.getByRole('textbox', { name: 'Color threshold', exact: true }).fill('-');
  await hist.getByRole('textbox', { name: 'Color threshold', exact: true }).press('Enter');
  assert.equal(await hist.getByRole('textbox', { name: 'Color threshold', exact: true }).getAttribute('aria-invalid'), 'true');
  await hist.getByRole('textbox', { name: 'Color threshold', exact: true }).fill('.6'); await hist.getByRole('textbox', { name: 'Color threshold', exact: true }).press('Enter');
  const computed = await page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { doc: (await import('/src/project/workspace.ts')).captureProject().session.doc, values: s.results.values, key: s.results.key }; }); assert.deepEqual(computed, original);
  await button('Display settings').click();
  const settings = page.getByRole('dialog', { name: 'Display settings' });
  assert.equal(await settings.getByRole('textbox', { name: 'Color threshold', exact: true }).inputValue(), '0.6');
  await settings.getByRole('textbox', { name: 'Transition width', exact: true }).fill('.1'); await settings.getByRole('textbox', { name: 'Transition width', exact: true }).press('Enter');
  await settings.getByRole('button', { name: 'Adjust threshold with histogram' }).click();
  assert.equal(Number(await hist.getByRole('slider', { name: 'Adjust transition width' }).inputValue()), .1);
  // Each metric keeps its own range and saved threshold.
  await button('Metric').click(); await page.locator('.metric-menu button').filter({ hasText: 'Ollivier–Ricci curvature' }).click();
  await hist.getByRole('button', { name: 'Use threshold colors' }).click();
  const ollivierSlider = hist.getByRole('slider', { name: 'Adjust color threshold', exact: true });
  assert.equal(await ollivierSlider.getAttribute('min'), '-1');
  await ollivierSlider.focus(); await page.keyboard.press('ArrowLeft'); assert.equal(Number(await ollivierSlider.inputValue()), -.01);
  await button('Metric').click(); await page.locator('.metric-menu button').filter({ hasText: 'Effective curvature' }).click();
  assert.equal(Number(await threshold.inputValue()), .6);
  // An explicit palette reset is different from closing the panel.
  await hist.getByRole('button', { name: 'Use default colors' }).click();
  assert.equal((await capture()).session.style.shared.metricGradients.keff.type, 'preset');
  await hist.getByRole('button', { name: 'Use threshold colors' }).click();
  const color = (await capture()).session.style.shared.metricGradients;
  await button('Hide histogram').click(); await button('Panels').click();
  const panels = page.getByRole('dialog', { name: 'Panels', exact: true });
  assert(!(await panels.getByRole('checkbox', { name: 'Histogram', exact: true }).isChecked()));
  await panels.getByRole('checkbox', { name: 'Histogram', exact: true }).check(); await page.keyboard.press('Escape');
  assert(await button('Panels').evaluate(el => el === document.activeElement));
  assert.deepEqual((await capture()).session.style.shared.metricGradients, color);
  assert(await button('Collapse interaction guide').isVisible(), 'Guide starts expanded');
  const guide = page.getByRole('region', { name: 'Interaction guide', exact: true });
  assert(await guide.getByRole('status').isVisible());
  assert.equal(await page.locator('.legend,.tool-hint,.orbit-hint').count(), 0);
  // Move both panels using real drag events. Saved positions update only on release.
  for (const [region, title] of [[hist, 'Move histogram'], [guide, 'Move interaction guide']]) {
    const handle = region.getByLabel(title), before = await region.boundingBox(), h = await handle.boundingBox();
    const start = await capture();
    await page.mouse.move(h.x + 24, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(h.x + 144, h.y + h.height / 2 - 130, { steps: 12 });
    const during = await capture(); assert.deepEqual(during.session.histogramPos, start.session.histogramPos); assert.deepEqual(during.session.panelLayout.guide.position, start.session.panelLayout.guide.position);
    await page.mouse.up();
    assert.notDeepEqual(await region.boundingBox(), before);
    await handle.focus(); await page.keyboard.press('ArrowLeft'); assert(await handle.evaluate(el => el === document.activeElement));
  }
  await saved(); const exported = JSON.parse(await download(button('Save project')));
  await page.reload(); await saved();
  assert.deepEqual((await capture()).session.panelLayout, exported.session.panelLayout);
  assert.deepEqual((await capture()).session.histogramPos, exported.session.histogramPos);
  await open(exported);
  assert.deepEqual((await capture()).session.panelLayout, exported.session.panelLayout);
  await button('Hide interaction guide').click(); assert.equal(await guide.count(), 0);
  await button('Panels').click(); await panels.getByRole('checkbox', { name: 'Interaction guide', exact: true }).check(); await page.keyboard.press('Escape');
  // A manual camera and graph stay unchanged when restoring panel defaults.
  await page.evaluate(async () => { (await import('/src/state/store.ts')).useStudioStore.setState({ camera2dMode: 'manual' }); });
  const beforeReset = (await capture()).session.camera2d;
  await button('Panels').click(); await panels.getByRole('button', { name: 'Restore default panels' }).click(); await button('Close Panels').click();
  assert.deepEqual((await capture()).session.camera2d, beforeReset);
  assert.equal((await capture()).session.panelLayout.guide.collapsed, false);
  // All controls stay reachable on narrow and short screens, including after moving.
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await hist.locator('summary').click();
    if (!(await hist.locator('details').getAttribute('open') !== null)) await hist.locator('summary').click();
    await hist.getByRole('slider', { name: 'Adjust color threshold', exact: true }).scrollIntoViewIfNeeded();
    await hist.getByRole('slider', { name: 'Adjust color threshold', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
    await button('Hide histogram').click(); await button('Panels').click(); await panels.getByRole('checkbox', { name: 'Histogram', exact: true }).check(); await page.keyboard.press('Escape');
    for (const title of ['Move histogram','Move interaction guide']) {
      const handle = page.getByLabel(title); const r = await handle.boundingBox();
      assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height, `${title} outside ${JSON.stringify(viewport)}: ${JSON.stringify(r)}`);
    }
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await page.waitForTimeout(250);
    for (const name of ['Hide histogram','Hide interaction guide']) {
      const clear = await button(name).evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit); });
      assert(clear, `${name} is covered at ${viewport.width}`);
    }
    await page.screenshot({ path: new URL(`panels-${viewport.width}.png`, artifacts).pathname });
  }
  assert.deepEqual(errors, []);
  const report = { integratedThreshold: true, continuousKeyboardAndDrag: true, graphAndResultsUnchanged: true, synchronizedSettings: true, panelPositionsRoundTrip: true, closeAndRestore: true, keyboardMovement: true, responsive: [1280,390,320,844], errors };
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: new URL('failure.png', artifacts).pathname }); writeFileSync(new URL('failure.html', artifacts), await page.content()); }
  throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
