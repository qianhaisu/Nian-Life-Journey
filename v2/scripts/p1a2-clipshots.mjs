#!/usr/bin/env node
// Viewport-sized clips down one page at a mobile width — how the page actually reads screen by
// screen. node scripts/p1a2-clipshots.mjs --route=/memory/2026/08 --name=month0808 [--width=390]
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const ROUTE = argOf("route", "/");
const NAME = argOf("name", "page");
const WIDTH = Number(argOf("width", "390"));
const HEIGHT = Number(argOf("height", "844"));
const COUNT = Number(argOf("screens", "6"));
const OUT = path.join(process.cwd(), ".data", "scratch", "p1a2-visual");
const mediaCache = path.join(process.cwd(), ".data", "scratch", "p1a2-media-cache");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const fromCache = async (route) => {
  const url = new URL(route.request().url());
  const inner = url.pathname.startsWith("/_next/image") ? decodeURIComponent(url.searchParams.get("url") ?? "") : url.pathname + url.search;
  const key = createHash("sha1").update(inner).digest("hex");
  const body = path.join(mediaCache, `${key}.bin`);
  if (existsSync(body)) return route.fulfill({ body: readFileSync(body), contentType: readFileSync(path.join(mediaCache, `${key}.type`), "utf8") });
  return route.abort();
};
await context.route("**/api/media/**", fromCache);
await context.route("**/_next/image*", fromCache);
const page = await context.newPage();
await page.goto("http://localhost:3000" + ROUTE, { waitUntil: "load", timeout: 120000 });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
const step = Math.max(HEIGHT, Math.floor((total - HEIGHT) / Math.max(1, COUNT - 1)));
for (let i = 0; i < COUNT; i += 1) {
  const y = Math.min(i * step, total - HEIGHT);
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(250);
  const file = path.join(OUT, `${NAME}-w${WIDTH}-s${i}.png`);
  await page.screenshot({ path: file });
  console.log(`${file} @y=${y}/${total}`);
  if (y >= total - HEIGHT) break;
}
await browser.close();
