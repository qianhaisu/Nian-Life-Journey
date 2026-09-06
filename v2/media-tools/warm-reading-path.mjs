#!/usr/bin/env node
// C-track media cache warmer. Lives outside v2/scripts/ on purpose — that
// directory is A-track territory (see docs/ORCHESTRATOR-INBOX-C.md C-6).
//
// Warms the CDN cache for the images a real visitor's reading path will
// actually request: the year page + each month page for a given year.
// Deliberately NOT a full-library warm — it only touches what a page really
// renders, discovered by fetching the page HTML and scraping the
// /api/media/<id>?variant=<variant> URLs it contains, the same way a
// browser would.
//
// Usage:
//   node media-tools/warm-reading-path.mjs [year] [--base=https://nianlife.cn]
//     [--concurrency=2] [--delay-ms=350] [--verify=5]
//
// Rate-limit posture: sequential-ish with a small concurrency cap and a
// fixed delay between requests, exponential backoff + concurrency drop to 1
// on 429/403 (bot protection tripped) — B-track already hit this once
// hammering the site, don't repeat it.

const args = process.argv.slice(2);
const year = Number(args.find((a) => /^\d{4}$/.test(a)) ?? new Date().getFullYear());
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = opt("base", "https://nianlife.cn").replace(/\/$/, "");
const concurrency = Math.max(1, Math.min(2, Number(opt("concurrency", "2"))));
const delayMs = Number(opt("delay-ms", "350"));
const verifyCount = Number(opt("verify", "5"));
const monthsOverride = opt("months", null); // e.g. --months=01,02,06 for a small validation run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEDIA_URL_RE = /\/api\/media\/[a-zA-Z0-9_-]+\?variant=[a-z_]+/g;

async function fetchWithBackoff(url, { maxRetries = 4 } = {}) {
  let backoff = 800;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "nianlife-cache-warmer/1.0 (+internal)" } });
    if (res.status === 429 || res.status === 403) {
      console.warn(`  [backoff] ${res.status} on ${url}, waiting ${backoff}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      await sleep(backoff);
      backoff *= 2;
      continue;
    }
    return res;
  }
  throw new Error(`Gave up on ${url} after ${maxRetries + 1} attempts (persistent 429/403 — bot protection likely tripped)`);
}

async function collectMediaUrls(pagePaths) {
  const urls = new Set();
  for (const path of pagePaths) {
    const res = await fetchWithBackoff(`${base}${path}`);
    if (!res.ok) { console.warn(`  [skip] ${path} -> ${res.status}`); await sleep(delayMs); continue; }
    const html = await res.text();
    for (const match of html.matchAll(MEDIA_URL_RE)) urls.add(match[0]);
    await sleep(delayMs);
  }
  return [...urls];
}

async function warmUrls(urls) {
  let ok = 0, failed = 0, hitOnFirstTry = 0;
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      const url = urls[i];
      try {
        const res = await fetchWithBackoff(`${base}${url}`);
        const cache = res.headers.get("x-vercel-cache") ?? "unknown";
        if (cache === "HIT" || cache === "STALE") hitOnFirstTry++;
        if (res.ok) ok++; else failed++;
        console.log(`  [${i + 1}/${urls.length}] ${cache.padEnd(7)} ${url}`);
      } catch (err) {
        failed++;
        console.warn(`  [fail] ${url}: ${err.message}`);
      }
      await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ok, failed, hitOnFirstTry };
}

async function verifyHitRate(urls, n) {
  const sample = urls.slice(0, Math.min(n, urls.length));
  let hits = 0;
  for (const url of sample) {
    const res = await fetchWithBackoff(`${base}${url}`);
    const cache = res.headers.get("x-vercel-cache") ?? "unknown";
    if (cache === "HIT") hits++;
    console.log(`  [verify] ${cache.padEnd(7)} ${url}`);
    await sleep(delayMs);
  }
  return { sampled: sample.length, hits };
}

async function main() {
  const months = monthsOverride ? monthsOverride.split(",") : Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const pagePaths = [`/memory/${year}`, ...months.map((m) => `/memory/${year}/${m}`)];

  console.log(`C-6 warm: year=${year} base=${base} concurrency=${concurrency} delayMs=${delayMs}`);
  console.log(`Step 1/3: collecting media URLs from ${pagePaths.length} pages...`);
  const t0 = Date.now();
  const urls = await collectMediaUrls(pagePaths);
  console.log(`  -> ${urls.length} unique /api/media URLs discovered`);

  console.log(`Step 2/3: warming ${urls.length} media URLs (concurrency=${concurrency})...`);
  const { ok, failed, hitOnFirstTry } = await warmUrls(urls);

  console.log(`Step 3/3: re-verifying a sample of ${verifyCount} URLs are now HIT...`);
  const verify = await verifyHitRate(urls, verifyCount);

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n=== summary ===");
  console.log(`pages scraped: ${pagePaths.length}`);
  console.log(`unique media URLs: ${urls.length}`);
  console.log(`warm requests: ok=${ok} failed=${failed} (already HIT/STALE on first touch: ${hitOnFirstTry})`);
  console.log(`post-warm verify: ${verify.hits}/${verify.sampled} sampled URLs came back HIT`);
  console.log(`elapsed: ${elapsedSec}s`);
}

main().catch((err) => { console.error(err); process.exit(1); });
