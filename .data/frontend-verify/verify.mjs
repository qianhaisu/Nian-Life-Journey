// 前端这一轮的真实页面验收：Playwright 打开 https://nianlife.cn，逐项检查并截图到本目录。
// 用法（在仓库根目录）：node .data/frontend-verify/verify.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../v2/package.json"));
const { chromium } = require("playwright");
const SITE = "https://nianlife.cn";

const results = [];
const record = (viewport, item, pass, detail, shots = []) => {
  results.push({ viewport, item, pass, detail, shots });
  console.log(`${pass ? "PASS" : "FAIL"} [${viewport}] ${item} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

const browser = await chromium.launch();
const viewports = [
  { name: "desktop", options: { viewport: { width: 1280, height: 900 } } },
  { name: "mobile390", options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];

async function shot(page, vp, name, opts = {}) {
  await page.waitForLoadState("domcontentloaded");
  const file = `${vp}-${name}.png`;
  // Let the pictures on screen finish loading, so the shot shows photos and not grey cells.
  await page.waitForFunction(() => [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).every((i) => i.complete), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(here, file), ...opts });
  return file;
}
const dayList = (page) => page.$$eval("li.month-day time[datetime]", (els) => els.map((e) => e.getAttribute("datetime")));
const rawDays = (html) => [...html.matchAll(/<li class="month-day"><article[^>]*><p class="month-day-date"><time dateTime="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);

// The button is in the server HTML; a tap before React hydrates does nothing. Wait until it is live.
const hydrated = (page, selector) => page.waitForFunction((sel) => {
  const el = document.querySelector(sel);
  return !el || Object.keys(el).some((k) => k.startsWith("__reactProps"));
}, selector, { timeout: 60000 });

async function loadAll(page, vp, tag) {
  const shots = [];
  let rounds = 0;
  while (await page.$("p.month-more button")) {
    const before = (await dayList(page)).length;
    await hydrated(page, "p.month-more button");
    const label = (await page.textContent("p.month-more button")).trim();
    await page.click("p.month-more button");
    await page.waitForFunction((n) => document.querySelectorAll("li.month-day").length > n, before, { timeout: 60000 });
    rounds += 1;
    const days = await dayList(page);
    await page.locator("li.month-day").nth(before).scrollIntoViewIfNeeded();
    shots.push(await shot(page, vp, `${tag}-more-${rounds}`));
    console.log(`   loaded via 「${label}」 → ${days.length} days`);
  }
  return { rounds, shots };
}

// Every entry: date → title → text → photos → link, in that DOM order.
async function checkEntryOrder(page) {
  return page.$$eval("li.month-day article", (articles) => articles.map((a) => {
    const kids = [...a.querySelectorAll(".month-day-date, .day-entry-title, .day-entry-text, .day-photos, .day-entry-more")];
    const kind = (el) => el.matches(".month-day-date") ? 0 : el.matches(".day-entry-title") ? 1 : el.matches(".day-entry-text") ? 2 : el.matches(".day-photos") ? 3 : 4;
    const seq = kids.map(kind);
    const ok = seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq.at(-1) === 4 && !a.querySelector(".photo-strip");
    return { day: a.querySelector("time")?.getAttribute("datetime"), ok, seq: seq.join("") };
  }));
}

for (const vp of viewports) {
  const context = await browser.newContext(vp.options);
  const page = await context.newPage();

  // ── 1+2+3: 2026-09 (latest month) ──
  {
    const html = await (await page.request.get(`${SITE}/memory/2026/09`)).text();
    const raw = rawDays(html);
    const noStory = !html.includes("这个月的故事") && !html.includes("这个月的日子");
    await page.goto(`${SITE}/memory/2026/09`, { waitUntil: "load", timeout: 90000 });
    const first = await dayList(page);
    const top = await shot(page, vp.name, "2026-09-top");
    record(vp.name, "2026-09 没有「这个月的故事」「这个月的日子」", noStory, `html contains story heading: ${html.includes("这个月的故事")}, days heading: ${html.includes("这个月的日子")}`, [top]);
    record(vp.name, "2026-09 源码只含一周", raw.length === first.length && raw.every((d) => d >= "2026-09-16"), { rawDays: raw });
    record(vp.name, "2026-09 第一条是本月最新的一天", first[0] === "2026-09-22", { first: first[0] });
    const { shots } = await loadAll(page, vp.name, "2026-09");
    const all = await dayList(page);
    const desc = all.every((d, i) => i === 0 || d < all[i - 1]);
    record(vp.name, "2026-09 「更多」依次加载到 9 月 1 日（倒序）", all.at(-1) === "2026-09-01" && desc, { count: all.length, last: all.at(-1), desc }, shots);
    const order = await checkEntryOrder(page);
    const bad = order.filter((o) => !o.ok);
    record(vp.name, "2026-09 每一天：日期→标题→正文→照片网格→原记录，无缩略图条", bad.length === 0, { entries: order.length, bad });
  }

  // ── 2025-12 (older month) ──
  {
    const html = await (await page.request.get(`${SITE}/memory/2025/12`)).text();
    const raw = rawDays(html);
    await page.goto(`${SITE}/memory/2025/12`, { waitUntil: "load", timeout: 90000 });
    const first = await dayList(page);
    const top = await shot(page, vp.name, "2025-12-top");
    record(vp.name, "2025-12 首屏只有 12 月 1–7 日", raw.length === first.length && raw.every((d) => d >= "2025-12-01" && d <= "2025-12-07") && first[0] === "2025-12-01", { rawDays: raw, first: first[0] }, [top]);
    record(vp.name, "2025-12 没有「这个月的故事」", !html.includes("这个月的故事") && !html.includes("这个月的日子"), "");

    // Grid on 12-04 (12 photos): 6 cells, +6, tap → all 12, tap a photo → viewer
    const day = page.locator("li.month-day", { has: page.locator('time[datetime="2025-12-04"]') });
    await day.locator(".day-photos").scrollIntoViewIfNeeded();
    const cells = await day.locator(".pg-cell").count();
    const overlay = (await day.locator(".pg-overlay").textContent())?.trim();
    const g1 = await shot(page, vp.name, "grid-2025-12-04-collapsed");
    record(vp.name, "7 张以上的日子默认网格且带「+N」（12-04，12 张）", cells === 6 && overlay === "+6", { cells, overlay }, [g1]);
    await hydrated(page, ".pg-cell");
    await day.locator(".pg-cell", { has: page.locator(".pg-overlay") }).click();
    await page.waitForTimeout(500);
    const cellsAfter = await day.locator(".pg-cell").count();
    await day.locator(".day-photos").scrollIntoViewIfNeeded();
    const g2 = await shot(page, vp.name, "grid-2025-12-04-expanded");
    record(vp.name, "点击「+N」展开全部", cellsAfter === 12, { cellsAfter }, [g2]);
    await day.locator(".pg-cell").nth(1).click();
    await page.waitForSelector("dialog.photo-viewer[open]", { timeout: 10000 });
    const g3 = await shot(page, vp.name, "viewer-2025-12-04");
    record(vp.name, "点照片放大（ViewerModal）仍可用", true, "dialog.photo-viewer open", [g3]);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    const { shots } = await loadAll(page, vp.name, "2025-12");
    const all = await dayList(page);
    const asc = all.every((d, i) => i === 0 || d > all[i - 1]);
    record(vp.name, "2025-12 正序，「更多」一路加载到 12 月 31 日", all.at(-1) === "2025-12-31" && asc, { count: all.length, last: all.at(-1), asc }, shots);
    const order = await checkEntryOrder(page);
    const bad = order.filter((o) => !o.ok);
    record(vp.name, "2025-12 每一天版式顺序一致", bad.length === 0, { entries: order.length, bad });

    // Week tab to an unloaded week: loads, then jumps
    await page.goto(`${SITE}/memory/2025/12`, { waitUntil: "load", timeout: 90000 });
    await hydrated(page, 'nav.month-jump a[href="#week-5"]');
    await page.click('nav.month-jump a[href="#week-5"]');
    await page.waitForSelector("#week-5", { timeout: 60000 });
    await page.waitForTimeout(1200);
    const inView = await page.$eval("#week-5", (el) => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
    const loadedAfterTab = await dayList(page);
    const t1 = await shot(page, vp.name, "2025-12-tab-week5");
    record(vp.name, "点未加载的周标签：先加载再跳转", inView && loadedAfterTab.at(-1) === "2025-12-31", { inView, days: loadedAfterTab.length }, [t1]);
  }

  // ── 5: day detail grid ──
  {
    await page.goto(`${SITE}/memory/2025/12/06`, { waitUntil: "load", timeout: 90000 });
    const cells = await page.locator(".day-detail-photos .pg-cell").count();
    const strip = await page.locator(".day-detail-photos .photo-strip").count();
    await page.locator(".day-detail-photos").scrollIntoViewIfNeeded();
    const d1 = await shot(page, vp.name, "day-detail-2025-12-06-grid");
    record(vp.name, "单日详情页用同一套网格（12-06，14 张全部显示）", cells === 14 && strip === 0, { cells, strip }, [d1]);
  }

  // ── 6: speakers in 当时留下的资料 ──
  const speakerDays = ["2025-12-04", "2025-12-08", "2025-12-11", "2025-05-22", "2025-08-08", "2025-10-29", "2026-01-29", "2026-03-24"];
  for (const d of speakerDays) {
    const [y, m, dd] = d.split("-");
    await page.goto(`${SITE}/memory/${y}/${m}/${dd}`, { waitUntil: "load", timeout: 90000 });
    const material = page.locator("details.day-material");
    if (!(await material.count())) { record(vp.name, `资料区发言人 ${d}`, false, "no 当时留下的资料 section"); continue; }
    await material.locator("summary").click();
    const labels = await page.$$eval("details.day-material .evidence-time span", (els) => els.map((e) => e.textContent.trim()));
    const hist = labels.reduce((h, l) => ({ ...h, [l]: (h[l] ?? 0) + 1 }), {});
    await material.scrollIntoViewIfNeeded();
    const s1 = await shot(page, vp.name, `speakers-${d}`);
    const e = labels.filter((l) => l === "发言人E").length;
    record(vp.name, `资料区「发言人E」为 0（${d}）`, e === 0, hist, [s1]);
  }

  await context.close();
}
await browser.close();
writeFileSync(path.join(here, "results.json"), JSON.stringify({ at: new Date().toISOString(), site: SITE, results }, null, 1));
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL ${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
