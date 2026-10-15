/** Playwright's predicate polling treats a Promise as truthy. Await async probes explicitly. */
export async function waitForBrowser(page, predicate, arg, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Browser condition did not become true: ${predicate.toString()}`);
}
