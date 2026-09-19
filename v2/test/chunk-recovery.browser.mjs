// Browser-only fault injection. No server state changes or production writes.
// APP_BASE_URL=http://127.0.0.1:3100 node test/chunk-recovery.browser.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.APP_BASE_URL || "http://127.0.0.1:3100";
const month = process.env.TEST_MONTH_PATH || "/memory/2026/09";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const waitForClientLink = () => page.waitForFunction(href => {
    const link = [...document.querySelectorAll("a")].find(a => a.getAttribute("href") === href);
    return link && Object.keys(link).some(key => key.startsWith("__reactProps$"));
  }, month);
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
    // This is a JS navigation test, not a media-delivery test.
    if (["image", "media", "font"].includes(request.resourceType())) return route.abort();
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
  await waitForClientLink();
  await page.locator(`a[href="${month}"]`).first().click();
  await page.waitForFunction(() => sessionStorage.getItem("nianlife:chunk-recovery") !== null, undefined, { timeout: 30000 });
  await page.waitForURL(`${base}${month}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".month-page h1") !== null);
  await page.waitForTimeout(1500);
  assert.ok(injected > 0, "A stale route chunk must actually be injected");
  assert.equal(documentLoads, 1, "Recover with exactly one document reload");
  assert.equal(await page.getByText("Application error:", { exact: false }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "重新打开" }).count(), 0);
  console.log(JSON.stringify({ stage: "automatic-recovery", injected, documentLoads }));
  // A repeated failure inside the retry window must stop auto-reloading.
  await page.goto(`${base}/memory`, { waitUntil: "domcontentloaded" });
  await waitForClientLink();
  // Slow remote navigation must not accidentally move this test outside the 60s window.
  await page.evaluate(url => sessionStorage.setItem("nianlife:chunk-recovery", JSON.stringify({ url, at: Date.now() })), `${base}${month}`);
  await page.locator(`a[href="${month}"]`).first().click();
  await page.getByRole("button", { name: "重新打开" }).waitFor({ timeout: 15000 }).catch(async error => {
    console.log(JSON.stringify({ stage: "retry-diagnostic", injected, documentLoads, url: page.url(),
      session: await page.evaluate(() => sessionStorage.getItem("nianlife:chunk-recovery")), errors }));
    throw error;
  });
  await page.waitForTimeout(1500);
  assert.equal(documentLoads, 1, "Repeated failure must offer manual retry, not loop");
  await page.getByRole("button", { name: "重新打开" }).click();
  await page.waitForFunction(() => document.querySelector(".month-page h1") !== null);
  assert.equal(documentLoads, 2, "Explicit retry can recover after the automatic limit");
  console.log(JSON.stringify({ month, injected, documentLoads, recovered: true, loopPrevented: true, observedErrors: errors.length }));
} finally {
  await browser.close();
}
