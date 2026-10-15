import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitForBrowser } from './wait.mjs';
process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5183';
const artifacts = new URL('./artifacts/figures/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
const server = process.env.QA_BASE_URL ? null : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
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
  await button('Display settings').click();
  await page.getByRole('combobox', { name: 'Metric gradient preset' }).selectOption('draft');
  const name = page.locator('.gradient-editor .style-text-input');
  await type(name, 'Paper blue'); await button('Save').click();
  await type(name, 'Paper green'); assert.equal(await name.inputValue(), 'Paper green');
  await button('Save').click();
  const slider = page.getByRole('slider', { name: 'Stop 2 position', exact: true });
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await slider.inputValue(), '60'); assert(await slider.evaluate(el => el === document.activeElement));
  // Cross a neighboring row: focus and element identity must follow the moving stop.
  const first = page.getByRole('slider', { name: 'Stop 1 position', exact: true });
  await first.evaluate(el => el.setAttribute('data-test-moving-stop', 'true')); await first.focus();
  for (let i = 0; i < 70; i++) await page.keyboard.press('ArrowRight');
  const moving = page.locator('[data-test-moving-stop]');
  assert.equal(await moving.inputValue(), '70'); assert(await moving.evaluate(el => el === document.activeElement));
  const rect = await moving.boundingBox();
  await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .85, rect.y + rect.height / 2, { steps: 12 }); await page.mouse.up();
  assert(Number(await moving.inputValue()) > 75, 'Continuous drag stopped updating');
  const number = page.getByRole('spinbutton', { name: 'Stop 2 position percent', exact: true });
  await type(number, '63'); await number.press('Enter'); assert.equal(await number.inputValue(), '63');
  await button('Close display settings').click(); await saved(); await page.reload();
  await button('Display settings').click(); assert.equal(await name.inputValue(), 'Paper green');
  await button('Close display settings').click();
  // The Ollivier midpoint remains fixed while other stops cross it without disappearing.
  await page.evaluate(async () => (await import('/src/state/store.ts')).useStudioStore.getState().setMetric('ollivier'));
  await button('Display settings').click(); await page.getByRole('combobox', { name: 'Metric gradient preset' }).selectOption('draft');
  const fixed = page.getByRole('slider', { name: 'Stop 2 position', exact: true }); assert(await fixed.isDisabled());
  await type(name, 'Paper green'); await button('Save').click();
  const left = page.getByRole('slider', { name: 'Stop 1 position', exact: true });
  await left.evaluate(el => el.setAttribute('data-test-ollivier', 'true')); await left.focus();
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-test-ollivier]').inputValue(), '51');
  assert.equal(await page.locator('.gradient-stops input[type="range"]:disabled').inputValue(), '50');
  assert.equal(await page.locator('.gradient-stops input[type="range"]').count(), 3);
  await button('Close display settings').click();
  const base = JSON.parse(readFileSync(new URL('../examples/cube-study.curvature.json', import.meta.url), 'utf8'));
  base.session.view = '2d'; base.session.metric = 'ollivier'; base.session.style.view2d.labelScale = 2;
  base.session.style.view2d.vertexFill = { enabled: true, color: '#FF0000' };
  base.session.style.view2d.vertexOutline = { enabled: false, color: '#FFFFFF' };
  let referenceSvg, referencePng;
  const cases = [];
  for (const scale of [0.1, 1, 5, 100, 1000]) {
    const input = structuredClone(base);
    input.session.doc.vertices = [{ id: 1, x: 0, y: 0 }, { id: 2, x: scale, y: 0 }];
    input.session.doc.edges = [{ id: 1, a: 1, b: 2, kind: 'bond' }];
    await open(input); await button('Fit view').click();
    await button('Save & export').click(); const svg = await download(page.getByRole('button', { name: /^SVG \(vector\)/ }));
    await button('Save & export').click(); const png = await download(page.getByRole('button', { name: /^PNG \(figure size\)/ }));
    referenceSvg ??= svg; referencePng ??= png;
    assert(svg.equals(referenceSvg), `SVG proportions differ at scale ${scale}`);
    assert(png.equals(referencePng), `PNG pixels differ at scale ${scale}`);
    cases.push({ scale, svgBytes: svg.length, pngBytes: png.length });
  }
  // Inspect the actual downloaded PNG: two separate red disks with readable graph spacing.
  const pixels = await page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const columns = [];
    for (let x = 0; x < img.width; x++) { let red = 0; for (let y = 0; y < img.height; y++) { const i = (y * img.width + x) * 4; if (data[i] > 240 && data[i + 1] < 30 && data[i + 2] < 30) red++; } if (red > 5) columns.push(x); }
    const groups = []; for (const x of columns) { const group = groups.at(-1); if (group && x === group.at(-1) + 1) group.push(x); else groups.push([x]); }
    return { width: img.width, height: img.height, groups: groups.map(g => [g[0], g.at(-1)]), corner: [...data.slice(0, 4)] };
  }, referencePng.toString('base64'));
  assert.equal(pixels.width, 1417); assert.equal(pixels.height, 1063); assert.equal(pixels.groups.length, 2);
  assert(pixels.groups[1][0] - pixels.groups[0][1] > 400); assert(pixels.groups.every(([a, b]) => b - a > 20 && b - a < 35));
  assert.deepEqual(pixels.corner, [255, 255, 255, 255]);
  writeFileSync(new URL('small-edge.svg', artifacts), referenceSvg); writeFileSync(new URL('small-edge.png', artifacts), referencePng);
  await button('Save & export').click(); await page.getByRole('button', { name: /^Figure setup \(2D\)/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Figure setup (2D)' });
  await type(dialog.getByLabel('Width (mm)', { exact: true }), '100'); await type(dialog.getByLabel('Height (mm)', { exact: true }), '80');
  await type(dialog.getByLabel('PNG DPI'), '254'); await dialog.getByLabel('Background', { exact: true }).selectOption('transparent');
  await dialog.getByLabel('Label format').selectOption('fraction');
  const figureSvg = await download(button('Download figure SVG'));
  const figurePng = await download(button('Download figure PNG'));
  assert(figureSvg.toString().includes('width="100mm"')); assert(figureSvg.toString().includes('>1/1</text>'));
  const transparent = await page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return { width: img.width, height: img.height, corner: [...ctx.getImageData(0, 0, 1, 1).data] };
  }, figurePng.toString('base64'));
  assert.deepEqual(transparent, { width: 1000, height: 800, corner: [0, 0, 0, 0] });
  const previewSvg = await dialog.getByAltText('Figure export preview').getAttribute('src');
  assert.equal(decodeURIComponent(previewSvg.split(',').slice(1).join(',')), figureSvg.toString());
  // Current range is captured once, saved, and stable after viewport changes / reopen.
  await dialog.getByLabel('Output range').selectOption('current'); await button('Save figure settings').click();
  const currentSvg = await download(button('Download figure SVG'));
  const before = await capture(); assert.equal(before.figure.range, 'current'); assert(before.figure.frame.width > 0);
  await button('Close Figure setup (2D)').click(); await saved();
  const projectFile = await download(button('Save project')); const stored = JSON.parse(projectFile.toString()); assert.deepEqual(stored.figure, before.figure);
  await page.reload(); await saved(); assert.deepEqual((await capture()).figure, before.figure);
  await open(stored); assert.deepEqual((await capture()).figure, before.figure);
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await button('Save & export').click(); await page.getByRole('button', { name: /^Figure setup \(2D\)/ }).click();
    assert.equal(decodeURIComponent((await dialog.getByAltText('Figure export preview').getAttribute('src')).split(',').slice(1).join(',')), currentSvg.toString(), 'Saved current range changed after reload / viewport resize');
    const controls = await dialog.locator('input,select,button').evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; }));
    assert(controls.every(r => r.x >= 0 && r.right <= size.width), `Figure controls clipped at ${size.width}`);
    await dialog.screenshot({ path: new URL(`setup-${size.width}.png`, artifacts).pathname });
    await button('Close Figure setup (2D)').click();
  }
  assert.deepEqual(errors, []);
  const report = { cases, pixels, transparent, gradientKeyboard: true, gradientDrag: true, fixedMidpoint: true, savedName: 'Paper green', figureRoundTrip: true, errors };
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: new URL('failure.png', artifacts).pathname }); writeFileSync(new URL('failure.html', artifacts), await page.content()); }
  throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
