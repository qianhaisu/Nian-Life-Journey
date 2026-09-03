#!/usr/bin/env node
// Renders the running local server (real production data via the JSON snapshot) at desktop and
// real narrow-mobile viewports and saves full-page screenshots for inspection. Local only.
//   node scripts/p1a2-visual-audit.mjs [--base=http://localhost:3000] [--out=DIR] [--pages=home,...]
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const BASE = argOf("base", "http://localhost:3000");
const OUT = argOf("out", path.join(process.cwd(), ".data", "scratch", "p1a2-visual"));
const only = argOf("pages", "");

const PAGES = [
  ["home", "/"],
  ["memory", "/memory"],
  ["month-2026-08", "/memory/2026/08"],
  ["month-2025-10", "/memory/2025/10"],
  ["month-2025-08", "/memory/2025/08"],
  ["month-2025-07", "/memory/2025/07"],
  ["event-stand", "/events/event-dc7193ad-8217-46c4-8ace-b2cc7602add8"],
  ["event-noodles", "/events/event-7f060955-2ac9-42e4-982a-a9cee5cab62b"],
  ["about", "/about"],
].filter(([name]) => !only || only.split(",").includes(name));

const VIEWPORTS = [
  ["desktop", { width: 1280, height: 900 }],
  ["m390", { width: 390, height: 844 }],
  ["m430", { width: 430, height: 932 }],
];

mkdirSync(OUT, { recursive: true });
// Local .env.local carries no hot-storage credentials, so image bytes are fetched read-only from
// the production site itself while page HTML comes from the local server under test. Fetched
// bytes are cached on disk so reruns are deterministic and fast.
const MEDIA_ORIGIN = argOf("media-origin", "https://nianlife.cn");
const mediaCache = path.join(process.cwd(), ".data", "scratch", "p1a2-media-cache");
mkdirSync(mediaCache, { recursive: true });

const browser = await chromium.launch();
for (const [vpName, viewport] of VIEWPORTS) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const proxyToProduction = async (route) => {
    const url = new URL(route.request().url());
    // The optimizer endpoint re-encodes on demand and is slow from here; the raw media API is
    // fast. For /_next/image, unwrap its `url` param and fetch the raw derivative instead.
    const inner = url.pathname.startsWith("/_next/image") ? decodeURIComponent(url.searchParams.get("url") ?? "") : url.pathname + url.search;
    const key = createHash("sha1").update(inner).digest("hex");
    const cacheBody = path.join(mediaCache, `${key}.bin`);
    const cacheType = path.join(mediaCache, `${key}.type`);
    if (existsSync(cacheBody)) {
      await route.fulfill({ body: readFileSync(cacheBody), contentType: readFileSync(cacheType, "utf8") });
      return;
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await route.fetch({ url: MEDIA_ORIGIN + inner, maxRedirects: 3, timeout: 60000 });
        if (response.status() === 200) {
          const body = await response.body();
          writeFileSync(cacheBody, body);
          writeFileSync(cacheType, response.headers()["content-type"] ?? "image/jpeg", "utf8");
          await route.fulfill({ body, contentType: response.headers()["content-type"] ?? "image/jpeg" });
          return;
        }
        console.log(`  [media ${response.status()}] ${inner.slice(0, 90)}`);
        await route.fulfill({ response });
        return;
      } catch (error) {
        if (attempt === 3) {
          console.log(`  [media proxy miss] ${inner.slice(0, 90)} — ${String(error.message).split("\n")[0]}`);
          await route.abort();
        }
      }
    }
  };
  // Both the raw media route and Next's image optimizer endpoint carry picture bytes.
  await context.route("**/api/media/**", proxyToProduction);
  await context.route("**/_next/image*", proxyToProduction);
  const page = await context.newPage();
  for (const [name, route] of PAGES) {
    try {
      await page.goto(BASE + route, { waitUntil: "load", timeout: 120000 });
      await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(500);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const file = path.join(OUT, `${name}-${vpName}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${name} @${vpName}: height=${height}px → ${file}`);
    } catch (error) {
      console.log(`${name} @${vpName}: FAILED ${error.message.split("\n")[0]}`);
    }
  }
  await context.close();
}
await browser.close();
console.log("DONE");
