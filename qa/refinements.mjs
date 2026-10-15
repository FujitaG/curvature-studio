import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5184';
const artifacts = new URL('./artifacts/refinements/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5184', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
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
  base.session.style.view2d.labelScale = 2;
  await open(base);
  const figureOpen = async () => { await button('Save & export').click(); await page.getByRole('button', { name: /^Figure setup \(2D\)/ }).click(); };
  await figureOpen();
  const dialog = page.getByRole('dialog', { name: 'Figure setup (2D)' });
  const state = page.getByTestId('figure-save-status');
  const isDirty = async () => assert.equal(await state.textContent(), 'Unsaved figure changes');
  const apply = async () => { await button('Save figure settings').click(); assert.equal(await state.textContent(), 'Figure settings saved in this project.'); };
  assert((await dialog.locator('.figure-actual-size').textContent()).includes('15.75 pt'));
  await apply();
  await dialog.getByLabel('Background', { exact: true }).selectOption('transparent'); await isDirty();
  await button('Close Figure setup (2D)').click(); await figureOpen();
  assert.equal(await dialog.getByLabel('Background', { exact: true }).inputValue(), 'white');
  await dialog.getByLabel('Background', { exact: true }).selectOption('transparent'); await apply();
  const changes = [
    ['Width (mm)', '130'], ['Height (mm)', '95'], ['Minimum margin (mm)', '7'], ['PNG DPI', '254'], ['Base label size (pt)', '8'], ['Figure decimal places', '3']
  ];
  for (const [name, value] of changes) { await type(dialog.getByLabel(name, { exact: true }), value); await isDirty(); await apply(); }
  for (const [name, value] of [['Font','serif'], ['Label format','fraction'], ['Output range','current']]) {
    await dialog.getByLabel(name, { exact: true }).selectOption(value); await isDirty(); await apply();
  }
  // Recapture same range is a no-op; a different camera range creates an unsaved draft.
  await button('Recapture current range').click(); assert.equal(await state.textContent(), 'Figure settings match this project.');
  await page.evaluate(async () => { const { useStudioStore: store } = await import('/src/state/store.ts'); const s = store.getState(); store.setState({ camera2dMode: 'manual', camera2d: { ...s.camera2d, tx: s.camera2d.tx + 20 } }); });
  await button('Recapture current range').click(); await isDirty(); await apply();
  await type(dialog.getByLabel('PNG DPI'), '72.5'); await isDirty(); assert(await button('Save figure settings').isDisabled());
  await type(dialog.getByLabel('PNG DPI'), '254'); assert.equal(await state.textContent(), 'Figure settings match this project.');
  const expectedFigure = (await capture()).figure;
  await button('Close Figure setup (2D)').click(); await saved(); await page.reload(); await saved(); await figureOpen();
  assert.deepEqual((await capture()).figure, expectedFigure);
  assert.equal(await dialog.getByLabel('Background', { exact: true }).inputValue(), 'transparent');
  await button('Close Figure setup (2D)').click();

  // Direct entry, checked state, keyboard and Escape focus restoration.
  await button('Hide histogram').click(); assert.equal(await page.locator('.histogram').count(), 0);
  await button('Panels').click();
  const panels = page.getByRole('dialog', { name: 'Panels', exact: true });
  const histogram = panels.getByRole('checkbox', { name: 'Histogram', exact: true });
  assert.equal(await histogram.isChecked(), false); await histogram.check(); assert.equal(await page.locator('.histogram').count(), 1);
  await page.keyboard.press('Escape'); assert(await button('Panels').evaluate(el => el === document.activeElement));
  await button('Panels').press('Enter'); assert(await histogram.evaluate(el => el === document.activeElement));
  await page.keyboard.press('Space'); assert.equal(await histogram.isChecked(), false);
  await page.keyboard.press('Escape'); await saved();
  const hiddenProject = await download(button('Save project')); assert.equal(JSON.parse(hiddenProject).session.panels.histogram, false);
  await page.reload(); await saved(); await button('Panels').click(); assert.equal(await histogram.isChecked(), false);
  await button('Close Panels').click();
  await page.evaluate(async () => { const { useStudioStore: s } = await import('/src/state/store.ts'); s.setState({ camera2dMode: 'manual', selection: [{ kind: 'edge', id: 1 }] }); });
  const beforeReset = await page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { camera: s.camera2d, selection: s.selection, doc: [...s.doc.edges.values()] }; });
  await button('Panels').click();
  for (const name of ['Inspector','Keyboard shortcuts in guide','Interaction guide','Edge labels']) await panels.getByRole('checkbox', { name, exact: true }).uncheck();
  await button('Restore default panels').click();
  for (const name of ['Histogram','Inspector','Keyboard shortcuts in guide','Interaction guide','Edge labels']) assert(await panels.getByRole('checkbox', { name, exact: true }).isChecked());
  await button('Close Panels').click(); await page.waitForTimeout(200);
  const afterReset = await page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { camera: s.camera2d, selection: s.selection, doc: [...s.doc.edges.values()] }; });
  assert.deepEqual(afterReset, beforeReset);
  await button('Results').click(); await button('Panels').click(); assert(await panels.getByRole('checkbox', { name: 'Results table', exact: true }).isChecked());
  await panels.getByRole('checkbox', { name: 'Results table', exact: true }).uncheck(); await button('Close Panels').click();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await button('Panels').click();
    const b = await button('Panels').boundingBox(); assert(b.x >= 0 && b.x + b.width <= viewport.width && b.y >= 0);
    const p = await panels.boundingBox(); assert(p.x >= 0 && p.x + p.width <= viewport.width && p.y + p.height <= viewport.height);
    await panels.screenshot({ path: new URL(`panels-${viewport.width}.png`, artifacts).pathname });
    await page.keyboard.press('Escape'); assert(await button('Panels').evaluate(el => el === document.activeElement));
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Color threshold changes appearance, not graph or result values, and exports the same colors.
  await open(base);
  const original = await page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { key: s.results.key, values: s.results.values }; });
  await button('Display settings').click();
  assert.equal(await page.getByText('Appearance only: single, double, and dashed lines do not change curvature. Use Structural role in the Inspector to change Bond or Brace.', { exact: true }).count(), 0);
  await page.getByRole('combobox', { name: 'Metric gradient preset' }).selectOption('threshold');
  await page.getByRole('combobox', { name: 'Color transition' }).selectOption('hard');
  await type(page.getByRole('textbox', { name: 'Color threshold', exact: true }), '.6'); await page.getByRole('textbox', { name: 'Color threshold', exact: true }).press('Enter');
  await button('Close display settings').click();
  await button('Save & export').click(); const lowSvg = await download(page.getByRole('button', { name: /^SVG \(vector\)/ })); assert(lowSvg.toString().includes('stroke="#3B4CC0"'));
  await button('Display settings').click(); await type(page.getByRole('textbox', { name: 'Color threshold', exact: true }), '.5'); await page.getByRole('textbox', { name: 'Color threshold', exact: true }).press('Enter');
  await button('Close display settings').click();
  await button('Save & export').click(); const highSvg = await download(page.getByRole('button', { name: /^SVG \(vector\)/ })); assert(highSvg.toString().includes('stroke="#B40426"'));
  const unchanged = await page.evaluate(async () => { const s = (await import('/src/state/store.ts')).useStudioStore.getState(); return { key: s.results.key, values: s.results.values }; }); assert.deepEqual(unchanged, original);
  await button('Display settings').click();
  const threshold = page.getByRole('textbox', { name: 'Color threshold', exact: true }); await type(threshold, '-'); await threshold.press('Enter'); assert.equal(await threshold.getAttribute('aria-invalid'), 'true');
  await type(threshold, '.55'); await threshold.press('Enter');
  await page.getByRole('combobox', { name: 'Color transition' }).selectOption('smooth');
  await type(page.getByRole('textbox', { name: 'Transition width', exact: true }), '.05'); await page.getByRole('textbox', { name: 'Transition width', exact: true }).press('Enter');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.display-settings-panel').screenshot({ path: new URL('threshold-390.png', artifacts).pathname });
  assert(await page.locator('.threshold-editor input, .threshold-editor select').evaluateAll(items => items.every(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth; })));
  await button('Close display settings').click(); await page.setViewportSize({ width: 1280, height: 900 }); await saved();
  const thresholdProject = JSON.parse(await download(button('Save project'))); await page.reload(); await saved();
  assert.deepEqual((await capture()).session.style.shared.metricGradients, thresholdProject.session.style.shared.metricGradients);
  await open(thresholdProject); assert.deepEqual((await capture()).session.style.shared.metricGradients, thresholdProject.session.style.shared.metricGradients);

  // Download the documented files and feed those exact bytes through the normal import UI.
  await button('Templates').click(); await page.getByRole('combobox', { name: 'Placement' }).selectOption('replace');
  await button('File format & examples').click();
  const guide = page.getByRole('dialog', { name: 'Polyhedron file format' });
  const json = await download(button('Download example JSON')); assert.equal(JSON.parse(json).format, 'curvature-studio/polyhedron');
  const schemaResponse = await page.request.get(`${baseUrl}/schemas/polyhedron-v1.schema.json`); assert(schemaResponse.ok()); assert.equal((await schemaResponse.json()).properties.format.const, 'curvature-studio/polyhedron');
  const chooserEvent = page.waitForEvent('filechooser'); await button('Choose polyhedron file…').click();
  await (await chooserEvent).setFiles({ name: 'tetrahedron.polyhedron.json', mimeType: 'application/json', buffer: json });
  await page.waitForFunction(() => document.querySelector('[data-testid="polyhedron-file-input"]').value === '');
  await waitForBrowser(page, async () => (await import('/src/state/store.ts')).useStudioStore.getState().doc.vertices.size === 4);
  assert.equal((await capture()).session.doc.edges.length, 6);
  await button('File format & examples').click(); await guide.getByText('TXT format (supported subset)', { exact: true }).click();
  const txt = await download(button('Download example TXT'));
  await page.setViewportSize({ width: 390, height: 844 }); await guide.screenshot({ path: new URL('import-guide-390.png', artifacts).pathname });
  await button('Close Polyhedron file format').click();
  await page.getByTestId('polyhedron-file-input').setInputFiles({ name: 'tetrahedron.txt', mimeType: 'text/plain', buffer: txt });
  await page.waitForFunction(() => document.querySelector('[data-testid="polyhedron-file-input"]').value === '');
  await saved(); assert.equal((await capture()).session.doc.vertices.length, 4); assert.equal((await capture()).session.doc.edges.length, 6);
  assert((await capture()).session.doc.edges.every(e => e.kind === 'bond'));
  assert.deepEqual(errors, []);
  const report = { figureSaveState: true, actualPt: 15.75, panelsDirectAndKeyboard: true, defaultPanelsPreserveManualCamera: true, thresholdsRoundTrip: true, thresholdValuesUnchanged: true, importExamples: ['json','txt'], errors };
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: new URL('failure.png', artifacts).pathname }); writeFileSync(new URL('failure.html', artifacts), await page.content()); }
  throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
