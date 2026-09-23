// 视频封面与播放的真实浏览器验收（2026-09-23）。
// 1) 页面上现有视频的一天（2025-12-12，月页和单日页）：封面显示、点播放能播。
// 2) r4 为 1b 的 159 个视频生成的衍生文件：这些视频还没出现在任何页面上，抽样直接加载线上封面、播放线上预览。
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.resolve(here, "../../v2/package.json"))("playwright");
const r4 = JSON.parse(readFileSync(path.resolve(here, "../../v2/.data/r4/video-derivatives.json"), "utf8")).items;
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const results = []; const say = (pass, msg, extra) => { results.push({ pass, msg, extra }); console.log(`${pass ? "PASS" : "FAIL"} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`); };

async function checkVideoOnPage(page, scope, label, shotName) {
  const video = scope.locator("video").first();
  await video.scrollIntoViewIfNeeded();
  const poster = await video.getAttribute("poster");
  const posterOk = poster ? await page.evaluate(async (src) => { const img = new Image(); img.src = src; try { await img.decode(); return img.naturalWidth > 0; } catch { return false; } }, poster) : false;
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(here, `${shotName}-before.png`) });
  const playBtn = scope.locator(".video-play").first();
  if (await playBtn.count()) await playBtn.click(); else await video.click();
  const t = await page.waitForFunction((el) => el.currentTime > 0.5 && !el.paused ? el.currentTime : false, await video.elementHandle(), { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => 0);
  await page.screenshot({ path: path.join(here, `${shotName}-playing.png`) });
  say(posterOk && t > 0.5, `${label}：封面显示、点播放后在播`, { poster, posterOk, currentTime: t });
}

for (const [vp, opts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["mobile390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await (await browser.newContext(opts)).newPage();
  // 月页：2025-12-12 在第二周，点一次「更多」
  await page.goto("https://nianlife.cn/memory/2025/12", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => { const b = document.querySelector("p.month-more button"); return b && Object.keys(b).some((k) => k.startsWith("__reactProps")); }, null, { timeout: 60000 });
  await page.click("p.month-more button");
  const day = page.locator("li.month-day", { has: page.locator('time[datetime="2025-12-12"]') });
  await day.waitFor({ timeout: 60000 });
  // 视频可能在「展开」后面：先展开这一天
  if (await day.locator("button.pg-more").count()) { await day.locator("button.pg-more").click(); await page.waitForTimeout(500); }
  await checkVideoOnPage(page, day, `[${vp}] 月页 2025-12-12 的视频`, `${vp}-video-month-2025-12-12`);
  // 单日页
  await page.goto("https://nianlife.cn/memory/2025/12/12", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => { const b = document.querySelector(".video-play"); return !b || Object.keys(b).some((k) => k.startsWith("__reactProps")); }, null, { timeout: 60000 });
  await checkVideoOnPage(page, page.locator(".day-detail-photos"), `[${vp}] 单日页 2025-12-12 的视频`, `${vp}-video-day-2025-12-12`);
  await page.context().close();
}

// r4 衍生文件：均匀抽 8 个，在 nianlife.cn 同源页面里加载封面、播放预览
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<body style='margin:0;background:#fff'><div id=wall style='display:grid;grid-template-columns:repeat(4,300px);gap:8px;padding:8px'></div></body>");
  const sample = [0, 20, 40, 60, 80, 100, 130, 158].map((i) => r4[i]).filter(Boolean);
  const got = await page.evaluate(async (ids) => {
    const out = [];
    for (const id of ids) {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.width = 300; v.height = 300; v.style.objectFit = "cover";
      v.poster = `https://nianlife.cn/api/media/${id}?variant=poster`; v.src = `https://nianlife.cn/api/media/${id}?variant=preview`;
      document.getElementById("wall").append(v);
      const img = new Image(); img.src = v.poster;
      const posterOk = await img.decode().then(() => img.naturalWidth > 0).catch(() => false);
      const played = await new Promise((res) => { const t = setTimeout(() => res(v.currentTime), 20000); v.addEventListener("timeupdate", () => { if (v.currentTime > 0.5) { clearTimeout(t); res(v.currentTime); } }); v.play().catch(() => res(-1)); });
      v.pause();
      out.push({ id, posterOk, played, w: v.videoWidth, h: v.videoHeight });
    }
    return out;
  }, sample.map((s) => s.mediaId));
  await page.screenshot({ path: path.join(here, "r4-video-sample-wall.png") });
  for (const g of got) say(g.posterOk && g.played > 0.5 && g.w > 0, `r4 视频 ${g.id.slice(0, 40)}… 封面可见、预览可播`, { played: g.played, size: `${g.w}x${g.h}` });
}
await browser.close();
writeFileSync(path.join(here, "video-results.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `FAILED ${failed}/${results.length}` : `ALL ${results.length} PASS`);
process.exit(failed ? 1 : 0);
