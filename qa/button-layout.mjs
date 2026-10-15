import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH = `${process.env.HOME}/.cache/ms-playwright`;
const { chromium } = await import('playwright');
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5195';
const artifacts = new URL('./artifacts/button-layout/', import.meta.url);
mkdirSync(artifacts, { recursive: true });
for (const name of ['report.json', 'failure.json', 'failure.png']) rmSync(new URL(name, artifacts), { force: true });
const server = process.env.QA_BASE_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5195', '--strictPort'],
  { cwd: new URL('..', import.meta.url), detached: true, stdio: 'pipe' });
let output = '', browser, page;
server?.stdout.on('data', c => { output = (output + c).slice(-4000); });
server?.stderr.on('data', c => { output = (output + c).slice(-4000); });
const report = { baseUrl, startedAt: new Date().toISOString(), browser: '', checks: [], violations: [], errors: [] };
const button = name => page.getByRole('button', { name, exact: true });
const screenshot = name => page.screenshot({ path: new URL(`${name}.png`, artifacts).pathname });
async function audit(scope, label) {
  const controls = scope.locator('button:visible').or(scope.and(page.locator('button:visible')));
  await controls.first().waitFor({ state: 'visible' });
  assert(await controls.count() > 0, `No controls found for ${label}`);
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    await control.scrollIntoViewIfNeeded();
    const measure = await control.evaluate(el => {
      const r = el.getBoundingClientRect();
      const text = el.textContent.trim(), name = el.getAttribute('aria-label') || text;
      const badText = [], ellipsized = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (!node.textContent.trim() || !parent || parent.closest('svg')) continue;
        if (!parent.getClientRects().length) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const intentional = [parent, el].some(p => getComputedStyle(p).textOverflow === 'ellipsis');
        for (const b of range.getClientRects()) {
          if (b.width < 1 || b.height < 1) continue;
          if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1) {
            (intentional ? ellipsized : badText).push({ text: node.textContent.trim(), width: b.width, height: b.height });
          }
        }
      }
      return { name, text, width: r.width, height: r.height, badText, ellipsized,
        outside: r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 };
    });
    report.checks.push({ label, ...measure });
    if (measure.badText.length || measure.outside) report.violations.push({ label, ...measure });
  }
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
  for (const [width, height] of [[1280,900], [901,900], [768,844], [390,844], [320,844], [844,390]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    const prefix = `${width}x${height}`, test = (selector, name) => audit(page.locator(selector), `${prefix} ${name}`);
    await page.goto(baseUrl); await button('Cube').click(); await page.getByText('Saved in browser', { exact: true }).waitFor();
    await test('.topbar, .project-bar', 'main controls');
    await test('.interaction-guide', 'interaction guide');
    const hist = page.getByRole('region', { name: 'Histogram', exact: true });
    await hist.locator('summary').click(); await button('Use threshold colors').click();
    await audit(hist, `${prefix} threshold on`); await screenshot(`${prefix}-threshold`);
    await button('Use default colors').click(); await audit(hist, `${prefix} threshold off`);
    await button('Use threshold colors').click();
    for (const name of ['Panels', 'Metric', 'Save & export', 'Menu']) {
      await button(name).click();
      await test(name === 'Panels' ? '.panels-popover' : name === 'Metric' ? '.metric-menu' : name === 'Save & export' ? '.export-popover' : '.overflow-menu', name);
      await page.keyboard.press('Escape');
    }
    await button('Display settings').click();
    const settings = page.getByRole('dialog', { name: 'Display settings', exact: true });
    await audit(settings, `${prefix} display threshold`);
    await settings.getByRole('combobox', { name: 'Metric gradient preset', exact: true }).selectOption('draft');
    await audit(settings, `${prefix} display custom gradient`); await screenshot(`${prefix}-settings`);
    await button('Close display settings').click();
    await button('Save & export').click(); await page.getByRole('button', { name: /^Figure setup \(2D\)/ }).click();
    const figure = page.getByRole('dialog', { name: 'Figure setup (2D)', exact: true });
    await figure.getByLabel('Output range', { exact: true }).selectOption('current');
    await audit(figure, `${prefix} figure setup`); await screenshot(`${prefix}-figure`); await page.keyboard.press('Escape');
    await button('Templates').click();
    await test('.drawer-header, .import-polyhedron, .polyhedron-format-help', 'template actions');
    await button('File format & examples').click();
    await audit(page.getByRole('dialog', { name: 'Polyhedron file format' }), `${prefix} polyhedron guide`); await page.keyboard.press('Escape');
    const closeTemplates = page.getByRole('region', { name: 'Templates', exact: true }).getByRole('button', { name: 'Close', exact: true });
    if (await closeTemplates.isVisible()) await closeTemplates.click();
    await button('Guide').click(); await audit(page.getByRole('dialog', { name: 'Quick guide' }), `${prefix} full guide`); await page.keyboard.press('Escape');
    await button('Notes').click(); await audit(page.getByRole('dialog', { name: 'Project notes' }), `${prefix} notes`); await page.keyboard.press('Escape');
    await button('Results').click(); await page.getByText('Calculation complete.', { exact: true }).waitFor();
    await test('.results-panel', 'results');
    await page.getByRole('button', { name: 'Finite · unit weights · κeff estimate — Calculation details', exact: true }).click();
    await audit(page.getByRole('dialog', { name: 'Calculation details', exact: true }), `${prefix} calculation details`);
    await page.keyboard.press('Escape');
    await button('Locate edge e1').click();
    if (await button('Close results').isVisible()) await button('Close results').click();
    if (await button('Selection details').isVisible()) await button('Selection details').click();
    await test('.inspector', 'inspector bond');
    await button('Convert to Brace').click(); await test('.inspector', 'inspector brace'); await button('Close inspector').click();
    await button('3D').click();
    await page.waitForFunction(() => !!window.__curvatureStudioRenderStats?.());
    await test('.topbar, .project-bar', '3D controls');
    await button('Compare').click(); await page.locator('.comparison-surface').waitFor();
    await test('.comparison-controls, .comparison-pane-header, .comparison-tabs', 'comparison controls');
    assert.equal(await page.locator('.comparison-controls').getByRole('button', { name: 'End comparison…', exact: true }).count(), 0);
    await button('Single view').click();
    await audit(page.getByRole('dialog', { name: 'Single view options' }), `${prefix} choose single`);
    const choices = page.getByRole('dialog', { name: 'Single view options' });
    const show = choices.getByRole('region', { name: 'Show one structure', exact: true });
    const finish = choices.getByRole('region', { name: 'End comparison', exact: true });
    assert.equal(await show.getByRole('button').count(), 2);
    assert.equal(await finish.getByRole('button', { name: 'End comparison…', exact: true }).count(), 1);
    assert.match(await show.innerText(), /Keep both/);
    assert.match(await finish.innerText(), /Keep one/);
    const finishButton = finish.getByRole('button');
    assert(await finishButton.evaluate(el => parseFloat(getComputedStyle(el).borderTopWidth) >= 1), 'End action has a visible button border');
    await screenshot(`${prefix}-choose-single`);
    await page.getByRole('dialog', { name: 'Single view options' }).getByRole('button', { name: 'End comparison…', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'End comparison', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert(await button('Single view').evaluate(el => el === document.activeElement), 'Cancel returns focus to the view control');
    await button('Single view').click();
    await page.getByRole('button', { name: /^Show A ·/ }).click();
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('A long project title — comparison and Japanese 名称の検査'.repeat(2));
    await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Tab');
    await test('.comparison-controls', 'single comparison long name');
    const switches = page.locator('.comparison-document-button');
    for (let i = 0; i < await switches.count(); i++) {
      assert.equal(await switches.nth(i).getAttribute('title'), await switches.nth(i).textContent(), 'Full label remains available');
    }
    await switches.nth(1).click(); assert.equal(await switches.nth(1).getAttribute('aria-pressed'), 'true');
    await switches.nth(0).click(); assert.equal(await switches.nth(0).getAttribute('aria-pressed'), 'true');
    await screenshot(`${prefix}-single`);
    await context.close();
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ checks: report.checks.length, violations: report.violations, errors: report.errors }, null, 2));
  assert.deepEqual(report.errors, []); assert.equal(report.violations.length, 0, 'Button text overflow found; see report.json');
} catch (error) {
  if (page && !page.isClosed()) await screenshot('failure');
  writeFileSync(new URL('failure.json', artifacts), JSON.stringify({ ...report, failure: String(error) }, null, 2)); throw error;
} finally {
  await browser?.close(); if (server?.pid) try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
