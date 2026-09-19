// Browser-only fault injection. No server state changes or production writes.
// APP_BASE_URL=http://127.0.0.1:3100 node test/chunk-recovery.browser.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL || "http://127.0.0.1:3100";
const month = process.env.TEST_MONTH_PATH || "/memory/2026/09";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let injected = 0;
  let documentLoads = 0;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === month) documentLoads++;
  });
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === month && request.headers().rsc) {
      const response = await route.fetch();
      const original = await response.text();
      // Only the browser's route payload is changed: simulate an obsolete chunk URL.
      const body = original.replace(/static\/chunks\/app\/memory\/[^"\s]+?page-[a-f0-9]+\.js/g,
        value => { injected++; return value.replace(/page-[a-f0-9]+\.js$/, "page-obsolete-regression.js"); });
      return route.fulfill({ response, body });
    }
    return route.continue();
  });
  await page.goto(`${base}/memory`, { waitUntil: "domcontentloaded" });
  await page.locator(`a[href="${month}"]`).first().click();
  await page.waitForFunction(() => sessionStorage.getItem("nianlife:chunk-recovery") !== null, undefined, { timeout: 30000 });
  await page.waitForURL(`${base}${month}`);
  await page.waitForFunction(() => document.querySelector(".month-page h1") !== null);
  await page.waitForTimeout(1500);
  assert.ok(injected > 0, "A stale route chunk must actually be injected");
  assert.equal(documentLoads, 1, "Recover with exactly one document reload");
  assert.equal(await page.getByText("Application error:", { exact: false }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "重新打开" }).count(), 0);
  console.log(JSON.stringify({ month, injected, documentLoads, recovered: true, observedErrors: errors.length }));
} finally {
  await browser.close();
}
