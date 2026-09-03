#!/usr/bin/env node
// Prefetches every image the audited pages reference into the local media cache, so the visual
// audit can render fully offline. Reads page HTML from the local dev server (fast), extracts
// /api/media/... references (raw or wrapped in /_next/image?url=...), and downloads each once
// from production with retries. Resumable: cached files are skipped.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const MEDIA_ORIGIN = "https://nianlife.cn";
const PAGES = ["/", "/memory", "/memory/2026/08", "/memory/2025/10", "/memory/2025/08", "/memory/2025/07", "/memory/2026", "/events/event-dc7193ad-8217-46c4-8ace-b2cc7602add8", "/events/event-7f060955-2ac9-42e4-982a-a9cee5cab62b", "/about"];
const cache = path.join(process.cwd(), ".data", "scratch", "p1a2-media-cache");
mkdirSync(cache, { recursive: true });

const inner = new Set();
for (const route of PAGES) {
  const html = await (await fetch(BASE + route)).text();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    let value = match[1].replaceAll("&amp;", "&");
    if (value.startsWith("/_next/image")) {
      const url = new URL(value, BASE);
      value = decodeURIComponent(url.searchParams.get("url") ?? "");
    }
    if (value.startsWith("/api/media/")) inner.add(value);
  }
}
console.log(`${inner.size} unique media URLs across ${PAGES.length} pages`);

let missing = [...inner].filter((value) => !existsSync(path.join(cache, `${createHash("sha1").update(value).digest("hex")}.bin`)));
console.log(`${missing.length} not yet cached`);
for (let round = 1; round <= 6 && missing.length > 0; round += 1) {
  console.log(`round ${round}: ${missing.length} to fetch`);
  const still = [];
  for (const value of missing) {
    const key = createHash("sha1").update(value).digest("hex");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      const response = await fetch(MEDIA_ORIGIN + value, { signal: controller.signal });
      clearTimeout(timer);
      if (response.status !== 200) { console.log(`  ${response.status} ${value.slice(0, 80)}`); continue; }
      const body = Buffer.from(await response.arrayBuffer());
      writeFileSync(path.join(cache, `${key}.bin`), body);
      writeFileSync(path.join(cache, `${key}.type`), response.headers.get("content-type") ?? "image/jpeg", "utf8");
      console.log(`  ok ${(body.length / 1024).toFixed(0)}KB ${value.slice(11, 55)}`);
    } catch (error) {
      console.log(`  retry-later ${value.slice(11, 55)} (${String(error.message ?? error).slice(0, 40)})`);
      still.push(value);
    }
  }
  missing = still;
}
console.log(missing.length === 0 ? "ALL CACHED" : `STILL MISSING ${missing.length}`);
process.exit(0);
